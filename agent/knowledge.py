"""
知识模块 —— 特性知识检索 + 执行经验沉淀。

职责:
  1. 检索相关特性知识（执行经验沉淀时参考已有内容，避免重复）
  2. 执行结束后把经验沉淀为特性知识

所有提示词模板见 agent/prompt/*.md。
"""

from __future__ import annotations
import json
import re

from .config import AgentConfig
from .prompts import load_prompt


class KnowledgeService:
    """
    特性知识服务：检索 / 标准化 / 沉淀。
    """

    def __init__(self, llm, memory_store, config: AgentConfig):
        self.llm = llm
        self.memory = memory_store
        self.config = config

    # ── 特性知识检索 ──────────────────────────────────────

    def find_feature(self, title: str, original_steps: list[str],
                     expected_results: list[str]) -> list[dict]:
        """
        从特性知识库中检索与当前用例相关的特性。

        流程（SKILL 式 meta 检索）：
          1. 读取知识库中全部特性的轻量 meta（不加载正文）
          2. 全量 meta 发给 LLM 语义筛选（只返回选中的 feature_id 和理由）
          3. 只对 LLM 选中的特性读取完整 md 原文（raw），不做解析，避免丢失内容
        返回相关特性列表（含 feature_id / reason / raw 全文），按 LLM 给出的顺序。
        """
        metas = self.memory.list_feature_meta()
        if not metas:
            return []

        # 只把轻量 meta 发给 LLM，避免每个特性全文都占用上下文
        features_text = "\n".join(
            f"{i+1}. 特性: {m.get('name')}（{m.get('feature_id')}）\n"
            f"   所属应用: {m.get('app') or ''}\n"
            f"   概述: {m.get('summary') or ''}"
            for i, m in enumerate(metas)
        )
        prompt = load_prompt("feature_retrieval").format(
            features=features_text,
            title=title,
            steps=json.dumps(original_steps, ensure_ascii=False),
            expected_results=json.dumps(expected_results, ensure_ascii=False),
        )
        try:
            resp = self.llm.invoke(prompt)
            data = json.loads(self._extract_json(resp.content))
            relevant = data.get("relevant_features", [])

            meta_map = {m.get("feature_id"): m for m in metas}
            result = []
            for item in relevant:
                fid = item.get("feature_id")
                if not meta_map.get(fid):
                    continue  # LLM 编造了清单外的 id，忽略
                raw = self.memory.get_feature_raw(fid)
                if not raw.strip():
                    continue  # 文件不存在或为空，跳过
                result.append({
                    "feature_id": fid,
                    "reason": item.get("reason", ""),
                    "name": meta_map[fid].get("name", ""),
                    "raw": raw,  # 特性文件全文，下游直接使用，不再结构化提取
                })
            return result
        except Exception as e:
            print(f"  [Warning] LLM 特性检索失败: {e}")
            return []

    # ── 执行经验沉淀 ──────────────────────────────────────

    def learn_from_execution(
        self,
        title: str,
        original_steps: list[str],
        expected_results: list[str],
        execution: dict,
    ) -> str | None:
        """
        执行结束后，把可复用的经验沉淀为特性知识（由 LLM 归类）。

        execution 为引擎返回的执行结果，包含:
          - progress: LLM 通过 mark_progress 声明的已完成目标列表
          - summary:  完成总结
          - iterations: 总轮数
        返回特性标识 feature_id；失败（LLM 不可用/解析失败）返回 None。
        """
        # 检索可能相关的已有特性，把内容给 LLM 参考，避免重复沉淀
        existing_doc = "（无）"
        related = self.find_feature(title, original_steps, expected_results)
        if related:
            top = related[0]
            raw = (top.get("raw") or "").strip()
            existing_doc = (
                f"特性: {top.get('name')}（{top.get('feature_id')}）\n"
                f"特性文档全文:\n{raw}"
            ) if raw else "（无）"

        progress = execution.get("progress") or []
        summary = execution.get("summary") or ""
        iterations = execution.get("iterations", 0)
        results_lines = [f"- 已完成目标: {p}" for p in progress] or ["- 无"]
        if summary:
            results_lines.append(f"- 执行总结: {summary}")
        results_lines.append(f"- 总轮数: {iterations}")
        results_text = "\n".join(results_lines)

        prompt = load_prompt("feature_learn").format(
            title=title,
            original_steps=json.dumps(original_steps, ensure_ascii=False),
            expected_results=json.dumps(expected_results, ensure_ascii=False),
            execution_results=results_text,
            existing_doc=existing_doc,
        )
        try:
            resp = self.llm.invoke(prompt)
            data = json.loads(self._extract_json(resp.content))
            doc = {
                "app": str(data.get("app") or "").strip(),
                "name": str(data.get("feature") or "").strip(),
                "summary": str(data.get("summary") or "").strip(),
                "entries": data.get("entries") or [],
                "preconditions": data.get("preconditions") or [],
                "scenarios": data.get("scenarios") or [],
            }
            if not doc["name"]:
                print("  [Warning] LLM 未给出特性名，跳过沉淀")
                return None
            feature_id = self.memory.learn_feature(doc)
            print(f"  [Agent] 经验已沉淀到特性: {feature_id}")
            return feature_id
        except Exception as e:
            print(f"  [Warning] 特性沉淀失败: {e}")
            return None

    # ── 辅助 ─────────────────────────────────────────────

    @staticmethod
    def _extract_json(text: str) -> str:
        """从 LLM 回复中提取 JSON 部分。"""
        # 尝试找 ```json ... ```
        m = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text)
        if m:
            return m.group(1).strip()
        # 尝试找 { ... }
        m = re.search(r"\{[\s\S]*\}", text)
        if m:
            return m.group(0)
        return text
