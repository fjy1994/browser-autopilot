"""
页面签名计算。

签名 = 有效区域内全部有 id 节点的 (type, resource_id) 集合。
完全一致才命中（query 严格）；学习时命中则更新已有页面，未命中才新建。

id 字段兼容: resource_id / resource-id / id / key / accessibility_id / view_id
有效区域由 LLM 对截图裁剪得出（去除状态栏、任务栏、广告浮层等噪声），
只收集落在该区域内的节点。
"""

from __future__ import annotations

from typing import Any

# 常见的 id 字段名，按优先级取第一个非空
_ID_KEYS = ("resource_id", "resource-id", "id", "key", "accessibility_id", "view_id")


def _node_id(node: dict) -> str:
    for k in _ID_KEYS:
        v = node.get(k)
        if v and isinstance(v, str):
            v = v.strip()
            if v:
                return v
    return ""


def _node_type(node: dict) -> str:
    t = node.get("type") or node.get("className") or ""
    return str(t).strip().lower() or "unknown"


def _in_region(node: dict, region: dict | None) -> bool:
    """节点中心点是否落在有效区域内。无 bounds 或未给区域时不拦截。"""
    if not region:
        return True
    b = node.get("bounds") or {}
    left = b.get("left", 0)
    top = b.get("top", 0)
    right = b.get("right", 0)
    bottom = b.get("bottom", 0)
    w = right - left
    h = bottom - top
    if w <= 0 or h <= 0:
        return True  # 没有有效坐标，不拦截（交由 LLM 裁剪环节把关）
    cx = (left + right) / 2.0
    cy = (top + bottom) / 2.0
    return (
        region.get("left", 0) <= cx <= region.get("right", 0)
        and region.get("top", 0) <= cy <= region.get("bottom", 0)
    )


def _walk(node: dict, region: dict | None, out: list[dict]) -> None:
    nid = _node_id(node)
    if nid and _in_region(node, region):
        out.append({"id": nid, "type": _node_type(node)})
    for child in node.get("children") or []:
        _walk(child, region, out)


def collect_id_nodes(ui_tree: dict, valid_region: dict | None = None) -> list[dict]:
    """有效区域内收集全部有 id 的节点，返回 [{"id": str, "type": str}, ...]。"""
    out: list[dict] = []
    _walk(ui_tree or {}, valid_region, out)
    return out


def compute_page_signature(ui_tree: dict, valid_region: dict | None = None) -> str:
    """
    计算页面签名：排序去重后的 "type|id" 列表，用 "; " 连接。

    例: "edittext|search_box; textview|city_name"
    空页面（无 id 节点）返回空字符串。
    """
    items = collect_id_nodes(ui_tree, valid_region)
    parts = sorted({f"{it['type']}|{it['id']}" for it in items})
    return "; ".join(parts)


# ── 兼容保留：旧布局/文本哈希（不再用于匹配，仅供外部引用） ──

import hashlib
import json
import re


def _collect_interactive_nodes(node: dict, screen_w: int, screen_h: int) -> list[dict]:
    """递归收集所有可交互的 UI 节点。"""
    results = []
    bounds = node.get("bounds", {})
    x1, y1 = bounds.get("left", 0), bounds.get("top", 0)
    x2, y2 = bounds.get("right", 0), bounds.get("bottom", 0)
    w, h = x2 - x1, y2 - y1

    if w <= 0 or h <= 0:
        pass
    else:
        clickable = node.get("clickable", False)
        inputable = node.get("inputable", False)
        scrollable = node.get("scrollable", False)
        checkable = node.get("checkable", False)
        is_interactive = clickable or inputable or scrollable or checkable
        node_type = (node.get("type") or node.get("className") or "").lower()

        if is_interactive or node_type in ("button", "imagebutton", "input", "edittext",
                                            "switch", "checkbox", "radiobutton", "image"):
            cx = (x1 + x2) / 2.0
            cy = (y1 + y2) / 2.0
            grid_size = 25
            grid_x = int(cx / screen_w * grid_size) if screen_w > 0 else 0
            grid_y = int(cy / screen_h * grid_size) if screen_h > 0 else 0
            results.append({
                "type": node_type,
                "grid_x": grid_x,
                "grid_y": grid_y,
                "clickable": clickable,
                "inputable": inputable,
                "scrollable": scrollable,
            })

    for child in node.get("children", []):
        results.extend(_collect_interactive_nodes(child, screen_w, screen_h))

    return results


def _extract_screen_size(node: dict) -> tuple[int, int]:
    bounds = node.get("bounds", {})
    w = (bounds.get("right") or 0) - (bounds.get("left") or 0)
    h = (bounds.get("bottom") or 0) - (bounds.get("top") or 0)
    return max(w, 1), max(h, 1)


def compute_layout_hash(ui_tree: dict) -> str:
    """计算页面布局指纹（旧方案，仅保留）。"""
    screen_w, screen_h = _extract_screen_size(ui_tree)
    elements = _collect_interactive_nodes(ui_tree, screen_w, screen_h)
    elements.sort(key=lambda e: (e["grid_y"], e["grid_x"], e["type"]))
    raw = json.dumps(elements, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:64]


_TEXT_NOISE = {
    "确定", "取消", "返回", "更多", "关闭", "完成", "保存",
    "确认", "取消", "OK", "Cancel", "Back", "More", "Close",
    "Done", "Save", "Yes", "No", "是", "否",
}


def _is_noise(text: str) -> bool:
    text = text.strip()
    if len(text) <= 1:
        return True
    if re.match(r"^[\d\s]+$", text):
        return True
    if re.match(r"^https?://", text, re.IGNORECASE):
        return True
    if re.match(r"^\w+\.(com|cn|org|net|io)", text, re.IGNORECASE):
        return True
    if text in _TEXT_NOISE:
        return True
    return False


def _collect_texts(node: dict) -> list[str]:
    texts = []
    for key in ("text", "label", "content", "contentDescription", "hint"):
        val = node.get(key)
        if val and isinstance(val, str) and not _is_noise(val):
            texts.append(val.strip())
    for child in node.get("children", []):
        texts.extend(_collect_texts(child))
    return texts


def compute_text_hash(ui_tree: dict) -> str:
    """计算页面文本指纹（旧方案，仅保留）。"""
    texts = _collect_texts(ui_tree)
    unique = sorted(set(t for t in texts if t))
    raw = "|".join(unique[:50])
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:64]
