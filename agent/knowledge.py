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

    def __init__(self, llm, memory_store, config: AgentConfig):
        self.llm = llm
        self.memory = memory_store
        self.config = config

    def find_feature(self, title: str, steps: list[str],
                     checkpoints: list[str]) -> list[dict]:
        metas = self.memory.list_feature_meta()
        if not metas:
            return []

        features_text = "\n".join(
            f"{i + 1}. 特性: {m.get('name')}（{m.get('feature_id')}）\n"
            f"   所属应用: {m.get('app') or ''}\n"
            f"   概述: {m.get('summary') or ''}"
            for i, m in enumerate(metas)
        )
        prompt = load_prompt("feature_retrieval").format(
            features=features_text,
            title=title,
            steps=json.dumps(steps, ensure_ascii=False),
            checkpoints=json.dumps(checkpoints, ensure_ascii=False),
        )
        try:
            resp = self.llm.invoke(prompt)
            data = json.loads(self._extract_json(str(resp.content)))
            relevant = data.get("relevant_features", [])

            meta_map = {m.get("feature_id"): m for m in metas}
            result = []
            for item in relevant:
                fid = item.get("feature_id")
                if not meta_map.get(fid):
                    continue
                raw = self.memory.get_feature_raw(fid)
                if not raw.strip():
                    continue
                result.append({
                    "feature_id": fid,
                    "reason": item.get("reason", ""),
                    "name": meta_map[fid].get("name", ""),
                    "raw": raw,
                })
            return result
        except Exception:
            return []

    def learn_from_execution(
            self,
            title: str,
            steps: list[str],
            checkpoints: list[str],
            execution: dict,
    ) -> str | None:

        existing_doc = "（无）"
        related = self.find_feature(title, steps, checkpoints)
        if related:
            top = related[0]
            raw = (top.get("raw") or "").strip()
            existing_doc = (
                f"特性: {top.get('name')}（{top.get('feature_id')}）\n"
                f"特性文档全文:\n{raw}"
            ) if raw else "（无）"

        summary = execution.get("summary") or ""
        iterations = execution.get("iterations", 0)
        results_lines = []
        if summary:
            results_lines.append(f"- 执行总结: {summary}")
        results_lines.append(f"- 总轮数: {iterations}")
        results_text = "\n".join(results_lines)

        prompt = load_prompt("feature_learn").format(
            title=title,
            original_steps=json.dumps(steps, ensure_ascii=False),
            expected_results=json.dumps(checkpoints, ensure_ascii=False),
            execution_results=results_text,
            existing_doc=existing_doc,
        )
        try:
            resp = self.llm.invoke(prompt)
            data = json.loads(self._extract_json(str(resp.content)))
            doc = {
                "app": str(data.get("app") or "").strip(),
                "name": str(data.get("feature") or "").strip(),
                "summary": str(data.get("summary") or "").strip(),
                "entries": data.get("entries") or [],
                "preconditions": data.get("preconditions") or [],
                "scenarios": data.get("scenarios") or [],
            }
            if not doc["name"]:
                return None
            return self.memory.learn_feature(doc)
        except Exception:
            return None

    @staticmethod
    def _extract_json(text: str) -> str:
        """从 LLM 回复中提取 JSON 部分。"""

        m = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text)
        if m:
            return m.group(1).strip()

        m = re.search(r"\{[\s\S]*\}", text)
        if m:
            return m.group(0)
        return text
