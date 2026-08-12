"""
数据结构与 Markdown 文档的解析/渲染。

纯 Python 标准库。页面与特性都以 .md 文件存储，机器可解析、人可阅读。
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

# ── 类型别名（保持外部 import 兼容） ──────────────────────

# 页面文档
#   {
#     "name": str,             # 页面名（Markdown 标题）
#     "app": str,              # 所属应用目录名
#     "description": str,      # 页面描述
#     "signature": str,        # 规范化签名 "type|id; type|id"
#     "elements": {            # 元素经验：id -> 经验
#         resource_id: {
#             "type": str, "action": str,
#             "leads_to": str,   # 目标页面标识，如 "weather_app/city_search.md"
#             "note": str,
#         }
#     },
#   }
PageCluster = dict

# 特性文档
#   {
#     "name": str,               # 特性名（Markdown 标题），如 "清理缓存"
#     "app": str,                # 所属应用目录名，如 "浏览器"
#     "summary": str,            # 特性概述
#     "entries": list[str],      # 入口（进入该功能的操作路径）
#     "preconditions": list[str],# 前置操作（执行前需要满足的条件）
#     "scenarios": [             # 场景列表（核心单元）
#       {"name": str,            #   场景名，如 "清理浏览数据"
#        "steps": list[str],     #   操作步骤（已验证）
#        "verifications": list[str]},  # 验证要点
#     ],
#     "updated_at": str,         # 最后更新时间
#   }
FeatureDoc = dict

# 跳转图
#   {page_id: {"from": list[str], "to": list[str]}}
JumpGraph = dict


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _clean_line(s: str) -> str:
    return s.strip().strip("`").strip()


# ── 页面文档 ──────────────────────────────────────────────

def render_page_doc(doc: dict) -> str:
    """把页面文档渲染为 Markdown。"""
    lines: list[str] = []
    lines.append(f"# {doc.get('name') or '未命名页面'}")
    lines.append("")
    lines.append(f"> 所属应用: {doc.get('app') or ''}")
    if doc.get("description"):
        lines.append(f"> 页面描述: {doc['description']}")
    lines.append("")

    # 签名表格
    lines.append("## 签名")
    lines.append("")
    lines.append("| # | resource_id | type |")
    lines.append("|---|-------------|------|")
    sig = doc.get("signature") or ""
    for i, part in enumerate(_signature_parts(sig), 1):
        type_name, _, rid = part.partition("|")
        lines.append(f"| {i} | {rid} | {type_name} |")
    lines.append("")

    # 元素经验
    lines.append("## 元素经验")
    lines.append("")
    elements = doc.get("elements") or {}
    if not elements:
        lines.append("（暂无元素经验，等待执行后补充）")
        lines.append("")
    for rid, ek in sorted(elements.items()):
        lines.append(f"### {rid} ({ek.get('type') or 'unknown'})")
        lines.append(f"- 操作: {ek.get('action') or 'click'}")
        if ek.get("leads_to"):
            lines.append(f"- 跳转: {ek['leads_to']}")
        if ek.get("note"):
            lines.append(f"- 说明: {ek['note']}")
        lines.append("")

    # 跳转关系（从元素经验聚合，纯展示）
    lines.append("## 跳转关系")
    lines.append("")
    targets: dict[str, list[str]] = {}
    for rid, ek in sorted(elements.items()):
        lt = ek.get("leads_to")
        if lt:
            targets.setdefault(lt, []).append(rid)
    if targets:
        for lt, rids in sorted(targets.items()):
            via = "、".join(rids)
            lines.append(f"- → [{lt}]({lt})：通过 {via} 进入")
    else:
        lines.append("（暂无已知跳转）")
    lines.append("")

    return "\n".join(lines)


def _signature_parts(sig: str) -> list[str]:
    if not sig:
        return []
    return [p.strip() for p in sig.split(";") if p.strip()]


def parse_page_doc(text: str) -> dict:
    """解析页面 Markdown 为页面文档 dict。"""
    doc: dict = {
        "name": "",
        "app": "",
        "description": "",
        "signature": "",
        "elements": {},
    }
    if not text:
        return doc

    lines = text.splitlines()
    section = ""
    cur_rid: str | None = None
    sig_parts: list[str] = []

    for raw in lines:
        line = raw.strip()
        if line.startswith("# ") and not line.startswith("## "):
            doc["name"] = _clean_line(line[2:])
        elif line.startswith("> 所属应用"):
            doc["app"] = _clean_line(line.split(":", 1)[1])
        elif line.startswith("> 页面描述"):
            doc["description"] = _clean_line(line.split(":", 1)[1])
        elif line.startswith("## 签名"):
            section = "signature"
            cur_rid = None
            continue
        elif line.startswith("## 元素经验"):
            section = "elements"
            cur_rid = None
            continue
        elif line.startswith("## 跳转关系"):
            section = "jump"  # 自动生成，不解析
            cur_rid = None
            continue
        elif line.startswith("### "):
            # ### id (type)
            header = line[4:].strip()
            m = re.match(r"^(.*?)\s*\(([^)]*)\)\s*$", header)
            if m:
                cur_rid = m.group(1).strip()
                etype = m.group(2).strip() or "unknown"
            else:
                cur_rid = header
                etype = "unknown"
            doc["elements"].setdefault(cur_rid, {
                "type": etype, "action": "click", "leads_to": "", "note": "",
            })
            continue

        if section == "signature" and line.startswith("|") and not line.startswith("|---") and not line.startswith("| #"):
            cells = [c.strip() for c in line.strip("|").split("|")]
            if len(cells) >= 3:
                # 最后两列: resource_id | type
                rid, etype = cells[-2], cells[-1]
                if rid and rid != "resource_id":
                    sig_parts.append(f"{etype}|{rid}")
        elif section == "elements" and cur_rid and line.startswith("- "):
            key, _, val = line[2:].partition(":")
            key = key.strip()
            val = val.strip()
            ek = doc["elements"].setdefault(cur_rid, {
                "type": "unknown", "action": "click", "leads_to": "", "note": "",
            })
            if key == "操作":
                ek["action"] = val or "click"
            elif key == "跳转":
                ek["leads_to"] = val
            elif key == "说明":
                ek["note"] = val

    doc["signature"] = "; ".join(sig_parts)
    return doc


# ── 特性文档 ──────────────────────────────────────────────

def parse_frontmatter(text: str) -> dict:
    """解析特性文件头部的 YAML frontmatter（轻量 meta）。

    不依赖外部 yaml 库，支持两种形式：
      key: value
      key:
        - item1
        - item2
    文件不以 `---` 开头时返回空 dict。
    """
    meta: dict = {}
    if not text:
        return meta
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return meta
    idx = 1
    while idx < len(lines) and lines[idx].strip() != "---":
        idx += 1
    if idx >= len(lines):
        return meta

    current_key: str | None = None
    for raw in lines[1:idx]:
        line = raw.rstrip()
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        # 列表项挂在当前 key 下
        if stripped.startswith("- ") and current_key:
            meta.setdefault(current_key, []).append(_clean_line(stripped[2:]))
            continue
        if ":" in line:
            key, _, value = line.partition(":")
            key = key.strip()
            value = value.strip()
            if not key:
                continue
            current_key = key
            meta[key] = _clean_line(value) if value else []
    return meta


def render_feature_meta(doc: dict) -> str:
    """渲染特性文件的 frontmatter（轻量 meta，检索时只读头部即可）。"""
    lines = ["---"]
    lines.append(f"name: {doc.get('name') or '未命名特性'}")
    lines.append(f"app: {doc.get('app') or ''}")
    summary = (doc.get("summary") or "").replace("\n", " ")
    lines.append(f"summary: {summary}")
    lines.append("---")
    lines.append("")
    return "\n".join(lines)


def render_feature_doc(doc: dict) -> str:
    """把特性文档渲染为 Markdown。

    结构：frontmatter（meta）→ 标题 → 概述 → 入口 → 前置操作 → 场景（操作步骤 + 验证要点）。
    场景是核心单元，一个特性下可以有多个场景。
    """
    lines: list[str] = []
    lines.append(render_feature_meta(doc))
    lines.append(f"# {doc.get('name') or '未命名特性'}")
    lines.append("")
    lines.append(f"> 所属应用: {doc.get('app') or ''}")
    if doc.get("updated_at"):
        lines.append(f"> 更新: {doc['updated_at']}")
    lines.append("")

    # 概述
    lines.append("## 概述")
    lines.append("")
    lines.append(doc.get("summary") or "（暂无概述）")
    lines.append("")

    # 入口
    lines.append("## 入口")
    lines.append("")
    entries = doc.get("entries") or []
    if entries:
        for e in entries:
            lines.append(f"- {e}")
    else:
        lines.append("（暂无入口信息）")
    lines.append("")

    # 前置操作
    lines.append("## 前置操作")
    lines.append("")
    pre = doc.get("preconditions") or []
    if pre:
        for p in pre:
            lines.append(f"- {p}")
    else:
        lines.append("（暂无前置条件）")
    lines.append("")

    # 场景
    scenarios = doc.get("scenarios") or []
    if not scenarios:
        lines.append("## 场景")
        lines.append("")
        lines.append("（暂无已验证场景）")
        lines.append("")
    for sc in scenarios:
        lines.append(f"## 场景：{sc.get('name') or '未命名场景'}")
        lines.append("")
        lines.append("### 操作步骤")
        lines.append("")
        steps = sc.get("steps") or []
        if steps:
            for i, s in enumerate(steps, 1):
                lines.append(f"{i}. {s}")
        else:
            lines.append("（暂无操作步骤）")
        lines.append("")
        lines.append("### 验证要点")
        lines.append("")
        verifications = sc.get("verifications") or []
        if verifications:
            for v in verifications:
                lines.append(f"- {v}")
        else:
            lines.append("（暂无验证要点）")
        lines.append("")

    return "\n".join(lines)


def parse_feature_doc(text: str) -> dict:
    """解析特性 Markdown 为特性文档 dict。"""
    doc: dict = {
        "name": "",
        "app": "",
        "summary": "",
        "entries": [],
        "preconditions": [],
        "scenarios": [],
        "updated_at": "",
    }
    if not text:
        return doc

    lines = text.splitlines()
    section = ""            # summary / entries / preconditions / scenario / ""
    cur_scenario: dict | None = None
    sub_section = ""        # steps / verifications

    def _flush_scenario() -> None:
        nonlocal cur_scenario
        if cur_scenario is not None:
            doc["scenarios"].append(cur_scenario)
            cur_scenario = None

    for raw in lines:
        line = raw.strip()
        if line.startswith("# ") and not line.startswith("## ") and not line.startswith("### "):
            doc["name"] = _clean_line(line[2:])
        elif line.startswith("> 所属应用"):
            doc["app"] = _clean_line(line.split(":", 1)[1])
        elif line.startswith("> 更新"):
            doc["updated_at"] = _clean_line(line.split(":", 1)[1])
        elif line.startswith("## 概述"):
            _flush_scenario()
            section, sub_section = "summary", ""
            continue
        elif line.startswith("## 入口"):
            _flush_scenario()
            section, sub_section = "entries", ""
            continue
        elif line.startswith("## 前置操作"):
            _flush_scenario()
            section, sub_section = "preconditions", ""
            continue
        elif line.startswith("## 场景"):
            _flush_scenario()
            section = "scenario"
            name = _clean_line(line[2:].split("：", 1)[-1])
            cur_scenario = {"name": name, "steps": [], "verifications": []}
            sub_section = ""
            continue
        elif line.startswith("### 操作步骤"):
            section = "scenario"
            sub_section = "steps"
            continue
        elif line.startswith("### 验证要点"):
            section = "scenario"
            sub_section = "verifications"
            continue
        elif line.startswith("#"):
            _flush_scenario()
            section, sub_section = "", ""
            continue

        if not line:
            continue

        if section == "summary":
            if doc["summary"]:
                doc["summary"] += " " + line
            else:
                doc["summary"] = line
        elif section == "entries" and line.startswith("- "):
            doc["entries"].append(line[2:].strip())
        elif section == "preconditions" and line.startswith("- "):
            doc["preconditions"].append(line[2:].strip())
        elif section == "scenario" and cur_scenario is not None:
            if sub_section == "steps":
                m = re.match(r"^\d+\.\s*(.*)$", line)
                if m:
                    cur_scenario["steps"].append(m.group(1).strip())
            elif sub_section == "verifications" and line.startswith("- "):
                cur_scenario["verifications"].append(line[2:].strip())

    _flush_scenario()
    return doc


# ── 兼容辅助 ──────────────────────────────────────────────

def empty_feature_doc(name: str, app: str) -> FeatureDoc:
    """创建一个空的特性文档骨架。"""
    return {
        "name": name,
        "app": app,
        "summary": "",
        "entries": [],
        "preconditions": [],
        "scenarios": [],
        "updated_at": _now_iso(),
    }
