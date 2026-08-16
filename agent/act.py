"""
执行模块 —— 把动作决策落地到手机操作。

坐标还原 + ui_tree 元素查找 + 稳定定位。
Hypium 操作已 stub。
"""

from __future__ import annotations

from .perceive import ScreenState, HypiumStub


class ActionDecision:
    """动作指令：UI 工具构造，执行器落地。"""
    action: str  
    params: dict  

    def __init__(self, action: str = "", params: dict | None = None):
        self.action = action
        self.params = params or {}

    def __repr__(self) -> str:
        return f"ActionDecision(action={self.action!r}, params={self.params})"


class ActionExecutor:

    def __init__(self, hypium: HypiumStub | None = None):
        self.hypium = hypium or HypiumStub()

    def execute(self, decision: ActionDecision, screen: ScreenState) -> str:
        """
        执行 LLM 决策的动作。

        参数:
          decision: LLM 决策结果
          screen: 当前屏幕状态（包含 ui_tree 和 scale_factor）

        返回: 操作结果描述文本
        """
        action = decision.action
        params = decision.params

        if action == "tap":
            return self._do_tap(params, screen)
        elif action == "type":
            return self._do_type(params)
        elif action == "swipe":
            return self._do_swipe(params, screen)
        elif action == "wait":
            return self._do_wait(params)
        elif action == "done":
            return f"步骤已完成: {params.get('reason', '')}"
        else:
            return f"未知动作: {action}"

    

    def _do_tap(self, params: dict, screen: ScreenState) -> str:
        """点击操作。"""
        scaled_x = params.get("x", 0)
        scaled_y = params.get("y", 0)
        target_text = params.get("target_text", "")

        
        real_x, real_y = self._map_coords(scaled_x, scaled_y, screen)

        
        element = self._find_element_at(real_x, real_y, target_text, screen.ui_tree)

        if element:
            
            locator = self._extract_locator(element)
            desc = element.get("text") or element.get("key") or target_text or "元素"
            self.hypium.click(**locator)
            return f"点击元素「{desc}」(locator={locator})"
        else:
            
            self.hypium.click(x=real_x, y=real_y)
            return f"点击坐标 ({real_x}, {real_y})（未在 ui_tree 中找到匹配元素）"

    def _do_type(self, params: dict) -> str:
        """输入文本。"""
        text = params.get("text", "")
        self.hypium.input_text(text)
        return f"输入文本「{text}」"

    def _do_swipe(self, params: dict, screen: ScreenState) -> str:
        """滑动。"""
        x1, y1 = self._map_coords(params.get("x1", 0), params.get("y1", 0), screen)
        x2, y2 = self._map_coords(params.get("x2", 0), params.get("y2", 0), screen)
        self.hypium.swipe(x1, y1, x2, y2)
        return f"滑动 ({x1},{y1}) → ({x2},{y2})"

    def _do_wait(self, params: dict) -> str:
        """等待。"""
        ms = params.get("ms", 1000)
        self.hypium.wait(ms)
        return f"等待 {ms}ms"

    

    def _map_coords(self, scaled_x: int, scaled_y: int,
                    screen: ScreenState) -> tuple[int, int]:
        """将缩放后的坐标还原为实际坐标。"""
        if screen.scale_factor > 0:
            real_x = int(scaled_x / screen.scale_factor)
            real_y = int(scaled_y / screen.scale_factor)
            
            real_x = max(0, min(real_x, screen.screen_width - 1))
            real_y = max(0, min(real_y, screen.screen_height - 1))
            return real_x, real_y
        return scaled_x, scaled_y

    

    def _find_element_at(
            self, x: int, y: int, target_text: str, ui_tree: dict | None
    ) -> dict | None:
        """在 ui_tree 中查找包含 (x, y) 的目标元素。"""
        if not ui_tree:
            return None

        candidates = []
        self._search_by_coords(ui_tree, x, y, candidates)

        if not candidates:
            return None

        
        if target_text:
            for c in candidates:
                elem_text = self._get_element_text(c)
                if target_text.lower() in elem_text.lower():
                    return c

        
        return candidates[-1]

    def _search_by_coords(
            self, node: dict, x: int, y: int, results: list
    ) -> None:
        """递归搜索包含坐标的节点。"""
        bounds = node.get("bounds", {}) or {}
        x1 = bounds.get("left", 0)
        y1 = bounds.get("top", 0)
        x2 = bounds.get("right", 0)
        y2 = bounds.get("bottom", 0)

        contains = x1 <= x <= x2 and y1 <= y <= y2
        if not contains:
            return

        
        clickable = node.get("clickable", False)
        has_text = bool(self._get_element_text(node))
        has_key = bool(node.get("key"))
        node_type = (node.get("type") or "").lower()

        if clickable or has_text or has_key or node_type in ("button", "imagebutton"):
            results.append(node)

        
        for child in node.get("children", []):
            self._search_by_coords(child, x, y, results)

    def _extract_locator(self, element: dict) -> dict:
        """
        从元素中提取稳定定位条件。

        优先级:
          1. key (resource-id) — 最稳定
          2. text 全文匹配
          3. 坐标（兜底）
        """
        key = element.get("key") or element.get("resourceId") or ""
        text = element.get("text") or ""
        bounds = element.get("bounds", {}) or {}

        if key:
            return {"key": key}
        if text:
            return {"text": text, "key": ""}
        
        cx = ((bounds.get("left", 0) or 0) + (bounds.get("right", 0) or 0)) // 2
        cy = ((bounds.get("top", 0) or 0) + (bounds.get("bottom", 0) or 0)) // 2
        return {"x": cx, "y": cy}

    def _get_element_text(self, element: dict) -> str:
        """获取元素的文本内容。"""
        return (
                element.get("text")
                or element.get("label")
                or element.get("content")
                or element.get("contentDescription")
                or ""
        ).strip()
