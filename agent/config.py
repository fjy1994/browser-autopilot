"""
Agent 配置。
"""

import os
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class AgentConfig:
    """Agent 运行时配置。"""

    # LLM 配置
    llm_model: str = "deepseek-v4-flash"
    llm_base_url: str = "https://api.deepseek.com/v1"
    llm_api_key: str = ""

    # 执行引擎配置
    max_iterations_per_case: int = 60  # 整个用例的最大循环轮数
    screenshot_target_width: int = 720  # 缩放到此宽度
    memory_dir: str = ""  # 记忆存储目录（空表示使用默认）

    # 设备配置（stub）
    device_serial: str = ""
    device_resolution: tuple[int, int] = (1080, 2400)  # 默认分辨率

    @classmethod
    def from_env(cls) -> "AgentConfig":
        """从环境变量加载配置。"""
        return cls(
            llm_model=os.getenv("LLM_MODEL", "deepseek-v4-flash"),
            llm_base_url=os.getenv("LLM_BASE_URL", "https://api.deepseek.com/v1"),
            llm_api_key=os.getenv("LLM_API_KEY", ""),
            max_iterations_per_case=int(os.getenv("MAX_ITER_PER_CASE", "60")),
            screenshot_target_width=int(os.getenv("SCREENSHOT_WIDTH", "720")),
            memory_dir=os.getenv("MEMORY_DIR", ""),
            device_serial=os.getenv("DEVICE_SERIAL", ""),
        )
