"""
Agent 执行引擎 —— 引擎驱动的感知-决策-执行循环（连续用例模式）。

架构:
  整个用例作为一段连续任务执行，不按步骤编号逐条驱动（原始步骤可能模糊，
  编号没有执行约束意义）：
    1. 引擎自动截屏，把「上一步执行结果 + 执行记录 + 当前屏幕状态 + 完整用例目标」组装成消息
    2. LLM 基于消息判断上一步是否生效，输出下一步动作（每轮只调用一个工具）
    3. 引擎执行动作；UI 动作执行后自动重新截屏，把新屏幕带入下一轮
    4. LLM 达成一个目标 → mark_progress 声明；全部目标达成 → finish_case 收尾；无法完成 → report_failure 中止

LLM 通过工具输出动作：
  - UI 工具（tap / type / swipe / wait）
  - 状态声明工具（mark_progress / finish_case / report_failure）
  - 特性工具（get_feature，特性列表已注入系统提示词）
  - 通用工具（list_dir / read_file / write_file / exec_command）

进度感知方式：完整用例信息（标题、全部步骤与预期结果）在每条消息中原封不动提供，
执行记录（LLM 通过 mark_progress 声明的已完成目标列表）逐条回显，LLM 据此判断剩余目标。
"""

from __future__ import annotations

import os

from langchain_core.messages import HumanMessage
from langchain_openai import ChatOpenAI

from .act import ActionExecutor
from .config import AgentConfig
from .knowledge import KnowledgeService
from .perceive import HypiumStub, Perceiver
from .tools import ScreenBox, _format_screen, build_tools
from memory import MemoryStore


# UI 动作：执行后引擎必须重新截图确认页面变化
UI_ACTIONS = {"tap", "type", "swipe", "wait"}
# 查询动作：屏幕不变，执行后不重新截图
QUERY_ACTIONS = {"get_feature", "list_dir", "read_file", "write_file", "exec_command"}
# 状态声明动作：不操作屏幕，由引擎直接处理
DECLARE_ACTIONS = {"mark_progress", "finish_case", "report_failure"}


def _load_system_prompt(memory: MemoryStore) -> str:
    """
    读取系统提示词，并附上当前特性知识库列表。

    特性列表直接注入提示词（每条消息 LLM 都看得到），
    不需要 LLM 先调用工具去查"有哪些特性"。
    """
    path = os.path.join(os.path.dirname(__file__), "prompt", "system.md")
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
        feature_list = "## 当前特性知识库\n（暂无特性，操作以消息中附带的当前屏幕状态为准）"

    return base + "\n\n" + feature_list


class AgentEngine:
    """
    Agent 执行引擎（引擎驱动循环，连续用例模式）。

    完整流程:
      整个用例一个循环（截图 → LLM 出动作 → 执行 → 再截图）
      → LLM 通过 mark_progress 声明目标、finish_case 收尾、report_failure 中止
      → 全部成功时 learn_from_execution（执行经验沉淀为特性知识）
    """

    def __init__(self, config: AgentConfig | None = None):
        self.config = config or AgentConfig.from_env()

        # 初始化各模块
        hypium = HypiumStub(
            device_serial=self.config.device_serial,
            resolution=self.config.device_resolution,
        )
        self.perceiver = Perceiver(
            hypium=hypium,
            target_width=self.config.screenshot_target_width,
        )
        self.memory = MemoryStore(
            data_dir=self.config.memory_dir or None,
        )
        self.executor = ActionExecutor(hypium=hypium)

        # 初始化 LLM
        self.llm = self._init_llm()
        # 特性知识检索 / 经验沉淀
        self.knowledge = KnowledgeService(self.llm, self.memory, self.config)

        # 注册工具（引擎持有屏幕状态盒并负责截屏）
        self.screen_box = ScreenBox(self.perceiver, self.memory)
        self.tools = build_tools(
            perceiver=self.perceiver,
            executor=self.executor,
            memory=self.memory,
            config=self.config,
            box=self.screen_box,
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

    # ── 工具与屏幕 ──────────────────────────────────────

    def _invoke_tool(self, name: str, args: dict) -> str:
        """调用工具并返回结果文本。"""
        fn = self._tool_map.get(name)
        if fn is None:
            return f"未知工具: {name}"
        try:
            return str(fn.invoke(args or {}))
        except Exception as e:
            return f"{name} 调用失败: {e}"

    def _current_screen_text(self) -> str:
        """把当前屏幕状态格式化为文本（截图 + UI 元素 + 页面记忆）。"""
        screen = self.screen_box.current
        if screen is None:
            return "（尚无屏幕状态）"
        try:
            mem = self.memory.query(screen.ui_tree, app_version="1.0")
        except Exception:
            mem = {}
        return _format_screen(screen, mem, self.config.screenshot_target_width)

    # ── 消息组装 ────────────────────────────────────────

    def _build_case_message(self, title: str, original_steps: list[str],
                            expected_results: list[str], progress: list[str],
                            last_result: str, screen_text: str) -> str:
        """组装每轮消息：完整用例信息 + 执行记录 + 上一步结果 + 当前屏幕 + 操作规则。"""
        parts = [
            f"用例标题: {title}",
            "",
            "完整测试步骤与预期结果（编号仅作参考，你可自行安排执行顺序，不必逐条对应）:",
        ]
        for i, s in enumerate(original_steps):
            e = expected_results[i] if i < len(expected_results or []) else ""
            line = f"  {i + 1}. {s}"
            if e:
                line += f"\n     预期结果: {e}"
            parts.append(line)
        parts.append("")
        if progress:
            parts.append("执行记录（你已声明完成的目标，不要重复执行）:")
            for i, p in enumerate(progress, 1):
                parts.append(f"  {i}. {p}")
        else:
            parts.append("执行记录: （暂无，本次执行尚未声明任何完成目标）")
        parts.append("")
        parts.append("上一步执行结果:")
        parts.append(f"  {last_result}")
        parts.append("")
        parts.append("当前屏幕状态:")
        parts.append(screen_text)
        parts.append("")
        parts.append(
            "操作规则（每轮只调用一个工具）:\n"
            "1. 先结合「上一步执行结果」和「当前屏幕状态」判断上一步操作是否生效\n"
            "2. 需要继续操作时，调用 tap / type / swipe / wait 之一\n"
            "3. 需要特性细节时，调用 get_feature（特性列表已在系统提示词末尾）\n"
            "4. 达成一个目标 → 调用 mark_progress，参数 summary 写清楚达成了什么\n"
            "5. 全部目标已达成、用例执行完毕 → 调用 finish_case 总结收尾\n"
            "6. 确实无法完成 → 调用 report_failure 说明原因，整个用例中止"
        )
        return "\n".join(parts)

    # ── 用例执行（连续模式） ────────────────────────────

    def _run_case(self, title: str, original_steps: list[str],
                  expected_results: list[str]) -> dict:
        """
        整个用例作为一个连续任务执行（引擎驱动循环）。

        每轮: 截图 → 发消息（上一步结果 + 执行记录 + 当前屏幕 + 完整用例目标） → LLM 出动作 → 执行 → 循环
        返回: {
            "status": "completed" | "failed" | "error",
            "iterations": int,
            "summary": str,      # finish_case 总结 / 失败原因 / 错误信息
            "progress": list[str]  # LLM 通过 mark_progress 声明的已完成目标
        }
        """
        # 用例开始：引擎自动截图
        try:
            self.screen_box.perceive()
            screen_text = self._current_screen_text()
        except Exception as e:
            print(f"  错误: 截图失败: {e}")
            return {"status": "error", "iterations": 0,
                    "summary": f"截图失败: {e}", "progress": []}

        progress: list[str] = []
        last_result = "（用例刚开始，尚未执行任何操作）"
        iterations = 0
        max_iter = self.config.max_iterations_per_case

        while iterations < max_iter:
            iterations += 1
            msg = self._build_case_message(
                title, original_steps, expected_results,
                progress, last_result, screen_text,
            )

            try:
                ai_msg = self._llm_tools.invoke([HumanMessage(content=msg)])
            except Exception as e:
                print(f"  错误: LLM 调用失败: {e}")
                return {"status": "error", "iterations": iterations,
                        "summary": str(e), "progress": progress}

            tool_calls = getattr(ai_msg, "tool_calls", None) or []
            if not tool_calls:
                content = str(getattr(ai_msg, "content", "") or "")
                print(f"  第 {iterations} 轮: 模型未调用工具，输出: {content[:120]!r}")
                last_result = f"模型未调用任何工具，直接输出: {content[:200]}"
                continue

            # 一次只执行一个动作
            tc = tool_calls[0]
            name, args = tc["name"], tc.get("args") or {}
            print(f"  第 {iterations} 轮: 调用 {name}({args})")

            if name == "mark_progress":
                # 声明完成一个目标：追加执行记录，屏幕不变，继续循环
                summary = str(args.get("summary") or "").strip() or "（未说明）"
                progress.append(summary)
                result = f"目标已记录: {summary}"
                print(f"  → {result}")
                last_result = result
                continue

            if name == "finish_case":
                # 声明整个用例完成
                summary = str(args.get("summary") or "").strip() or "（未说明）"
                print(f"  → 用例完成: {summary}")
                return {"status": "completed", "iterations": iterations,
                        "summary": summary, "progress": progress}

            if name == "report_failure":
                # 声明无法完成，整个用例中止
                reason = str(args.get("reason") or "").strip() or "（未说明）"
                print(f"  → 用例失败: {reason}")
                return {"status": "failed", "iterations": iterations,
                        "summary": reason, "progress": progress}

            result = self._invoke_tool(name, args)
            print(f"  → {str(result)[:120]}")

            if name in UI_ACTIONS:
                # UI 动作执行后：自动重新截图，把新屏幕带入下一轮
                try:
                    self.screen_box.perceive()
                    screen_text = self._current_screen_text()
                except Exception as e:
                    screen_text = f"（重新截图失败: {e}）"
                last_result = f"执行 {name}({args})\n结果: {result}"
            else:
                # 查询类动作：屏幕未变化，只更新结果
                last_result = f"调用 {name}({args})\n结果: {result}"

        print(f"  结果: 失败（超过 {max_iter} 轮仍未完成）")
        return {"status": "failed", "iterations": iterations,
                "summary": f"超过 {max_iter} 轮仍未完成", "progress": progress}

    # ── 完整流程 ────────────────────────────────────────

    def resolve_and_run(self, title: str, original_steps: list[str],
                        expected_results: list[str]) -> dict:
        """
        连续执行整个用例（不按步骤编号逐条驱动，进度由 LLM 声明 + 执行记录回显）。

        返回: {
            "status": str,
            "progress": list[str],   # 声明的已完成目标
            "summary": str,          # 完成总结 / 失败原因
            "iterations": int,
            "memory_updated": bool,
        }
        """
        print(f"\n[Agent] === 开始执行 ===")
        result = self._run_case(title, original_steps, expected_results)

        status = result["status"]
        progress = result.get("progress") or []
        summary = result.get("summary") or ""

        print(f"\n执行轮数: {result.get('iterations', 0)}")
        if progress:
            print("已完成目标:")
            for i, p in enumerate(progress, 1):
                print(f"  {i}. {p}")
        print(f"结果: {status}")
        if summary:
            print(f"总结: {summary}")

        # 沉淀特性知识（LLM 归类：该经验属于哪个应用/特性/场景）
        memory_updated = False
        if status == "completed":
            feature_id = self.knowledge.learn_from_execution(
                title, original_steps, expected_results, result
            )
            memory_updated = feature_id is not None

        return {
            "status": status,
            "progress": progress,
            "summary": summary,
            "iterations": result.get("iterations", 0),
            "memory_updated": memory_updated,
        }

    def run_interactive(self, title: str, original_steps: list[str],
                        expected_results: list[str]):
        """
        交互式运行（逐步输出到控制台）。

        适合 CLI 聊天模式。
        """
        result = self.resolve_and_run(title, original_steps, expected_results)

        print(f"\n{'='*50}")
        print(f"执行完成: {result['status']}（{result.get('iterations', 0)} 轮）")
        for i, p in enumerate(result.get("progress") or [], 1):
            print(f"  ✓ {p}")
        if result.get("summary"):
            print(f"总结: {result['summary']}")
        print(f"记忆更新: {'是' if result['memory_updated'] else '否'}")
        print(f"{'='*50}")
