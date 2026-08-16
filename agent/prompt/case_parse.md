将用户输入的文本测试用例描述解析为标准的 JSON。

[用户输入]
{user_input}

输出格式（仅输出 JSON，不要其他文字）：
{{
  "title": "用例标题",
  "steps": ["步骤1: XXX", "步骤2: XXX"],
  "checkpoints": ["检查点1: XXX", "检查点2: XXX"]
}}

说明：
- title：用例标题，输入里没有时用一句话概括
- steps：要执行的测试步骤，原样保留
- checkpoints：要执行的检查点，原样保留，没有则为 []

