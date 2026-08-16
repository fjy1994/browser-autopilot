from __future__ import annotations

import os
import subprocess

from langchain_core.tools import tool

from memory import MemoryStore
from .act import ActionDecision, ActionExecutor
from .config import AgentConfig
from .perceive import Screen


def build_tools(executor: ActionExecutor, memory: MemoryStore,
                config: AgentConfig, screen: Screen) -> list:
    @tool
    def tap(x: int = 0, y: int = 0, target_text: str = "") -> str:
        """点击屏幕上的位置。x/y 为 720 宽缩放坐标系；也可传 target_text 按界面文本定位元素点击。"""
        state = screen.current
        if state is None:
            state = screen.perceive()
        decision = ActionDecision("tap", {"x": x, "y": y, "target_text": target_text})
        try:
            return executor.execute(decision, state)
        except Exception as e:
            return f"点击失败: {e}"

    @tool
    def type(text: str) -> str:
        """在当前聚焦的输入框中输入文本。"""
        s = screen.current
        if s is None:
            s = screen.perceive()
        decision = ActionDecision("type", {"text": text})
        try:
            return executor.execute(decision, s)
        except Exception as e:
            return f"输入失败: {e}"

    @tool
    def swipe(x1: int, y1: int, x2: int, y2: int, duration_ms: int = 300) -> str:
        """在屏幕上滑动，从 (x1, y1) 滑到 (x2, y2)（720 宽缩放坐标系）。用于翻页、滚动列表等。"""
        s = screen.current
        if s is None:
            s = screen.perceive()
        decision = ActionDecision("swipe", {"x1": x1, "y1": y1, "x2": x2, "y2": y2,
                                            "duration_ms": duration_ms})
        try:
            return executor.execute(decision, s)
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

    @tool
    def finish_case(summary: str) -> str:
        """声明整个用例的全部目标已达成、执行完毕，并给出总结（覆盖了哪些目标、最终状态如何）。调用后用例正常结束。"""
        return f"用例完成已确认: {summary}"

    @tool
    def report_failure(reason: str) -> str:
        """声明用例无法继续完成，给出失败原因。调用后整个用例中止。"""
        return f"用例失败已确认: {reason}"

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
        finish_case, report_failure,
        get_feature,
        list_dir, read_file, write_file, exec_command,
    ]
