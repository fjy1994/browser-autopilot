"""
浏览器自动化 Agent — CLI 入口。

用法:
  python main.py
    → 交互式聊天模式
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from agent.config import AgentConfig
from agent.engine import AgentEngine


def interactive_mode(engine: AgentEngine):
    """交互式聊天模式。"""
    print("🐈 浏览器 Agent (输入 'quit' 退出, 'help' 查看命令)")
    print("-" * 50)

    while True:
        try:
            title = input("\n📋 用例标题: ").strip()
            if title.lower() in ("quit", "exit", "q"):
                break
            if title.lower() == "help":
                print("命令: quit/exit/q 退出 | 直接输入标题开始执行")
                continue
            if not title:
                continue

            steps_text = input("📝 步骤描述 (一行一个, 用 | 分隔): ").strip()
            if not steps_text:
                print("至少需要一个步骤")
                continue

            steps = [s.strip() for s in steps_text.split("|") if s.strip()]

            expected_text = input("✅ 预期结果 (一行一个, 用 | 分隔): ").strip()
            if not expected_text:
                print("至少需要一个预期结果")
                continue

            expected = [s.strip() for s in expected_text.split("|") if s.strip()]

            engine.run_interactive(title, steps, expected)

        except KeyboardInterrupt:
            print("\n退出")
            break
        except Exception as e:
            print(f"\n❌ 错误: {e}")


def main():
    parser = argparse.ArgumentParser(description="浏览器自动化 Agent")
    parser.add_argument("--verbose", "-v", action="store_true", help="显示详细日志")
    args = parser.parse_args()

    # 从环境变量加载配置
    config = AgentConfig.from_env()

    # 必须设置 API Key
    if not config.llm_api_key:
        key = os.environ.get("LLM_API_KEY") or os.environ.get("DEEPSEEK_API_KEY") or ""
        if key:
            config.llm_api_key = key
        else:
            print("⚠️  未设置 LLM_API_KEY 环境变量")
            print("  请设置: set LLM_API_KEY=sk-xxx")
            print("  或用 .env 文件（需安装 python-dotenv）")
            print("  继续运行，LLM 调用将失败\n")

    # 初始化引擎
    print("🐈 浏览器 Agent 初始化...")
    engine = AgentEngine(config)
    print("✅ 初始化完成")

    interactive_mode(engine)


if __name__ == "__main__":
    main()
