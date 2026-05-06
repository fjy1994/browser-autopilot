import type { Operation, OperationFlow } from '../types';
import { FLOW_MATCH_PROMPT, FLOW_ANALYSIS_PROMPT } from './prompts';

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
    args: Record<string, string>;
    reasoning: string;
  }> {
    if (!this.apiKey) {
      throw new Error('❌ 请配置 OpenAI API Key');
    }

    if (availableFlows.length === 0) {
      return { flow: null, confidence: 0, args: {}, reasoning: 'No flows available' };
    }

    // 构建 skills 列表
    const skills = availableFlows.map(flow => {
      const inputSteps = flow.steps.filter(s => s.action === 'input' && s.value);
      return {
        id: flow.id,
        name: flow.name,
        description: flow.description.slice(0, 200),
        tags: flow.tags,
        stepCount: flow.steps.length,
        hasInputParam: inputSteps.length > 0,
        exampleValue: inputSteps.length > 0 ? inputSteps[0].value : null,
      };
    });

    const systemPrompt = FLOW_MATCH_PROMPT.replace('{{FLOW_LIST}}', JSON.stringify(skills, null, 2));

    // 📤 LLM 请求
    console.log('\n' + '='.repeat(80));
    console.log('📤 [LLM 请求 1/2] Flow 匹配');
    console.log('👤 用户查询:', userQuery);
    console.log('📋 Flow 数量:', availableFlows.length);
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
    let args: Record<string, string> = {};
    const possibleArgKeys = ['extractedArgs', 'args', 'parameters', 'params', 'variables', 'inputs'];
    for (const key of possibleArgKeys) {
      if (result[key] && typeof result[key] === 'object' && Object.keys(result[key]).length > 0) {
        args = result[key];
        break;
      }
    }

    return {
      flow: selectedFlow || null,
      confidence: result.confidenceScore || result.confidence || 0,
      args,
      reasoning: result.reasoning || result.explanation || 'LLM selection',
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

    const filteredOps = this.condenseOperations(operations);
    
    // 使用 LLM 智能分析
    const llmResult = await this.analyzeWithLLM(filteredOps, options.taskDescription);
    
    // 本地代码最后把关：确保 Enter 键不会丢失
    const hasEnterInOriginal = operations.some(op => op.type === 'keydown' && (op as any).key === 'Enter');
    const hasEnterInLLM = llmResult.steps.some(s => s.action === 'keydown' || s.key === 'Enter');
    
    if (hasEnterInOriginal && !hasEnterInLLM) {
      const lastInputStep = llmResult.steps.filter(s => s.action === 'input').pop();
      const selector = lastInputStep?.target?.cssSelector || '#kw';
      llmResult.steps.push({
        id: `step_${Date.now()}_enter`,
        action: 'keydown',
        description: 'Press Enter key to submit/search',
        target: { tagName: 'input', cssSelector: selector, xpath: '', attributes: {} },
        key: 'Enter',
      });
    }
    
    return llmResult;
  }

  /**
   * 使用 LLM 分析操作序列
   */
  private async analyzeWithLLM(
    operations: Operation[],
    taskDescription?: string
  ): Promise<OperationFlow> {
    const simplifiedOps = operations.map((op, i) => {
      const base: any = { index: i, type: op.type, url: op.url, title: op.title };
      switch (op.type) {
        case 'click':
          return { ...base, targetText: 'target' in op ? op.target.textContent : '', selector: 'target' in op ? op.target.cssSelector : '' };
        case 'input': case 'select': case 'keydown':
          return { 
            ...base, 
            selector: 'target' in op ? op.target.cssSelector : '', 
            value: 'value' in op ? op.value : '',
            key: 'key' in op ? (op as any).key : undefined
          };
        default:
          return base;
      }
    });

    const systemPrompt = FLOW_ANALYSIS_PROMPT.replace('{{TASK_DESCRIPTION}}', taskDescription || '从操作序列中提取核心任务');
    const userPrompt = JSON.stringify(simplifiedOps, null, 2);

    console.log('\n' + '='.repeat(80));
    console.log('📤 [LLM 请求] 智能挖掘 - 分析操作序列');
    console.log('🧠 System Prompt 长度:', systemPrompt.length);
    console.log('👤 User Prompt 长度:', userPrompt.length);
    console.log('📋 操作数量:', operations.length);
    console.log('='.repeat(80));
    console.log('🧠 System Prompt:\n', systemPrompt);
    console.log('='.repeat(80));
    console.log('👤 User Prompt:\n', userPrompt);
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
        key: step.key,
        conditions: step.conditions || [],
      })),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  /**
   * 压缩操作序列（简单去重）
   */
  private condenseOperations(operations: Operation[]): Operation[] {
    const result: Operation[] = [];
    for (let i = 0; i < operations.length; i++) {
      const op = operations[i];
      if (op.type === 'scroll' && result.length > 0 && result[result.length - 1].type === 'scroll') continue;
      if (op.type === 'input' && result.length > 0) {
        const lastOp = result[result.length - 1];
        if (lastOp.type === 'input' && 'target' in lastOp && 'target' in op &&
            lastOp.target.cssSelector === op.target.cssSelector) {
          (result[result.length - 1] as any).value = (op as any).value;
          continue;
        }
      }
      result.push(op);
    }
    return result;
  }
}
