"""
浏览器自动化 Agent — CLI 入口。

用法:
  python main.py
    → 交互式聊天模式
"""

import argparse
import os
import sys

from agent.config import AgentConfig
from agent.engine import AgentEngine

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def interactive_mode(engine: AgentEngine):
    """交互式聊天模式。"""
    print("🐈 浏览器 Agent (输入 'quit' 退出, 'help' 查看命令)")
    print("-" * 50)
    print("请输入文本用例")

    while True:
        try:
            text = input("\n📋 用例信息: ").strip()
            if text.lower() in ("quit", "exit", "q"):
                break
            if text.lower() == "help":
                print("命令: quit/exit/q 退出 | 输入一段用例描述开始执行")
                continue
            if not text:
                continue

            parsed = engine.parse_case_input(text)
            if not parsed["steps"]:
                print("未识别到用例步骤，请重新输入")
                continue
            engine.run_interactive(
                parsed["title"],
                parsed["steps"],
                parsed["checkpoints"],
            )

        except KeyboardInterrupt:
            print("\n退出")
            break
        except Exception as e:
            print(f"\n❌ 错误: {e}")


def main():
    parser = argparse.ArgumentParser(description="浏览器自动化 Agent")
    parser.add_argument("--verbose", "-v", action="store_true", help="显示详细日志")
    args = parser.parse_args()

    
    config = AgentConfig.from_env()

    
    if not config.llm_api_key:
        key = os.environ.get("LLM_API_KEY") or os.environ.get("DEEPSEEK_API_KEY") or ""
        if key:
            config.llm_api_key = key
        else:
            print("⚠️  未设置 LLM_API_KEY 环境变量")
            print("  请设置: set LLM_API_KEY=sk-xxx")
            print("  或用 .env 文件（需安装 python-dotenv）")
            print("  继续运行，LLM 调用将失败\n")

    
    print("🐈 浏览器 Agent 初始化...")
    engine = AgentEngine(config)
    print("✅ 初始化完成")

    interactive_mode(engine)


if __name__ == "__main__":
    main()
