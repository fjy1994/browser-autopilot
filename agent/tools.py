"""
工具模块 —— 注册给 LLM 的所有可调用工具。

架构说明（引擎驱动循环，连续用例模式）:
  屏幕感知由引擎自动完成：每轮循环引擎截屏并把屏幕状态文本附在消息里，
  LLM 不需要（也没有）观察屏幕的工具，直接基于消息中的屏幕信息输出动作：
    - UI 工具: tap / type / swipe / wait
    - 状态声明工具: mark_progress / finish_case / report_failure
    - 特性工具: get_feature（特性列表已注入系统提示词）
    - 通用工具: list_dir / read_file / write_file / exec_command
  UI 动作由引擎执行后自动重新截图，把新屏幕 + 执行结果带入下一轮。
  状态声明工具不操作屏幕：mark_progress 追加执行记录，finish_case 结束用例，
  report_failure 中止用例。
"""

from __future__ import annotations

import os
import subprocess
from datetime import datetime
from typing import Iterator

from langchain_core.tools import tool

from .act import ActionDecision, ActionExecutor
from .config import AgentConfig
from .perceive import Perceiver, ScreenState
from memory import MemoryStore


# ── 屏幕状态容器 ─────────────────────────────────────────

class ScreenBox:
    """可变屏幕状态容器：引擎持有并负责截屏，UI 工具读取。"""

    def __init__(self, perceiver: Perceiver, memory: MemoryStore):
        self.perceiver = perceiver
        self.memory = memory
        self.current: ScreenState | None = None

    def perceive(self) -> ScreenState:
        """截屏 + UI dump，返回最新屏幕状态。"""
        self.current = self.perceiver.perceive()
        return self.current


# ── UI 树辅助 ────────────────────────────────────────────

def _iter_nodes(node: dict | None) -> Iterator[dict]:
    """深度优先遍历 UI 树节点。"""
    if not node or not isinstance(node, dict):
        return
    yield node
    for child in node.get("children") or []:
        yield from _iter_nodes(child)


def _fmt_bounds(node: dict) -> str:
    b = node.get("bounds") or {}
    if isinstance(b, dict) and "left" in b:
        return f"({b['left']},{b['top']},{b['right']},{b['bottom']})"
    if isinstance(b, (list, tuple)) and len(b) == 4:
        return f"({b[0]},{b[1]},{b[2]},{b[3]})"
    return ""


def _format_screen(screen: ScreenState, mem: dict, target_width: int) -> str:
    """把屏幕状态 + 页面记忆格式化为文本。"""
    lines = [
        f"[屏幕快照] {screen.timestamp}",
        f"截图: {screen.scaled_screenshot_path or screen.screenshot_path}",
        f"分辨率: {screen.screen_width}x{screen.screen_height}（操作坐标按 {target_width} 宽缩放坐标系）",
    ]
    elements = []
    for n in _iter_nodes(screen.ui_tree):
        key = n.get("key") or n.get("resource_id") or ""
        clickable = n.get("clickable")
        text = n.get("text") or ""
        if not key and not clickable:
            continue
        elements.append(
            f"  - key={key or '(无)'} type={n.get('type', '')} "
            f"text={text!r} bounds={_fmt_bounds(n)}"
        )
    if elements:
        lines.append("UI 元素:")
        lines.extend(elements)
    else:
        lines.append("UI 元素: (无)")

    # 页面记忆提示
    if mem.get("matched"):
        lines.append(f"页面记忆: 已知页面「{mem.get('cluster_desc') or mem.get('page_name') or ''}」")
        if mem.get("elements"):
            lines.append("已知元素:")
            for rid, ek in mem["elements"].items():
                lines.append(
                    f"  - {rid}: action={ek.get('action', 'click')} "
                    f"leads_to={ek.get('leads_to_cluster') or '(未知)'}"
                )
    else:
        lines.append("页面记忆: 无相关记忆（新页面）")
    return "\n".join(lines)


# ── 构建工具列表 ─────────────────────────────────────────

def build_tools(perceiver: Perceiver, executor: ActionExecutor,
                memory: MemoryStore, config: AgentConfig,
                box: ScreenBox | None = None) -> list:
    """构造所有工具。UI 工具通过闭包共享 ScreenBox（由引擎持有并负责截屏）。"""
    box = box or ScreenBox(perceiver, memory)

    # ── UI 工具 ────────────────────────────────────────

    @tool
    def tap(x: int = 0, y: int = 0, target_text: str = "") -> str:
        """点击屏幕元素。优先用 target_text 匹配元素文本；匹配不到时按 (x, y) 坐标点击（坐标使用 720 宽缩放坐标系）。"""
        screen = box.current
        if screen is None:
            screen = box.perceive()
        decision = ActionDecision("tap", {"x": x, "y": y, "target_text": target_text})
        try:
            return executor.execute(decision, screen)
        except Exception as e:
            return f"点击失败: {e}"

    @tool
    def type(text: str) -> str:
        """在当前聚焦的输入框中输入文本。"""
        screen = box.current
        if screen is None:
            screen = box.perceive()
        decision = ActionDecision("type", {"text": text})
        try:
            return executor.execute(decision, screen)
        except Exception as e:
            return f"输入失败: {e}"

    @tool
    def swipe(x1: int, y1: int, x2: int, y2: int, duration_ms: int = 300) -> str:
        """在屏幕上滑动，从 (x1, y1) 滑到 (x2, y2)（720 宽缩放坐标系）。用于翻页、滚动列表等。"""
        screen = box.current
        if screen is None:
            screen = box.perceive()
        decision = ActionDecision("swipe", {"x1": x1, "y1": y1, "x2": x2, "y2": y2,
                                            "duration_ms": duration_ms})
        try:
            return executor.execute(decision, screen)
        except Exception as e:
            return f"滑动失败: {e}"

    @tool
    def wait(ms: int = 1000) -> str:
        """等待指定毫秒，用于页面加载、动画播放等。"""
        decision = ActionDecision("wait", {"ms": ms})
        try:
            return executor.execute(decision, None)
        except Exception as e:
            return f"等待失败: {e}"

    # ── 状态声明工具 ───────────────────────────────────

    @tool
    def mark_progress(summary: str) -> str:
        """声明已达成一个目标（例如"已打开设置页并清理缓存"）。引擎会把它记入执行记录并在后续消息中回显。达成一个目标后调用一次；不要声明未真实达成的目标。"""
        return f"目标已记录: {summary}"

    @tool
    def finish_case(summary: str) -> str:
        """声明整个用例的全部目标已达成、执行完毕，并给出总结（覆盖了哪些目标、最终状态如何）。调用后用例正常结束。"""
        return f"用例完成已确认: {summary}"

    @tool
    def report_failure(reason: str) -> str:
        """声明用例无法继续完成，给出失败原因。调用后整个用例中止。"""
        return f"用例失败已确认: {reason}"

    # ── 特性知识工具 ────────────────────────────────────

    @tool
    def get_feature(feature_id: str) -> str:
        """查看某个特性的完整知识文档（Markdown 原文，含入口/前置条件/操作场景）。feature_id 从系统提示词末尾的特性列表中获取，格式如 "浏览器/清理缓存.md"。"""
        try:
            raw = memory.get_feature_raw(feature_id)
        except Exception as e:
            return f"特性读取失败: {e}"
        if not raw.strip():
            return f"特性不存在: {feature_id}"
        return raw

    # ── 通用工具 ───────────────────────────────────────

    @tool
    def list_dir(path: str = ".") -> str:
        """查看某个目录下有哪些文件/子目录。"""
        try:
            entries = sorted(os.listdir(path))
            lines = []
            for name in entries:
                full = os.path.join(path, name)
                kind = "目录" if os.path.isdir(full) else "文件"
                lines.append(f"{kind}\t{name}")
            return (f"{path} 下共 {len(entries)} 项:\n" + "\n".join(lines)) if lines else f"{path} 下为空"
        except Exception as e:
            return f"list_dir 失败: {e}"

    @tool
    def read_file(path: str) -> str:
        """读取文本文件内容（UTF-8）。文件超过 100KB 时只返回前 100KB。"""
        try:
            if not os.path.exists(path):
                return f"文件不存在: {path}"
            size = os.path.getsize(path)
            if size > 100 * 1024:
                with open(path, encoding="utf-8", errors="replace") as f:
                    return f"文件过大（{size} 字节），仅返回前 100KB:\n" + f.read(100 * 1024)
            with open(path, encoding="utf-8", errors="replace") as f:
                return f.read()
        except Exception as e:
            return f"read_file 失败: {e}"

    @tool
    def write_file(path: str, content: str) -> str:
        """写入/覆盖文件内容（UTF-8 编码）。用于修改文件、保存中间结果。"""
        try:
            os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
            with open(path, "w", encoding="utf-8") as f:
                f.write(content)
            return f"已写入 {path}（{len(content)} 字符）"
        except Exception as e:
            return f"write_file 失败: {e}"

    @tool
    def exec_command(command: str) -> str:
        """执行系统命令（Windows 命令，如 dir、type、查看进程等）。返回退出码、标准输出和错误输出。"""
        try:
            proc = subprocess.run(
                command, shell=True, capture_output=True,
                text=True, encoding="utf-8", errors="replace", timeout=30,
            )
            out = (proc.stdout or "") + (proc.stderr or "")
            return f"exit={proc.returncode}\n{out.strip() or '(无输出)'}"
        except subprocess.TimeoutExpired:
            return "命令执行超时（30 秒）"
        except Exception as e:
            return f"命令执行失败: {e}"

    return [
        tap, type, swipe, wait,
        mark_progress, finish_case, report_failure,
        get_feature,
        list_dir, read_file, write_file, exec_command,
    ]
