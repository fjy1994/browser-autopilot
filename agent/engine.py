from __future__ import annotations

import base64
import json
import mimetypes
import os
import re
import time

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_openai import ChatOpenAI

from memory import MemoryStore
from .act import ActionExecutor
from .config import AgentConfig
from .knowledge import KnowledgeService
from .perceive import HypiumStub, Screen
from .prompts import PROMPT_DIR, load_prompt
from .tools import build_tools

DECLARE_ACTIONS = {"finish_case", "report_failure"}

SUMMARY_WINDOW = 8

SUMMARY_BATCH = 4


def _load_system_prompt(memory: MemoryStore) -> str:
    path = PROMPT_DIR / "system.md"
    with open(path, encoding="utf-8") as f:
        base = f.read()

    try:
        metas = memory.list_feature_meta()
    except Exception:
        metas = []

    if metas:
        lines = [f"## 当前特性知识库（共 {len(metas)} 个特性）"]
        for m in metas:
            summary = f" - {m.get('summary')}" if m.get("summary") else ""
            lines.append(f"- {m.get('feature_id')}: {m.get('name')}（{m.get('app') or '未知应用'}）{summary}")
        feature_list = "\n".join(lines)
    else:
        feature_list = "## 当前特性知识库\n（暂无数据）"

    return base + "\n\n" + feature_list


class AgentEngine:

    def __init__(self, config: AgentConfig | None = None):
        self.config = config or AgentConfig.from_env()

        hypium = HypiumStub(
            device_serial=self.config.device_serial,
            resolution=self.config.device_resolution,
        )
        self.screen = Screen(
            hypium=hypium,
            target_width=self.config.screenshot_target_width,
        )
        self.memory = MemoryStore(
            data_dir=self.config.memory_dir or None,
        )
        self.executor = ActionExecutor(hypium=hypium)
        self.llm = self._init_llm()
        self.knowledge = KnowledgeService(self.llm, self.memory, self.config)
        self.tools = build_tools(
            executor=self.executor,
            memory=self.memory,
            config=self.config,
            screen=self.screen,
        )
        self._tool_map = {t.name: t for t in self.tools}
        self._llm_tools = self.llm.bind_tools(self.tools)

    def _init_llm(self):
        """初始化 LLM 客户端。"""
        return ChatOpenAI(
            model=self.config.llm_model,
            base_url=self.config.llm_base_url,
            api_key=self.config.llm_api_key,
            temperature=0.1,
            max_tokens=2048,
        )

    def parse_case_input(self, text: str) -> dict:
        prompt = load_prompt("case_parse").format(user_input=text)
        try:
            data = json.loads(re.search(r"\{[\s\S]*\}", str(self.llm.invoke(prompt).content)).group(0))
            title = str(data.get("title") or "").strip()
            steps = [str(s).strip() for s in (data.get("steps") or []) if str(s).strip()]
            if title and steps:
                checkpoints = [str(s).strip() for s in (data.get("checkpoints") or []) if str(s).strip()]
                return {"title": title, "steps": steps, "checkpoints": checkpoints}
        except Exception:
            pass
        return {"title": "", "steps": [], "checkpoints": []}

    def _invoke_tool(self, name: str, args: dict) -> str:
        fn = self._tool_map.get(name)
        if fn is None:
            return f"未知工具: {name}"
        try:
            return str(fn.invoke(args or {}))
        except Exception as e:
            return f"{name} 调用失败: {e}"

    def _current_screen_image(self) -> str | None:
        screen = self.screen.current
        if screen is None:
            return None
        path = screen.scaled_screenshot_path or screen.screenshot_path
        if not path or not os.path.exists(path):
            return None
        mime = mimetypes.guess_type(path)[0] or "image/png"
        with open(path, "rb") as f:
            return f"data:{mime};base64,{base64.b64encode(f.read()).decode()}"

    def _build_user_prompt(self) -> list:
        image = self._current_screen_image()
        if image:
            return [{"type": "image_url", "image_url": {"url": image}}]
        return [{"type": "text", "text": "（当前无截图）"}]

    def _round_bounds(self, messages: list) -> list[tuple[int, int]]:
        starts = [i for i, message in enumerate(messages)
                  if message.additional_kwargs.get("round_observe")]
        bounds = []
        for i, s in enumerate(starts):
            e = starts[i + 1] if i + 1 < len(starts) else len(messages)
            bounds.append((s, e))
        return bounds

    def _messages_to_text(self, msgs: list) -> str:
        parts = []
        for m in msgs:
            if isinstance(m, SystemMessage):
                parts.append("[旧摘要]\n" + str(m.content))
            elif isinstance(m, HumanMessage):
                if isinstance(m.content, list):
                    text = "".join(
                        b.get("text", "") for b in m.content
                        if isinstance(b, dict) and b.get("type") == "text"
                    )
                else:
                    text = str(m.content)
                parts.append("[执行轮次]\n" + text)
            elif isinstance(m, ToolMessage):
                parts.append("[工具结果]\n" + str(m.content))
            elif isinstance(m, AIMessage):
                text = str(m.content or "").strip()
                calls = "; ".join(
                    f"{tc['name']}({json.dumps(tc.get('args') or {}, ensure_ascii=False)})"
                    for tc in getattr(m, "tool_calls", None) or []
                )
                action = " ".join(x for x in (text, calls) if x).strip()
                parts.append("[模型动作]\n" + action)
        return "\n\n".join(parts)

    def _summarize_old_rounds(self, messages: list,
                              bounds: list[tuple[int, int]], count: int) -> bool:
        start = bounds[0][0]
        end = bounds[count - 1][1]
        batch = messages[start:end]
        old_summary = next(
            (str(m.content) for i, m in enumerate(messages)
             if i > 0 and isinstance(m, SystemMessage)), "")
        prompt = load_prompt("memory_summary").format(
            old_summary=old_summary or "（无）",
            recent_log=self._messages_to_text(batch),
        )
        try:
            new_summary = str(self.llm.invoke(prompt).content).strip()
        except Exception as e:
            print(f"  摘要生成失败，保留原文: {e}")
            return False
        del messages[start:end]
        for i in range(len(messages) - 1, 0, -1):
            if isinstance(messages[i], SystemMessage):
                del messages[i]
        insert_at = 1 if messages and isinstance(messages[0], SystemMessage) else 0
        messages.insert(insert_at, SystemMessage(content=new_summary))
        return True

    def _build_system_prompt(self, title: str, steps: list[str],
                             checkpoints: list[str]) -> str:
        base = _load_system_prompt(self.memory)
        if not (steps or checkpoints):
            return base
        return "\n\n".join([
            base,
            "## 当前用例\n"
            f"标题: {title}\n"
            "步骤:\n" + "\n".join(f"{i + 1}. {s}" for i, s in enumerate(steps))
            + "\n检查点:\n" + "\n".join(f"{i + 1}. {r}" for i, r in enumerate(checkpoints)),
        ])

    def _run_loop(self, title: str, steps: list[str], checkpoints: list[str]) -> dict:
        iterations = 0
        messages: list = [SystemMessage(
            content=self._build_system_prompt(title, steps, checkpoints))]

        while iterations < self.config.max_iterations_per_case:
            iterations += 1
            try:
                self.screen.perceive()
            except Exception as e:
                return {"status": "error", "iterations": iterations,
                        "summary": f"截图失败: {e}"}

            for message in messages:
                if isinstance(message, HumanMessage) and isinstance(message.content, list):
                    message.content = [
                        b for b in message.content
                        if not (isinstance(b, dict) and b.get("type") == "image_url")
                    ]

            user_message = HumanMessage(content=self._build_user_prompt())
            user_message.additional_kwargs["round_observe"] = True
            messages.append(user_message)

            response = None
            for attempt in range(3):
                try:
                    response = self._llm_tools.invoke(messages)
                    break
                except Exception as e:
                    if attempt == 2:
                        return {"status": "error", "iterations": iterations,
                                "summary": str(e)}
                    print(f"  LLM 调用失败，{2 ** (attempt + 1)} 秒后重试: {e}")
                    time.sleep(2 ** (attempt + 1))

            messages.append(response)
            tool_calls = getattr(response, "tool_calls", None) or []

            for tool in tool_calls:
                name, args = tool["name"], tool.get("args") or {}

                if name in DECLARE_ACTIONS:
                    key = "summary" if name == "finish_case" else "reason"
                    text = str(args.get(key) or "").strip() or "（未说明）"
                    return {"status": "completed" if name == "finish_case" else "failed",
                            "iterations": iterations, "summary": text}

                result = self._invoke_tool(name, args)
                messages.append(ToolMessage(
                    content=str(result), tool_call_id=tool.get("id") or ""))

            bounds = self._round_bounds(messages)
            if len(bounds) > SUMMARY_WINDOW:
                self._summarize_old_rounds(messages, bounds, SUMMARY_BATCH)

        return {"status": "failed", "iterations": iterations,
                "summary": f"超过 {self.config.max_iterations_per_case} 轮仍未完成"}

    def run_case(self, title: str, steps: list[str], checkpoints: list[str]) -> dict:
        result = self._run_loop(title, steps, checkpoints)

        status = result["status"]
        summary = result.get("summary") or ""

        print(f"\n执行轮数: {result.get('iterations', 0)}")
        print(f"结果: {status}")

        memory_updated = False
        if status == "completed":
            feature_id = self.knowledge.learn_from_execution(
                title, steps, checkpoints, result
            )
            memory_updated = feature_id is not None

        return {
            "status": status,
            "summary": summary,
            "iterations": result.get("iterations", 0),
            "memory_updated": memory_updated,
        }

    def run_interactive(self, title: str, steps: list[str],
                        checkpoints: list[str]):
        result = self.run_case(title, steps, checkpoints)

        print(f"\n{'=' * 50}")
        print(f"执行完成: {result['status']}（{result.get('iterations', 0)} 轮）")
        if result.get("summary"):
            print(f"总结: {result['summary']}")
        print(f"记忆更新: {'是' if result['memory_updated'] else '否'}")
        print(f"{'=' * 50}")
