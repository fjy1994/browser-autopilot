"""
感知模块 —— 截屏 + UI dump

Hypium 相关操作已 stub，留出接口等待实际接入。
"""

from __future__ import annotations
import json
import os
import shutil
import struct
import time
from dataclasses import dataclass, field
from typing import Any, Optional
from datetime import datetime

try:
    from PIL import Image
except ImportError:
    Image = None


@dataclass
class ScreenState:
    """当前屏幕的完整状态。"""
    screenshot_path: str = ""          # 截图文件路径
    scaled_screenshot_path: str = ""   # 缩放后截图路径
    scale_factor: float = 1.0          # 缩放比例
    ui_tree: dict | None = None        # Hypium UI 树
    screen_width: int = 1080           # 实际宽度
    screen_height: int = 2400          # 实际高度
    timestamp: str = ""                # 捕获时间


class HypiumStub:
    """
    Hypium 操作桩。

    待接入真实 Hypium 框架后替换为实际调用。
    """

    def __init__(self, device_serial: str = "",
                 resolution: tuple[int, int] = (1080, 2400)):
        self.device_serial = device_serial
        self.resolution = resolution

    def dump_hierarchy(self) -> dict | None:
        """
        获取当前 UI 树。

        返回: UI 树 JSON（dict）
        """
        # ================ STUB ================
        # 待接入: hypium.dump_hierarchy()
        # 返回格式参考:
        # {
        #   "type": "root",
        #   "bounds": {"left": 0, "top": 0, "right": 1080, "bottom": 2400},
        #   "children": [
        #     {"type": "FrameLayout", "bounds": ..., "children": [...]},
        #     ...
        #   ]
        # }
        return None

    def take_screenshot(self, output_path: str) -> bool:
        """
        截取屏幕截图。

        返回: 是否成功
        """
        # ================ STUB ================
        # 待接入: hypium.screenshot(output_path)
        _touch_file(output_path)
        return True

    def click(self, key: str = "", x: int = 0, y: int = 0) -> bool:
        """点击元素（用 key 或坐标）。"""
        # ================ STUB ================
        print(f"  [Hypium Stub] click(key={key!r}, x={x}, y={y})")
        return True

    def input_text(self, text: str) -> bool:
        """输入文本。"""
        # ================ STUB ================
        print(f"  [Hypium Stub] input_text({text!r})")
        return True

    def swipe(self, x1: int, y1: int, x2: int, y2: int) -> bool:
        """滑动。"""
        # ================ STUB ================
        print(f"  [Hypium Stub] swipe({x1},{y1} → {x2},{y2})")
        return True

    def wait(self, ms: int) -> bool:
        """等待。"""
        # ================ STUB ================
        time.sleep(ms / 1000)
        return True


class Perceiver:
    """
    感知模块。

    负责截屏 + UI dump + 缩放。
    """

    def __init__(self, hypium: HypiumStub | None = None,
                 target_width: int = 720,
                 screenshot_dir: str = ""):
        self.hypium = hypium or HypiumStub()
        self.target_width = target_width
        self.screenshot_dir = screenshot_dir or os.path.join(
            os.path.dirname(__file__), "..", "data", "screenshots"
        )
        os.makedirs(self.screenshot_dir, exist_ok=True)

    def perceive(self) -> ScreenState:
        """
        捕获当前屏幕状态。

        步骤:
          1. 截屏并保存
          2. 缩放截图到目标宽度
          3. 通过 Hypium 获取 UI 树
        """
        state = ScreenState()
        state.timestamp = datetime.now().isoformat(timespec="seconds")

        # 截屏
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        orig_path = os.path.join(self.screenshot_dir, f"screenshot_{ts}_orig.png")
        scaled_path = os.path.join(self.screenshot_dir, f"screenshot_{ts}.png")

        self.hypium.take_screenshot(orig_path)
        state.screenshot_path = orig_path

        # 缩放截图
        state.scaled_screenshot_path = self._resize_screenshot(
            orig_path, scaled_path, self.target_width
        )

        # 获取 UI 树
        ui_tree = self.hypium.dump_hierarchy()
        state.ui_tree = self._mock_ui_tree() if ui_tree is None else ui_tree

        # 屏幕尺寸
        width, height = self.hypium.resolution
        state.screen_width = width
        state.screen_height = height

        # 计算缩放比例
        if width > 0:
            state.scale_factor = self.target_width / width

        return state

    def _resize_screenshot(self, src: str, dst: str, target_w: int) -> str:
        """
        缩放截图。

        优先用 PIL，没有则复制原图。
        """
        if Image is not None:
            img = Image.open(src)
            w, h = img.size
            ratio = target_w / w
            target_h = int(h * ratio)
            img_resized = img.resize((target_w, target_h), Image.LANCZOS)
            img_resized.save(dst)
            return dst
        else:
            # 没有 PIL，复制原图
            shutil.copy2(src, dst)
            return dst

    def _mock_ui_tree(self) -> dict:
        """
        STUB: 返回一个模拟的 UI 树。

        待接入真实 Hypium 后移除。
        """
        w, h = self.hypium.resolution
        return {
            "type": "root",
            "bounds": {"left": 0, "top": 0, "right": w, "bottom": h},
            "children": [
                {
                    "type": "FrameLayout",
                    "bounds": {"left": 0, "top": 0, "right": w, "bottom": h},
                    "clickable": False,
                    "children": [
                        {
                            "type": "Button",
                            "bounds": {"left": 0, "top": 0, "right": w, "bottom": 120},
                            "clickable": True,
                            "text": "状态栏",
                        },
                        {
                            "type": "Button",
                            "bounds": {"left": 0, "top": 2100, "right": w, "bottom": 2400},
                            "clickable": True,
                            "text": "浏览器",
                            "key": "browser_icon",
                        },
                    ],
                }
            ],
        }


def _touch_file(path: str) -> None:
    """创建一个空文件（模拟截屏）。"""
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "wb") as f:
        # 写一个最小的 PNG 文件供 PIL 测试
        # 1x1 pixel transparent PNG
        raw = (
            b"\x89PNG\r\n\x1a\n"
            b"\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
            b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
            b"\x00\x00\x00\nIDATx\x9cc\xf8\x0f\x00\x00\x01\x01\x00\x05\x18\xd8N"
            b"\x00\x00\x00\x00IEND\xaeB`\x82"
        )
        f.write(raw)
