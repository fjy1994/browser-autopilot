import type {Operation, OperationFlow} from '../types';
import {FLOW_ANALYSIS_PROMPT, FLOW_MATCH_PROMPT, ADAPT_FLOW_PROMPT, FAILURE_ANALYSIS_PROMPT} from './prompts';

export interface AnalysisOptions {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  targetDomain?: string;
  taskDescription?: string;
}

export class FlowAnalyzer {
  private apiKey: string;
  private model: string;
  private baseUrl: string;

  constructor(options: AnalysisOptions = {}) {
    this.apiKey = options.apiKey || '';
    this.model = options.model || 'gpt-4o-mini';
    this.baseUrl = options.baseUrl || 'https://api.openai.com/v1';
  }

  setApiKey(key: string) {
    this.apiKey = key;
  }

  /**
   * 🧠 LLM 智能选择 Flow
   */
  async selectFlowWithLLM(
    userQuery: string,
    availableFlows: OperationFlow[]
  ): Promise<{
    flow: OperationFlow | null;
    confidence: number;
    reasoning: string;
  }> {
    if (!this.apiKey) {
      throw new Error('❌ 请配置 OpenAI API Key');
    }

    if (availableFlows.length === 0) {
      return { flow: null, confidence: 0, reasoning: 'No flows available' };
    }

    // 构建事务列表给 LLM 参考 - 极简信息，最大化减少上下文
    const skills = availableFlows.map(flow => {
      return {
        id: flow.id,
        name: flow.name,
        description: flow.description.slice(0, 200),
      };
    });

    const systemPrompt = FLOW_MATCH_PROMPT.replace('{{FLOW_LIST}}', JSON.stringify(skills, null, 2));

    // 📤 LLM 请求
    console.log('\n' + '='.repeat(80));
    console.log('📤 [LLM 请求 1/2] Flow 匹配');
    console.log('👤 用户查询:', userQuery);
    console.log('📋 Flow 数量:', availableFlows.length);
    console.log('\n📝 System Prompt:');
    console.log(systemPrompt);
    console.log('\n📝 User Message:');
    console.log(`User request: ${userQuery}`);
    console.log('='.repeat(80) + '\n');

    const startTime = Date.now();
    const response = await fetch(this.baseUrl + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `User request: ${userQuery}` },
        ],
        temperature: 0.1,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`LLM 请求失败 (${response.status}): ${errorText.slice(0, 100)}`);
    }

    const data = await response.json();
    const content = data.choices[0].message.content;
    const costTime = Date.now() - startTime;

    // 📥 LLM 响应
    console.log('\n' + '='.repeat(80));
    console.log(`📥 [LLM 响应 1/2] 耗时: ${costTime}ms`);
    console.log(content);
    console.log('='.repeat(80) + '\n');

    // 解析 JSON
    const result = JSON.parse(content);
    const selectedFlow = availableFlows.find(f => f.id === result.selectedFlowId);

    return {
      flow: selectedFlow || null,
      confidence: result.confidenceScore || result.confidence || 0,
      reasoning: result.reasoning || result.explanation || 'LLM selection',
    };
  }

  /**
   * 🧠 根据用户当前需求，适配事务步骤的值（替换 input 的 value）
   */
  async adaptFlowWithLLM(userQuery: string, flow: OperationFlow): Promise<OperationFlow> {
    if (!this.apiKey) {
      throw new Error('❌ 请配置 OpenAI API Key');
    }

    // 格式化步骤给 LLM 看 - 包含 waitTimeout 让 LLM 知道每个步骤的等待时间
    const flowSteps = flow.steps.map((s: any) => ({
      action: s.action,
      targetSelector: s.target?.cssSelector || s.targetSelector,
      value: s.value,
      description: s.description,
      waitTimeout: s.waitTimeout || 3000, // 传递原始等待时间给 LLM
    }));

    const systemPrompt = ADAPT_FLOW_PROMPT
      .replace('{{USER_QUERY}}', userQuery)
      .replace('{{FLOW_STEPS}}', JSON.stringify(flowSteps, null, 2));

    console.log('\n' + '='.repeat(80));
    console.log('📤 [LLM 请求 2/2] 适配事务步骤的值');
    console.log('👤 用户需求:', userQuery);
    console.log('📋 步骤数量:', flowSteps.length);
    console.log('\n📝 完整 Prompt:');
    console.log(systemPrompt);
    console.log('='.repeat(80) + '\n');

    const startTime = Date.now();
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: 'system', content: systemPrompt }],
        temperature: 0.1,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`LLM 请求失败 (${response.status}): ${errorText.slice(0, 100)}`);
    }

    const data = await response.json();
    const costTime = Date.now() - startTime;
    const result = JSON.parse(data.choices[0].message.content);

    console.log('\n' + '='.repeat(80));
    console.log(`📥 [LLM 响应 2/2] 耗时: ${costTime}ms`);
    console.log('🧠 LLM 适配后的步骤:', JSON.stringify(result.steps, null, 2));
    console.log('='.repeat(80) + '\n');

    // 返回一个新的 flow 对象，用 LLM 适配后的步骤
    return {
      ...flow,
      steps: result.steps.map((step: any, i: number) => ({
        ...flow.steps[i], // 保留原来的全部字段（包括 target 和 waitTimeout）
        value: step.value, // 只覆盖 value
        waitTimeout: parseInt(step.waitTimeout || flow.steps[i].waitTimeout || 3000, 10), // 优先级：LLM智能判断 > 原始值 > 兜底，确保是数字
      })),
    };
  }

  /**
   * 分析操作序列，智能提取核心工作流
   */
  async analyzeOperations(
    operations: Operation[],
    options: AnalysisOptions = {}
  ): Promise<OperationFlow> {
    if (!this.apiKey) {
      throw new Error('❌ 请配置 OpenAI API Key');
    }

    if (operations.length === 0) {
      throw new Error('❌ 没有可分析的操作数据');
    }

    // 直接把原始操作交给 LLM，不做任何本地预处理，信任 LLM 的智能
    return await this.analyzeWithLLM(operations, options.taskDescription);
  }

  /**
   * 使用 LLM 分析操作序列
   */
  private async analyzeWithLLM(
    operations: Operation[],
    taskDescription?: string
  ): Promise<OperationFlow> {
    const simplifiedOps = operations.map((op, i) => {
      const base: any = { 
        index: i, 
        type: op.type, 
        url: op.url, 
        title: op.title,
        timestamp: op.timestamp,  // 带上时间戳，LLM 计算等待时间用
      };
      switch (op.type) {
        case 'click':
          return { ...base, targetText: 'target' in op ? op.target.textContent : '', selector: 'target' in op ? op.target.cssSelector : '' };
        case 'input': case 'select': case 'keydown':
          return { 
            ...base, 
            selector: 'target' in op ? op.target.cssSelector : '', 
            value: 'value' in op ? op.value : '',
          };
        default:
          return base;
      }
    });

    const systemPrompt = FLOW_ANALYSIS_PROMPT.replace('{{TASK_DESCRIPTION}}', taskDescription || '从操作序列中提取核心任务');
    const userPrompt = JSON.stringify(simplifiedOps, null, 2);

    console.log('\n' + '='.repeat(80));
    console.log('📤 [LLM 请求] 智能挖掘 - 分析操作序列');
    console.log('📋 操作数量:', operations.length);
    console.log('='.repeat(80) + '\n');

    const startTime = Date.now();
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.2,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) throw new Error(`LLM 请求失败: ${response.status}`);

    const data = await response.json();
    const costTime = Date.now() - startTime;
    const analysis = JSON.parse(data.choices[0].message.content);

    console.log('\n' + '='.repeat(80));
    console.log(`📥 [LLM 响应] 智能挖掘 - 耗时: ${costTime}ms`);
    console.log('🧠 LLM 完整响应:', JSON.stringify(analysis, null, 2));
    console.log('='.repeat(80) + '\n');

    return {
      id: `flow_${Date.now()}`,
      name: analysis.name,
      description: analysis.description + `\n\n💡 AI 意图分析: ${analysis.analysis?.detectedIntent || '已提取'}`,
      tags: analysis.tags || [],
      steps: analysis.steps.map((step: any, i: number) => ({
        id: `step_${Date.now()}_${i}`,
        action: step.action,
        description: step.description,
        target: step.targetSelector ? {
          tagName: '',
          cssSelector: step.targetSelector,
          xpath: '',
          attributes: {},
        } : undefined,
        value: step.value,
        waitTimeout: Math.min(parseInt(step.waitTimeout) || 3000, 10000), // 🔥 兜底：最大不超过 10 秒
      })),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  /**
   * 🧠 分析执行失败的原因
   */
  async analyzeFailure(
    flowName: string,
    pageUrl: string,
    successfulSteps: any[],
    failedStep: any,
    errorMessage: string,
    screenshotBase64?: string
  ): Promise<any> {
    if (!this.apiKey) {
      throw new Error('❌ 请配置 OpenAI API Key');
    }

    // 格式化已成功步骤
    const formattedSuccessSteps = successfulSteps.map((step, i) => 
      `步骤 ${i + 1}: ${step.description} (${step.action})`
    ).join('\n');

    // 格式化失败步骤
    const formattedFailedStep = `步骤: ${failedStep.description}
操作类型: ${failedStep.action}
选择器: ${failedStep.selector}
值: ${failedStep.value || '无'}`;

    let systemPrompt = FAILURE_ANALYSIS_PROMPT
      .replace('{{FLOW_NAME}}', flowName)
      .replace('{{PAGE_URL}}', pageUrl || '未知')
      .replace('{{SUCCESSFUL_STEPS}}', formattedSuccessSteps || '无（第一步就失败了）')
      .replace('{{FAILED_STEP}}', formattedFailedStep)
      .replace('{{ERROR_MESSAGE}}', errorMessage || '无错误信息');

    const messages: any[] = [
      { role: 'system', content: systemPrompt },
    ];

    // 如果有截图，添加到消息中（支持视觉模型）
    if (screenshotBase64) {
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: '这是失败时的页面截图，请结合截图分析失败原因' },
          { 
            type: 'image_url', 
            image_url: { 
              url: `data:image/png;base64,${screenshotBase64}`,
              detail: 'low'
            } 
          }
        ]
      });
    }

    console.log('\n' + '='.repeat(80));
    console.log('📤 [LLM 请求] 执行失败分析');
    console.log('📍 事务名称:', flowName);
    console.log('📍 页面 URL:', pageUrl);
    console.log('❌ 失败步骤:', failedStep.description);
    console.log('📸 包含截图:', !!screenshotBase64);
    console.log('='.repeat(80) + '\n');

    const startTime = Date.now();
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature: 0.3,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`LLM 请求失败 (${response.status}): ${errorText.slice(0, 100)}`);
    }

    const data = await response.json();
    const costTime = Date.now() - startTime;
    const analysis = JSON.parse(data.choices[0].message.content);

    console.log('\n' + '='.repeat(80));
    console.log(`📥 [LLM 响应] 失败分析 - 耗时: ${costTime}ms`);
    console.log('🧠 分析结果:', JSON.stringify(analysis, null, 2));
    console.log('='.repeat(80) + '\n');

    return analysis;
  }
}
