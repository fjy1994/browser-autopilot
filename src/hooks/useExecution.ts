import { useState } from 'react';
import { FlowAnalyzer } from '../llm/flow-analyzer';
import type { OperationFlow } from '../types';

export interface ExecutionStepState {
  id: string;
  index: number;
  status: 'pending' | 'running' | 'success' | 'failed';
  action: string;
  selector: string;
  description: string;
  value?: string;
  error?: string;
}

// 失败分析结果
export interface FailureAnalysis {
  loading: boolean;
  result?: any;
  error?: string;
}

interface ExecutionDeps {
  apiKey: string;
  apiBaseUrl: string;
  apiModel: string;
  executeQuery: string;
  flows: OperationFlow[];
  selectedFlow: OperationFlow | null;
  setSelectedFlow: (flow: OperationFlow | null) => void;
  setExecutionResult: (result: any) => void;
}

export function useExecution(deps: ExecutionDeps) {
  const {
    apiKey,
    apiBaseUrl,
    apiModel,
    executeQuery,
    flows,
    setSelectedFlow,
    setExecutionResult,
  } = deps;

  // 🚀 分步执行状态
  const [executionSteps, setExecutionSteps] = useState<ExecutionStepState[]>([]);
  const [currentStepIndex, setCurrentStepIndex] = useState(-1);
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionTabId, setExecutionTabId] = useState<number | null>(null);
  
  // 🧠 失败分析状态
  const [failureAnalysis, setFailureAnalysis] = useState<FailureAnalysis>({
    loading: false,
  });

  // 🚀 智能匹配事务 + 适配步骤值
  const executeNaturalLanguage = async () => {
    if (!executeQuery.trim()) return;

    // 🔄 重置所有执行相关的状态，确保第二次匹配能正确显示执行按钮
    setExecutionSteps([]);
    setCurrentStepIndex(-1);
    setIsExecuting(false);
    setExecutionTabId(null);

    setExecutionResult({
      loading: true,
      matched: null,
      reasoning: '🤖 正在智能匹配最合适的事务...',
    });

    try {
      const analyzer = new FlowAnalyzer({ apiKey, baseUrl: apiBaseUrl, model: apiModel });

      // 第 1 步：匹配事务
      const matchResult = await analyzer.selectFlowWithLLM(executeQuery, flows);

      if (!matchResult.flow) {
        setExecutionResult({
          loading: false,
          matched: false,
          reasoning: matchResult.reasoning || '未找到匹配的事务，请换个描述试试',
        });
        return;
      }

      // 第 2 步：适配事务步骤
      setExecutionResult({
        loading: true,
        matched: true,
        reasoning: '🔄 匹配成功！正在根据您的需求适配事务步骤...',
      });

      const adaptedFlow = await analyzer.adaptFlowWithLLM(executeQuery, matchResult.flow);

      // 完成，显示结果
      setSelectedFlow(adaptedFlow);
      setExecutionResult({
        loading: false,
        matched: true,
        flow: adaptedFlow,
        confidence: matchResult.confidence,
        reasoning: `匹配成功！置信度: ${(matchResult.confidence * 100).toFixed(0)}%\n${matchResult.reasoning}\n\n✅ 已根据您的需求适配步骤值`,
      });

    } catch (error: any) {
      console.error('执行失败:', error);
      setExecutionResult({
        loading: false,
        matched: false,
        reasoning: error.message || '执行失败，请重试',
      });
    }
  };

  // 🚀 开始分步执行事务
  const startStepExecution = async () => {
    if (!deps.selectedFlow || !deps.selectedFlow.steps) return;

    // 🔄 每次重新执行时，先重置标签页ID状态
    // 避免用户关闭标签页后，使用已失效的旧ID
    setExecutionTabId(null);

    // 1. 获取当前所有标签页，让用户选择执行目标
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime) {
        const { tabs } = await chrome.runtime.sendMessage({ type: 'GET_TABS' });
        
        // 构建选项：第一个是「新建标签页」，后面是当前打开的页面
        const options = [
          { id: 'new', label: '🆕 新建标签页执行 (推荐)' },
          ...tabs.map((t: any) => ({
            id: t.id,
            label: `${t.active ? '📍 ' : ''}${t.title}`,
          })),
        ];
        
        // 弹出选择框
        const tabNames = options.map((o, i) => `${i}. ${o.label}`).join('\n');
        const userInput = prompt(
          `请选择在哪个标签页执行:\n\n${tabNames}`,
          '0'
        );
        
        if (userInput === null) return; // 用户取消
        
        const selection = parseInt(userInput || '0', 10);
        const selectedOption = options[Math.min(selection, options.length - 1)];
        
        if (selectedOption.id === 'new') {
          setExecutionTabId(null); // null 表示新建
        } else {
          setExecutionTabId(selectedOption.id as number);
          console.log(`✅ 选择在标签页 ${selectedOption.id} 执行: ${selectedOption.label}`);
        }
      }
    } catch (e) {
      // 获取失败，默认新建标签页
      console.warn('⚠️ 获取标签页失败，默认新建标签页执行');
      setExecutionTabId(null);
    }

    // 2. 初始化步骤状态
    const initialSteps: ExecutionStepState[] = deps.selectedFlow.steps.map((step: any, index: number) => ({
      id: `step-${index}`,
      index,
      status: 'pending',
      action: step.action,
      selector: step.targetSelector || step.target?.cssSelector || '',
      description: step.description,
    }));

    setExecutionSteps(initialSteps);
    setCurrentStepIndex(0);
    setIsExecuting(true);

    // 开始执行第一步
    await executeStep(0, initialSteps);
  };

  // 📌 执行单个步骤
  // 🔧 关键：使用 currentTabId 参数而不是 executionTabId state，避免React状态更新异步导致的问题
  const executeStep = async (stepIndex: number, steps: ExecutionStepState[], currentTabId: number | null = executionTabId) => {
    if (stepIndex >= steps.length) {
      // ✅ 全部执行完成
      setIsExecuting(false);
      // 保留原来的匹配信息，只更新提示文字
      setExecutionResult((prev: any) => ({
        ...prev,
        success: true,
        matched: true,
        reasoning: '🎉 全部步骤执行完成！',
      }));
      return;
    }

    const step = steps[stepIndex];
    const flowStep = deps.selectedFlow?.steps?.[stepIndex];

    console.log(`\n▶️ 执行步骤 ${stepIndex + 1}/${steps.length}: ${step.description}`);

    // 更新为运行中状态
    const updatedSteps = [...steps];
    updatedSteps[stepIndex] = { ...step, status: 'running' };
    setExecutionSteps(updatedSteps);
    setCurrentStepIndex(stepIndex);

    try {
      // 🔧 调用 background 执行真实的浏览器操作
      if (typeof chrome === 'undefined' || !chrome.runtime) {
        throw new Error('请在插件 Dashboard 中使用此功能');
      }

      // 获取值，同时兼容多种数据结构
      let stepValue = flowStep?.value;
      
      // 如果是 navigate 且 value 为空，尝试从其他字段获取
      if (step.action === 'navigate' && !stepValue) {
        const flowStepAny = flowStep as any;
        stepValue = flowStepAny?.toUrl || flowStepAny?.url || flowStepAny?.target?.url || '';
      }
      
      console.log(`   - action: ${step.action}, selector: ${step.selector}, value: ${stepValue}, waitTimeout: ${flowStep?.waitTimeout || 5000}ms, targetTabId: ${currentTabId}`);

      const result = await chrome.runtime.sendMessage({
        type: 'EXECUTE_STEP',
        action: step.action,
        selector: step.selector,
        value: stepValue,
        targetTabId: currentTabId, // 🔧 使用函数参数传入的 tabId，而不是 state
        stepIndex: stepIndex,
        waitTimeout: flowStep?.waitTimeout || 5000,
        description: step.description,
      });

      // 🔧 获取后台返回的最新 tabId（可能是新建的标签页）
      const latestTabId = result.tabId || currentTabId;

      // 同时也更新到 state 中，确保用户能看到最新状态
      if (result.tabId) {
        console.log(`✅ 使用标签页执行，Tab ID: ${result.tabId}`);
        setExecutionTabId(result.tabId);
      }

      // ✅ 关键：判断后台返回的 success 字段
      if (result.success) {
        console.log(`✅ 步骤 ${stepIndex + 1} 执行成功`);
        updatedSteps[stepIndex] = { ...step, status: 'success' };
        setExecutionSteps([...updatedSteps]);

        // 🔧 立即执行下一步，传入最新的 tabId，不依赖 state
        setTimeout(() => executeStep(stepIndex + 1, updatedSteps, latestTabId), 300);
      } else {
        // ❌ 后台返回执行失败
        const errorMsg = result.error || '未知错误';
        console.error(`❌ 步骤 ${stepIndex + 1} 执行失败: ${errorMsg}`);
        throw new Error(errorMsg); // 抛出错误，由 catch 块统一处理
      }

    } catch (error: any) {
      // ❌ 执行失败
      console.error(`❌ 步骤 ${stepIndex + 1} 执行失败:`, error);
      const errorMessage = error.message || '执行失败';
      updatedSteps[stepIndex] = {
        ...step,
        status: 'failed',
        error: errorMessage,
      };
      setExecutionSteps([...updatedSteps]);
      setIsExecuting(false); // 暂停，等待用户决策

      // 🧠 调用 LLM 分析失败原因
      await analyzeFailure(stepIndex, updatedSteps, currentTabId, errorMessage);
    }
  };

  // 🔄 用户选择：重试当前步骤
  const retryStep = async () => {
    setIsExecuting(true);
    // 重试时传入最新的 tabId
    await executeStep(currentStepIndex, executionSteps, executionTabId);
  };

  // ⏭️ 用户选择：跳过当前步骤
  const skipStep = async () => {
    const updatedSteps = [...executionSteps];
    updatedSteps[currentStepIndex] = {
      ...updatedSteps[currentStepIndex],
      status: 'success',
      error: '(用户跳过)',
    };
    setExecutionSteps(updatedSteps);
    setIsExecuting(true);
    // 跳过时传入最新的 tabId
    await executeStep(currentStepIndex + 1, updatedSteps, executionTabId);
  };

  // ❌ 用户选择：取消执行
  const cancelExecution = () => {
    setIsExecuting(false);
    setExecutionSteps([]);
    setCurrentStepIndex(-1);
    setExecutionTabId(null);
    // 同时清空失败分析
    setFailureAnalysis({ loading: false });
  };

  // 🧠 分析失败原因（截图 + LLM）
  const analyzeFailure = async (
    stepIndex: number,
    steps: ExecutionStepState[],
    tabId: number | null,
    errorMessage: string
  ) => {
    try {
      setFailureAnalysis({ loading: true });

      // 1. 获取页面截图和 URL
      let screenshot: string | undefined;
      let pageUrl = '';
      
      if (tabId && typeof chrome !== 'undefined' && chrome.runtime) {
        try {
          const result = await chrome.runtime.sendMessage({
            type: 'CAPTURE_SCREENSHOT',
            tabId,
          });
          
          if (result.success) {
            screenshot = result.screenshot;
            pageUrl = result.pageUrl;
            console.log('📸 截图成功，大小:', (screenshot.length / 1024).toFixed(2), 'KB');
          }
        } catch (screenshotError) {
          console.warn('⚠️ 获取截图失败，将不使用截图进行分析:', screenshotError);
        }
      }

      // 2. 收集已成功的步骤
      const successfulSteps = steps.slice(0, stepIndex).filter(s => s.status === 'success');
      const failedStep = steps[stepIndex];

      // 3. 调用 LLM 分析
      const analyzer = new FlowAnalyzer({ apiKey: deps.apiKey, baseUrl: deps.apiBaseUrl, model: deps.apiModel });
      const analysis = await analyzer.analyzeFailure(
        deps.selectedFlow?.name || '未知事务',
        pageUrl,
        successfulSteps,
        {
          ...failedStep,
          value: deps.selectedFlow?.steps?.[stepIndex]?.value,
        },
        errorMessage,
        screenshot
      );

      setFailureAnalysis({
        loading: false,
        result: analysis,
      });

    } catch (analysisError: any) {
      console.error('❌ 失败分析出错:', analysisError);
      setFailureAnalysis({
        loading: false,
        result: null,
        error: analysisError.message || '分析失败',
      });
    }
  };

  return {
    executeNaturalLanguage,
    // 🚀 分步执行相关
    executionSteps,
    currentStepIndex,
    isExecuting,
    startStepExecution,
    retryStep,
    skipStep,
    cancelExecution,
    // 🧠 失败分析相关
    failureAnalysis,
    analyzeFailure,
  };
}
