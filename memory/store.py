"""
页面与特性记忆存储 —— 纯文档文件系统。

数据目录结构（默认 <项目>/data/memory/）：

    data_dir/
    ├── README.md            # 维护说明（自动生成）
    ├── pages/               # 页面知识
    │   ├── <app>/<页面>.md  # 按 App 分层，一页一文件
    │   └── common/          # 跨 App 公共页面
    ├── features/            # 特性知识
    │   ├── <app>/<特性>.md  # 按 App 分层，一特性一文件
    │   └── ...
    └── JUMP_GRAPH.md        # 全库跳转关系总览（自动生成）

设计原则：
- 页面记忆：一页一文件，Markdown 纯文本，人和 LLM 都能直接读改。
- 特性记忆：一特性一文件，按"应用 → 功能"组织，记录该功能如何操作、如何验证；
  场景是核心单元（操作步骤 + 验证要点），不按用例分割，由执行经验持续增补。
- 签名 = 有效区域内全部有 id 节点的 (type, resource_id) 集合，完全一致才命中。
- query 严格匹配（查不含糊）；learn 命中则更新已有页面，未命中才新建。
- 页面标识（page_id）= 相对 pages/ 的路径，如 "weather_app/home.md"。
- 特性标识（feature_id）= 相对 features/ 的路径，如 "浏览器/清理缓存.md"。
- 特性归类由 LLM 决策（见 agent/prompt/feature_learn.md），本层只负责读写。
"""

from __future__ import annotations

import os
import re
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

from .fingerprint import compute_page_signature
from .models import (
    empty_feature_doc,
    parse_feature_doc,
    parse_frontmatter,
    parse_page_doc,
    render_feature_doc,
    render_page_doc,
)

_PACKAGE_KEYS = ("package", "packageName", "bundle", "bundleName", "appId", "applicationId")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _sanitize(name: str, fallback: str = "untitled") -> str:
    """把任意字符串转成安全的文件名片段。"""
    name = unicodedata.normalize("NFKC", name or "").strip()
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "", name)
    name = re.sub(r"\s+", " ", name)
    name = name.strip(" .")
    return name[:60] or fallback


def _detect_app(ui_tree: dict | None) -> str:
    """从 UI 树中探测应用标识。"""
    if not isinstance(ui_tree, dict):
        return ""
    stack = [ui_tree]
    while stack:
        node = stack.pop()
        for k in _PACKAGE_KEYS:
            v = node.get(k)
            if v and isinstance(v, str) and v.strip():
                return v.strip()
        stack.extend(node.get("children") or [])
    return ""


class MemoryStore:
    """文档文件系统版页面 + 特性记忆。"""

    def __init__(self, data_dir: str | None = None, app_name: str = ""):
        if data_dir:
            base = Path(data_dir).expanduser().resolve()
            # 若传入的是通用 data 目录，则在其下建 memory/ 子目录
            if base.name.lower() != "memory":
                base = base / "memory"
        else:
            base = Path(__file__).resolve().parent.parent / "data" / "memory"
        self.root = base
        self.pages_root = base / "pages"
        self.features_root = base / "features"
        self.app_name = app_name
        self._sig_index: dict[str, str] | None = None  # signature -> page_id

        self.pages_root.mkdir(parents=True, exist_ok=True)
        self.features_root.mkdir(parents=True, exist_ok=True)
        self._ensure_readme()

    # ── 路径工具 ──────────────────────────────────────────

    def _page_abs(self, page_id: str) -> Path:
        # 防止路径逃逸
        rel = Path(page_id)
        if rel.is_absolute() or ".." in rel.parts:
            raise ValueError(f"非法页面标识: {page_id!r}")
        return self.pages_root / rel

    def _feature_abs(self, feature_id: str) -> Path:
        # 防止路径逃逸
        rel = Path(feature_id)
        if rel.is_absolute() or ".." in rel.parts:
            raise ValueError(f"非法特性标识: {feature_id!r}")
        return self.features_root / rel

    def _list_page_files(self) -> list[Path]:
        return sorted(
            p for p in self.pages_root.rglob("*.md") if p.is_file()
        )

    def _list_feature_files(self) -> list[Path]:
        return sorted(
            p for p in self.features_root.rglob("*.md") if p.is_file()
        )

    # ── 签名索引 ──────────────────────────────────────────

    def _rebuild_index(self) -> dict[str, str]:
        index: dict[str, str] = {}
        for p in self._list_page_files():
            try:
                doc = parse_page_doc(p.read_text(encoding="utf-8"))
            except Exception:
                continue
            sig = doc.get("signature") or ""
            if sig:
                index[sig] = p.relative_to(self.pages_root).as_posix()
        self._sig_index = index
        return index

    def _find_by_signature(self, sig: str) -> str | None:
        if not sig:
            return None
        if self._sig_index is None:
            self._rebuild_index()
        hit = self._sig_index.get(sig)
        if hit is not None:
            return hit
        # 索引陈旧（外部手工编辑过）时重建一次再查
        self._rebuild_index()
        return self._sig_index.get(sig)

    # ── 页面读写 ──────────────────────────────────────────

    def _read_page(self, page_id: str) -> dict:
        p = self._page_abs(page_id)
        if not p.is_file():
            return {"name": "", "app": "", "description": "", "signature": "", "elements": {}}
        return parse_page_doc(p.read_text(encoding="utf-8"))

    def _write_page(self, page_id: str, doc: dict) -> None:
        p = self._page_abs(page_id)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(render_page_doc(doc), encoding="utf-8")

    # ── 特性读写 ──────────────────────────────────────────

    def _read_feature(self, feature_id: str) -> dict:
        p = self._feature_abs(feature_id)
        if not p.is_file():
            return empty_feature_doc(_sanitize(Path(feature_id).stem, "untitled"), "")
        return parse_feature_doc(p.read_text(encoding="utf-8"))

    def _write_feature(self, feature_id: str, doc: dict) -> None:
        p = self._feature_abs(feature_id)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(render_feature_doc(doc), encoding="utf-8")

    def get_feature_raw(self, feature_id: str) -> str:
        """直接返回特性 Markdown 文件原文（不做任何解析），文件不存在时返回空串。"""
        p = self._feature_abs(feature_id)
        if not p.is_file():
            return ""
        return p.read_text(encoding="utf-8")

    # ── 查询 ──────────────────────────────────────────────

    def query(self, ui_tree: dict, app_version: str = "", valid_region: dict | None = None) -> dict:
        """
        按签名查询页面。

        返回:
          matched: bool
          page_id / page_name / cluster_desc / signature / version
          elements: {resource_id: {"action", "leads_to_cluster", "type"}}（引擎兼容）
        """
        sig = compute_page_signature(ui_tree, valid_region)
        page_id = self._find_by_signature(sig)
        if page_id is None:
            return {
                "matched": False,
                "page_id": None,
                "page_name": None,
                "cluster_desc": None,
                "signature": sig,
                "version": app_version,
                "elements": None,
            }
        doc = self._read_page(page_id)
        elements = {
            rid: {
                "action": ek.get("action") or "click",
                "leads_to_cluster": ek.get("leads_to") or "",
                "type": ek.get("type") or "",
            }
            for rid, ek in (doc.get("elements") or {}).items()
        }
        return {
            "matched": True,
            "page_id": page_id,
            "page_name": doc.get("name") or "",
            "cluster_desc": doc.get("description") or "",
            "signature": sig,
            "version": app_version,
            "elements": elements,
        }

    # ── 学习 ──────────────────────────────────────────────

    def learn(
        self,
        ui_tree: dict,
        app_version: str = "",
        explored_elements: dict | None = None,
        page_name: str = "",
        description: str = "",
        valid_region: dict | None = None,
        app_name: str = "",
    ) -> str:
        """
        学习一个页面。签名命中则更新已有页面文件，未命中则新建。

        explored_elements: {resource_id: {"type","action","leads_to","note"}}
        返回页面标识 page_id（如 "weather_app/home.md"）。
        """
        sig = compute_page_signature(ui_tree, valid_region)
        app = app_name or self.app_name or _detect_app(ui_tree) or "unknown_app"
        app = _sanitize(app, "unknown_app")

        page_id = self._find_by_signature(sig)
        if page_id is not None:
            doc = self._read_page(page_id)
        else:
            name = _sanitize(page_name) or self._auto_page_name(sig)
            page_id = self._new_page_id(app, name)
            doc = {
                "name": name,
                "app": app,
                "description": description or "",
                "signature": sig,
                "elements": {},
            }

        # 合并元素经验（只覆盖非空字段，保留既有信息）
        for rid, ek in (explored_elements or {}).items():
            rid = str(rid).strip()
            if not rid:
                continue
            base = doc["elements"].setdefault(rid, {
                "type": "", "action": "click", "leads_to": "", "note": "",
            })
            if ek.get("type"):
                base["type"] = ek["type"]
            if ek.get("action"):
                base["action"] = ek["action"]
            if ek.get("leads_to"):
                base["leads_to"] = ek["leads_to"]
            if ek.get("note"):
                base["note"] = ek["note"]

        self._write_page(page_id, doc)
        if self._sig_index is not None:
            self._sig_index[sig] = page_id
        self._refresh_jump_graph()
        return page_id

    def _auto_page_name(self, sig: str) -> str:
        """无页面名时的自动命名：取第一个有意义的 id。"""
        for part in sig.split(";")[:3]:
            _, _, rid = part.partition("|")
            rid = rid.strip()
            if rid:
                return f"page_{rid}"
        return "page_unknown"

    def _new_page_id(self, app: str, name: str) -> str:
        """生成不重名的页面标识。"""
        base = f"{app}/{name}.md"
        candidate = base
        n = 2
        while (self.pages_root / candidate).exists() or candidate in (self._sig_index or {}).values():
            candidate = f"{app}/{name}_{n}.md"
            n += 1
        return candidate

    # ── 特性知识 ──────────────────────────────────────────

    def learn_feature(self, doc: dict) -> str:
        """
        保存/更新一个特性文件（按 app/特性名 定位，不存在则新建）。

        doc 至少包含 name / app，其余字段见 FeatureDoc。
        返回特性标识 feature_id（如 "浏览器/清理缓存.md"）。
        """
        app = _sanitize(doc.get("app") or self.app_name or "unknown_app", "unknown_app")
        name = _sanitize(doc.get("name") or "untitled", "untitled")
        feature_id = f"{app}/{name}.md"

        existing = self._read_feature(feature_id)
        merged = self._merge_feature(existing, doc)
        merged["updated_at"] = _now_iso()
        self._write_feature(feature_id, merged)
        return feature_id

    @staticmethod
    def _merge_feature(existing: dict, incoming: dict) -> dict:
        """合并特性文档：入口/前置/概述增量合并，场景按名称去重合并（新内容覆盖旧内容）。"""
        out = dict(existing)
        if incoming.get("name"):
            out["name"] = incoming["name"]
        if incoming.get("app"):
            out["app"] = incoming["app"]
        if incoming.get("summary"):
            out["summary"] = incoming["summary"]

        for key in ("entries", "preconditions"):
            base = [x.strip() for x in out.get(key) or [] if str(x).strip()]
            for item in incoming.get(key) or []:
                item = str(item).strip()
                if item and item not in base:
                    base.append(item)
            out[key] = base

        # 场景按名称合并
        scenarios = {sc.get("name"): sc for sc in (out.get("scenarios") or []) if sc.get("name")}
        for sc in incoming.get("scenarios") or []:
            name = sc.get("name")
            if not name:
                continue
            prev = scenarios.get(name)
            if prev is None:
                scenarios[name] = {
                    "name": name,
                    "steps": [s for s in sc.get("steps") or [] if str(s).strip()],
                    "verifications": [v for v in sc.get("verifications") or [] if str(v).strip()],
                }
                continue
            # 合并步骤/验证（去重，新内容覆盖）
            steps = [s for s in prev.get("steps") or [] if str(s).strip()]
            for s in sc.get("steps") or []:
                s = str(s).strip()
                if s and s not in steps:
                    steps.append(s)
            verifications = [v for v in prev.get("verifications") or [] if str(v).strip()]
            for v in sc.get("verifications") or []:
                v = str(v).strip()
                if v and v not in verifications:
                    verifications.append(v)
            scenarios[name] = {"name": name, "steps": steps, "verifications": verifications}
        out["scenarios"] = list(scenarios.values())
        return out

    # ── 特性知识检索（SKILL 式 meta 检索） ────────────────

    def list_feature_meta(self) -> list[dict]:
        """
        列出知识库中全部特性的轻量 meta（不加载正文）。

        每个特性只含 feature_id / name / app / summary，
        供 LLM 全量浏览后决策加载哪些特性（类似 SKILL 的 meta 检索方式）。
        """
        metas: list[dict] = []
        for p in self._list_feature_files():
            try:
                text = p.read_text(encoding="utf-8")
            except Exception:
                continue
            meta = parse_frontmatter(text)
            if not meta.get("name"):
                # 兼容无 frontmatter 的旧文件/手写文件：正文解析取轻量字段
                try:
                    doc = parse_feature_doc(text)
                except Exception:
                    continue
                if not doc.get("name"):
                    continue
                meta = {
                    "name": doc.get("name") or "",
                    "app": doc.get("app") or "",
                    "summary": doc.get("summary") or "",
                }
            metas.append({
                "feature_id": p.relative_to(self.features_root).as_posix(),
                "name": meta.get("name") or "",
                "app": meta.get("app") or "",
                "summary": meta.get("summary") or "",
            })
        metas.sort(key=lambda m: m.get("feature_id", ""))
        return metas

    def get_feature(self, feature_id: str) -> dict:
        """读取完整特性文档（LLM 选中相关特性后再加载全文）。"""
        return self._read_feature(feature_id)

    def list_features(self) -> list[dict]:
        """列出全部特性：feature_id / name / app / summary / 场景数。"""
        out = []
        for p in self._list_feature_files():
            doc = parse_feature_doc(p.read_text(encoding="utf-8"))
            out.append({
                "feature_id": p.relative_to(self.features_root).as_posix(),
                "name": doc.get("name") or "",
                "app": doc.get("app") or "",
                "summary": doc.get("summary") or "",
                "scenario_count": len(doc.get("scenarios") or []),
            })
        return out

    # ── 跳转图总览 ────────────────────────────────────────

    def build_jump_graph(self) -> dict:
        """扫描全部页面文件，聚合跳转关系。"""
        graph: dict[str, dict] = {}
        for p in self._list_page_files():
            page_id = p.relative_to(self.pages_root).as_posix()
            graph.setdefault(page_id, {"from": [], "to": []})
            doc = parse_page_doc(p.read_text(encoding="utf-8"))
            for ek in (doc.get("elements") or {}).values():
                lt = (ek.get("leads_to") or "").strip()
                if lt:
                    graph.setdefault(lt, {"from": [], "to": []})
                    if page_id not in graph[lt]["from"]:
                        graph[lt]["from"].append(page_id)
                    if lt not in graph[page_id]["to"]:
                        graph[page_id]["to"].append(lt)
        return graph

    def _render_jump_graph(self) -> str:
        graph = self.build_jump_graph()
        lines = ["# 页面跳转关系总览", ""]
        lines.append("> 本文件由系统自动生成（learn 时刷新），也可手动编辑。")
        lines.append("")
        if not graph:
            lines.append("（暂无页面）")
            return "\n".join(lines) + "\n"
        for page_id in sorted(graph):
            g = graph[page_id]
            lines.append(f"## {page_id}")
            lines.append("")
            if g["to"]:
                lines.append("- 跳向:")
                for t in sorted(g["to"]):
                    lines.append(f"  - [{t}]({t})")
            else:
                lines.append("- 跳向: （暂无）")
            if g["from"]:
                lines.append("- 被跳入:")
                for f in sorted(g["from"]):
                    lines.append(f"  - [{f}]({f})")
            else:
                lines.append("- 被跳入: （暂无）")
            lines.append("")
        return "\n".join(lines)

    def _refresh_jump_graph(self) -> None:
        (self.root / "JUMP_GRAPH.md").write_text(self._render_jump_graph(), encoding="utf-8")

    # ── 维护 ──────────────────────────────────────────────

    def _ensure_readme(self) -> None:
        readme = self.root / "README.md"
        if readme.exists():
            return
        readme.write_text(_README_TEXT, encoding="utf-8")

    def flush(self) -> None:
        """刷新跳转图总览。"""
        self._refresh_jump_graph()

    # ── 查看 ──────────────────────────────────────────────

    def list_pages(self) -> list[dict]:
        """列出全部页面：page_id / name / app / description / 元素数。"""
        out = []
        for p in self._list_page_files():
            doc = parse_page_doc(p.read_text(encoding="utf-8"))
            out.append({
                "page_id": p.relative_to(self.pages_root).as_posix(),
                "name": doc.get("name") or "",
                "app": doc.get("app") or "",
                "description": doc.get("description") or "",
                "element_count": len(doc.get("elements") or {}),
            })
        return out

    def stats(self) -> dict:
        """概览统计（仅用于维护检查，不做匹配依据）。"""
        pages = self.list_pages()
        features = self.list_features()
        return {
            "pages": len(pages),
            "features": len(features),
            "data_dir": str(self.root),
        }


_README_TEXT = """# 页面与特性记忆数据目录

本目录由自动化 Agent 的记忆系统维护，**一页一文件、一特性一文件**，
Markdown 纯文本，人和 LLM 都可以直接阅读、修改、删除。

## 目录结构

    README.md            本说明
    pages/               页面知识
      <app>/<页面>.md    按 App 分层，一页一文件
      common/            跨 App 公共页面（如权限弹窗）
    features/            特性知识
      <app>/<特性>.md    按 App 分层，一特性一文件
    JUMP_GRAPH.md        全库跳转关系总览（learn 时自动刷新）

## 页面文件格式

    # 天气首页
    > 所属应用: weather_app
    > 页面描述: 天气首页

    ## 签名

    | # | resource_id | type |
    |---|-------------|------|
    | 1 | search_box  | EditText |

    ## 元素经验

    ### search_box (EditText)
    - 操作: click
    - 跳转: weather_app/city_search.md
    - 说明: 点击进入城市搜索页

    ## 跳转关系

    - → [weather_app/city_search.md](weather_app/city_search.md)：通过 search_box 进入

## 特性文件格式

    # 清理缓存
    > 所属应用: 浏览器
    > 更新: 2026-08-12T...

    ## 概述
    清理浏览数据、Cookie 等缓存内容。

    ## 入口
    - 设置 → 隐私 → 清理缓存

    ## 前置操作
    - 需先登录浏览器账户

    ## 场景：清理浏览数据

    ### 操作步骤
    1. 打开设置页
    2. 进入隐私中心
    3. 点击"清理浏览数据"

    ### 验证要点
    - 缓存大小归零
    - 重新加载页面无异常

特性文件记录"该功能如何操作、如何验证"，场景是核心单元，
不按用例分割；新用例执行后由 LLM 决定沉淀到哪个特性文件。

## 签名规则（重要）

- 签名 = 有效区域内全部**有 id** 节点的 (type, resource_id) 集合，完全一致才命中。
- 有效区域由 LLM 对截图裁剪：去除状态栏、任务栏、广告浮层等噪声。
- 无 id 的节点不参与签名；文本、坐标一律不参与。
- 匹配是严格完全一致，不存在相似度/阈值。误判代价高于多建一页。

## 人工维护

- **新建页面**：在 pages/<app>/ 下新建 <页面名>.md，按上面格式填写；
  签名表格要与真实页面（id 集合）完全一致，否则无法命中。
- **修改元素经验**：直接编辑对应页面文件的「元素经验」小节。
- **跳转关系**：在元素经验的「跳转」行写目标页面标识（相对 pages/ 的路径），
  全库总览 JUMP_GRAPH.md 会自动重新生成。
- **新建/修改特性**：直接编辑 features/<app>/<特性>.md，
  增删「场景」小节即可；系统会自动合并同名场景。
- **公共页面**：放 pages/common/ 下。
- 系统重启/首次查询时会自动扫描重建签名索引，手工改动无需额外操作。
"""

# ── 顶层便捷函数 ─────────────────────────────────────────

def open_memory(data_dir: str | None = None) -> MemoryStore:
    return MemoryStore(data_dir=data_dir)
