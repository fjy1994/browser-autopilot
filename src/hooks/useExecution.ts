import { FlowAnalyzer } from '../llm/flow-analyzer';
import { CODE_GENERATION_PROMPT } from '../llm/prompts';
import type { OperationFlow } from '../types';

interface ExecutionDeps {
  apiKey: string;
  apiBaseUrl: string;
  apiModel: string;
  executeQuery: string;
  flows: OperationFlow[];
  selectedFlow: OperationFlow | null;
  executionResult: any;
  generatedCode: string;
  setSelectedFlow: (flow: OperationFlow | null) => void;
  setGeneratedCode: (code: string) => void;
  setExecutionResult: (result: any) => void;
  setIsExecuting: (val: boolean) => void;
  setExecutionProgress: (progress: any) => void;
}

export function useExecution(deps: ExecutionDeps) {
  const {
    apiKey,
    apiBaseUrl,
    apiModel,
    executeQuery,
    flows,
    selectedFlow,
    executionResult,
    setSelectedFlow,
    setGeneratedCode,
    setExecutionResult,
    setIsExecuting,
    setExecutionProgress,
  } = deps;

  // 执行自然语言查询 - LLM 智能选择 Skill
  const executeNaturalLanguage = async () => {
    if (!executeQuery.trim()) return;
    
    // ✅ 第一阶段：正在匹配工作流
    setGeneratedCode('// 🔍 正在匹配工作流，请稍候...');
    setExecutionResult({
      isMatching: true, // 特殊标记：匹配中
      message: '🔍 正在匹配工作流...',
      reasoning: '正在分析您的需求，查找最适合的自动化流程'
    });
    
    const analyzer = new FlowAnalyzer({ apiKey, baseUrl: apiBaseUrl, model: apiModel });

    try {
      // ========== 🧠 第一步：LLM 匹配工作流 ==========
      console.log('[App] 🔍 用户查询:', executeQuery);
      
      const result = await analyzer.selectFlowWithLLM(executeQuery, flows);
      
      if (!result.flow) {
        setExecutionResult({
          matched: false,
          message: `未找到匹配的工作流。请尝试更清晰的描述，或者先录制新的操作流程。`,
          reasoning: result.reasoning || 'LLM 无法匹配到合适的工作流',
        });
        setGeneratedCode(`// ❌ 未找到匹配的工作流
// 
// 用户查询: ${executeQuery}
// 
// 建议:
// 1. 尝试更清晰地描述您的需求（包含网站/功能名称）
// 2. 先在 Sessions 页面录制新的操作流程
// 3. 检查 Flows 列表中是否有您需要的工作流`);
        return;
      }

      // ========== ✅ 第二阶段：匹配成功，正在生成代码 ==========
      const flowWithParams = JSON.parse(JSON.stringify(result.flow));
      
      // 提取参数
      let extractedKeyword: string | null = null;
      const possibleKeys = ['inputValue', 'keyword', 'query', 'search', 'text', 'value', 'content', 'input'];
      for (const key of possibleKeys) {
        if (result.args[key]) {
          extractedKeyword = result.args[key];
          break;
        }
      }
      if (!extractedKeyword && Object.values(result.args).length > 0) {
        extractedKeyword = Object.values(result.args)[0] as string;
      }
      
      // 参数替换到 flow 的步骤中
      if (extractedKeyword && flowWithParams.steps) {
        for (const step of flowWithParams.steps) {
          if (step.value && typeof step.value === 'string') {
            step.value = extractedKeyword;
          }
          if (step.target?.value && typeof step.target.value === 'string') {
            step.target.value = extractedKeyword;
          }
        }
      }
      
      setSelectedFlow(flowWithParams);
      
      // ✅ 更新为正在生成代码状态
      setExecutionResult({
        matched: true,
        flow: flowWithParams,
        confidence: result.confidence,
        reasoning: '✅ 已匹配工作流，正在生成 Playwright 代码...',
        args: result.args,
      });
      setGeneratedCode('// 🚀 正在生成 Playwright 代码，请稍候...');

      console.log('[App] ✅ 已匹配 Flow:', flowWithParams.name);
      
      // ========== 🤖 第二步：LLM 生成优化后的步骤和代码 ==========
      if (!apiKey) throw new Error('请配置 OpenAI API Key');

      // 构建 Prompt
      const systemPrompt = CODE_GENERATION_PROMPT;
      const userPrompt = `用户需求: ${executeQuery}
原始步骤列表：
${JSON.stringify(flowWithParams.steps.map((s: any) => ({
  action: s.action,
  selector: s.target?.cssSelector,
  value: s.value,
  description: s.description
})), null, 2)}`;
      
      // 📤 LLM 请求
      console.log('\n' + '='.repeat(80));
      console.log('📤 [LLM 请求 2/2] 生成代码');
      console.log('='.repeat(80) + '\n');

      // 🔥 生成 Playwright 代码
      const response = await fetch(`${apiBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: apiModel,
          temperature: 0.1,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        }),
      });

      if (!response.ok) {
        throw new Error(`API 错误: ${response.status} ${await response.text()}`);
      }

      const llmResult = await response.json();
      let llmContent = llmResult.choices[0].message.content;
      
      // 📥 打印完整响应
      console.log('\n' + '='.repeat(80));
      console.log('📥 [LLM 响应] - 步骤 + 代码');
      console.log(llmContent);
      console.log('='.repeat(80) + '\n');
      
      // 解析 JSON
      let parsedResult;
      try {
        // 先清理 markdown 标记
        const jsonStr = llmContent.replace(/```json/g, '').replace(/```/g, '').trim();
        parsedResult = JSON.parse(jsonStr);
      } catch (e) {
        console.warn('[App] ⚠️ JSON 解析失败，降级处理');
        // 降级：提取代码
        const codeMatch = llmContent.match(/```javascript([\s\S]*?)```/) || llmContent.match(/```js([\s\S]*?)```/);
        parsedResult = {
          steps: flowWithParams.steps, // 用原步骤
          code: codeMatch ? codeMatch[1] : llmContent
        };
      }
      
      // 🔥 关键：用 LLM 返回的优化步骤替换原来的步骤！
      if (parsedResult.steps && Array.isArray(parsedResult.steps) && parsedResult.steps.length > 0) {
        flowWithParams.steps = parsedResult.steps.map((s: any, i: number) => ({
          id: `step_${Date.now()}_${i}`,
          action: s.action || 'click',
          description: s.description || '',
          target: {
            tagName: '',
            cssSelector: s.selector || '',
            xpath: '',
            attributes: {},
          },
          value: s.value || '',
          key: s.key || '',
          conditions: [],
        }));
        console.log('[App] ✅ 已替换为 LLM 优化后的步骤，共', flowWithParams.steps.length, '步');
      }
      
      // 提取代码
      let code = parsedResult.code || llmContent;
      code = code.replace(/```javascript/g, '').replace(/```js/g, '').replace(/```/g, '').trim();
      
      // 从代码中提取标题（第一行）
      const titleMatch = code.match(/\/\/ === (.+?) ===/);
      flowWithParams.name = titleMatch ? titleMatch[1].trim() : executeQuery;
      
      console.log('[App] ✅ LLM 处理完成');
      
      setSelectedFlow(flowWithParams);
      setGeneratedCode(code);
      
      // ✅ 第三阶段：代码生成完成，标记 codeReady 为 true，显示执行按钮
      setExecutionResult({
        matched: true,
        flow: flowWithParams,
        confidence: result.confidence,
        reasoning: '✨ Playwright 代码已生成完成',
        args: result.args,
        codeReady: true, // 标记代码已就绪，用于显示执行按钮
      });
      
    } catch (error) {
      // ⚠️ LLM 分析失败：直接显示错误，绝不降级
      console.error('[App] ❌ LLM 处理失败:', error);
      const errorMsg = error instanceof Error ? error.message : String(error);
      
      setExecutionResult({
        matched: false,
        message: errorMsg,
        reasoning: 'LLM 处理失败，请检查 API 配置后重试',
      });
      
      setGeneratedCode(`// ❌ LLM 处理失败
// 
// 错误信息: ${errorMsg}
// 
// 检查清单:
// 1. ✅ API Key 是否正确配置？
// 2. ✅ API Base URL 是否正确？
// 3. ✅ API 余额是否充足？
// 4. ✅ 网络连接是否正常？`);
    }
  };

  // 🚀 执行 Flow（通过扩展在当前活动标签页执行）
  const executeFlowInPage = async () => {
    if (!selectedFlow) return;
    
    if (!chrome?.runtime) {
      alert('⚠️ This feature only works when Dashboard is opened from the Chrome Extension!\n\nPlease open Dashboard by clicking the extension icon → "Open Dashboard"');
      return;
    }
    
    setIsExecuting(true);
    setExecutionProgress({
      currentStep: 0,
      totalSteps: selectedFlow.steps.length,
      status: '⏳ Sending execution command to active tab...',
    });
    
    try {
      const args = executionResult?.args || {};
      
      // 显示执行开始
      setExecutionProgress({
        currentStep: 0,
        totalSteps: selectedFlow.steps.length,
        status: '▶️ Flow started! Check your target page...',
      });
      
      // 通过 Background 发送命令给当前活动标签页
      await chrome.runtime.sendMessage({
        action: 'EXECUTE_FLOW',
        flow: selectedFlow,
        args,
      });
      
      // 更新状态为执行中
      setExecutionProgress({
        currentStep: 0,
        totalSteps: selectedFlow.steps.length,
        status: '🚀 Flow started! Switch to the target page to watch it execute...',
      });
      
      // 3秒后显示完成提示（因为是后台异步执行）
      setTimeout(() => {
        setExecutionProgress({
          currentStep: selectedFlow.steps.length,
          totalSteps: selectedFlow.steps.length,
          status: `✅ Execution command sent! Check your target page.\n\n(The flow is running in the background)`,
        });
        setIsExecuting(false);
      }, 3000);
    } catch (error) {
      console.error('Execution error:', error);
      setExecutionProgress({
        currentStep: -1,
        totalSteps: 0,
        status: `❌ Error: ${String(error)}\n\nMake sure the target page is open and refreshed!`,
      });
    } finally {
      setTimeout(() => setIsExecuting(false), 1000);
    }
  };

  // 复制代码
  const copyCode = () => {
    navigator.clipboard.writeText(deps.generatedCode);
    alert('Code copied to clipboard');
  };

  return {
    executeNaturalLanguage,
    executeFlowInPage,
    copyCode,
  };
}
