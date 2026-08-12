"""提示词模板加载器。

所有提示词模板为 Markdown 文件，位于 agent/prompt/ 目录。
load_prompt(name) 读取对应文件并返回文本内容。
"""

from pathlib import Path

PROMPT_DIR = Path(__file__).resolve().parent / "prompt"


def load_prompt(name: str) -> str:
    """读取名为 name 的提示词模板（name 不带 .md 后缀）。

    例如 load_prompt("feature_retrieval") 读取 agent/prompt/feature_retrieval.md。
    文件不存在时抛出 FileNotFoundError。
    """
    path = PROMPT_DIR / f"{name}.md"
    return path.read_text(encoding="utf-8")
