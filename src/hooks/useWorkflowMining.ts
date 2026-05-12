import { WorkflowMiner } from '../llm/workflow-miner';
import { FlowAnalyzer } from '../llm/flow-analyzer';
import { flowDb } from '../storage/flow-db';
import type { OperationSession, OperationFlow } from '../types';

type TabType = 'flows' | 'execute' | 'settings';

interface WorkflowMiningDeps {
  sessions: OperationSession[];
  apiKey: string;
  apiBaseUrl: string;
  apiModel: string;
  setIsMining: (val: boolean) => void;
  setMiningProgress: (progress: any) => void;
  setActiveTab: (tab: TabType) => void;
  loadData: () => Promise<void>;
}

export function useWorkflowMining(deps: WorkflowMiningDeps) {
  const {
    sessions,
    apiKey,
    apiBaseUrl,
    apiModel,
    setIsMining,
    setMiningProgress,
    setActiveTab,
    loadData,
  } = deps;

  // 🚀 一键智能挖掘 - 从所有会话中自动提取所有工作流
  const mineAllWorkflows = async () => {
    // 只分析未被挖掘过的会话
    const unminedSessions = sessions.filter((s: any) => !s.hasBeenMined);
    
    if (unminedSessions.length === 0) {
      if (sessions.length === 0) {
        alert('没有可分析的会话数据！请先录制一些操作。');
      } else {
        alert('所有会话都已经分析过了，没有新数据需要处理。');
      }
      return;
    }

    // ⚠️ 强制 LLM 模式需要 API Key
    if (!apiKey) {
      alert('❌ 必须配置 OpenAI API Key 才能使用智能挖掘功能！\n请在 Settings 页面配置 API Key。');
      return;
    }

    setIsMining(true);
    setMiningProgress({
      totalOps: 0,
      filteredCount: 0,
      sessionCount: 0,
      flowCount: 0,
      currentStep: '准备中...',
    });

    try {
      const miner = new WorkflowMiner();

      // 收集所有操作
      setMiningProgress((prev: any) => prev ? { ...prev, currentStep: '收集操作数据...' } : null);
      
      let allOperations: any[] = [];
      for (const session of unminedSessions) {
        allOperations.push(...session.operations);
      }
      
      // 按时间排序
      allOperations.sort((a, b) => a.timestamp - b.timestamp);
      
      setMiningProgress((prev: any) => prev ? {
        ...prev,
        totalOps: allOperations.length,
        currentStep: '🤖 LLM 智能分析中...',
      } : null);

      let finalFlows: OperationFlow[];
      let filtered = 0;
      let sessionCount = 0;

      // ========== 🤖 强制 LLM 模式 ==========
      const analyzer = new FlowAnalyzer({ apiKey, baseUrl: apiBaseUrl, model: apiModel });
      
      // 1. 先噪音过滤和会话分割
      const filteredOps = miner.filterNoise(allOperations);
      filtered = allOperations.length - filteredOps.length;
      const splitSessions = miner.splitIntoSessions(filteredOps);
      sessionCount = splitSessions.length;

      // 2. 逐个用 LLM 分析（绝不降级！）
      finalFlows = [];
      let meaninglessCount = 0; // 无意义事务计数
      for (let i = 0; i < splitSessions.length; i++) {
        const sessionOps = splitSessions[i];
        setMiningProgress((prev: any) => prev ? {
          ...prev,
          currentStep: `🤖 分析第 ${i + 1}/${splitSessions.length} 个任务...`,
        } : null);
        
        const flow = await analyzer.analyzeOperations(sessionOps);
        
        // 🔥 关键判断：无意义事务不保存！
        const flowAny = flow as any;
        const isMeaningless = flowAny.analysis?.isMeaningful === false 
          || flow.steps.length === 0;
        
        if (isMeaningless) {
          meaninglessCount++;
          console.log(`⚠️ 跳过无意义事务: ${flowAny.analysis?.reason || '无有效步骤'}`);
          continue;
        }
        
        flow.isAutoMined = true;
        flow.description += '\n\n💡 使用 LLM 智能分析生成';
        finalFlows.push(flow);
      }

      setMiningProgress((prev: any) => prev ? {
        ...prev,
        filteredCount: filtered,
        sessionCount,
        flowCount: finalFlows.length,
        meaninglessCount, // 无意义事务数
        currentStep: '保存事务...',
      } : null);

      // 保存所有挖掘出的事务
      for (const flow of finalFlows) {
        await flowDb.saveFlow(flow);
      }

      // 标记这些会话为已挖掘，避免重复分析
      for (const session of unminedSessions) {
        (session as any).hasBeenMined = true;
        await flowDb.saveSession(session);
      }

      // 刷新数据
      await loadData();

      setMiningProgress((prev: any) => prev ? {
        ...prev,
        currentStep: '✅ 完成！',
      } : null);

      // 显示统计结果
      setTimeout(() => {
        alert(
          `🎉 LLM 智能挖掘完成！\n\n` +
          `📊 统计信息：\n` +
          `  • 原始操作数: ${allOperations.length}\n` +
          `  • 过滤噪音: ${filtered}\n` +
          `  • 识别任务数: ${sessionCount}\n` +
          `  • 无意义事务: ${meaninglessCount} (已自动跳过)\n` +
          `  • 提取有意义事务: ${finalFlows.length}\n\n` +
          `已自动保存到事务列表中！`
        );
        setIsMining(false);
        setMiningProgress(null);
        setActiveTab('flows');
      }, 1000);

    } catch (error) {
      console.error('Mining failed:', error);
      alert('挖掘失败: ' + error);
      setIsMining(false);
      setMiningProgress(null);
    }
  };

  return { mineAllWorkflows };
}
