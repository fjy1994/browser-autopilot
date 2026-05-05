import { useEffect, useState } from 'react';
import { FlowAnalyzer } from './llm/flow-analyzer';
import { WorkflowMiner } from './llm/workflow-miner';
import { CODE_GENERATION_PROMPT } from './llm/prompts';
import { flowDb } from './storage/flow-db';
import { PlaywrightRunner } from './executor/playwright-runner';
import type { OperationSession, OperationFlow } from './recorder/types';

type TabType = 'sessions' | 'flows' | 'execute' | 'settings';

export function App() {
  const [activeTab, setActiveTab] = useState<TabType>('sessions');
  const [sessions, setSessions] = useState<OperationSession[]>([]);
  const [flows, setFlows] = useState<OperationFlow[]>([]);
  const [selectedSession, setSelectedSession] = useState<OperationSession | null>(null);
  const [selectedFlow, setSelectedFlow] = useState<OperationFlow | null>(null);
  const [generatedCode, setGeneratedCode] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [apiBaseUrl, setApiBaseUrl] = useState('https://api.openai.com/v1');
  const [apiModel, setApiModel] = useState('gpt-4o-mini');
  const [executeQuery, setExecuteQuery] = useState('');
  const [executionResult, setExecutionResult] = useState<any>(null);
  const [taskDescription, setTaskDescription] = useState('');
  const [targetDomain, setTargetDomain] = useState('');
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionProgress, setExecutionProgress] = useState<{
    currentStep: number;
    totalSteps: number;
    status: string;
  } | null>(null);
  
  // 🧠 工作流挖掘状态
  const [isMining, setIsMining] = useState(false);
  const [miningProgress, setMiningProgress] = useState<{
    totalOps: number;
    filteredCount: number;
    sessionCount: number;
    flowCount: number;
    currentStep: string;
  } | null>(null);

  // 初始化
  useEffect(() => {
    initApp();
  }, []);

  // 将 flows 暴露到 window 供控制台调试
  useEffect(() => {
    (window as any).flows = flows;
  }, [flows]);

  const initApp = async () => {
    try {
      await flowDb.init();
      await loadData();
      
      const savedKey = await flowDb.getSetting('openai_api_key');
      if (savedKey) setApiKey(savedKey);
      
      const savedBaseUrl = await flowDb.getSetting('openai_base_url');
      if (savedBaseUrl) setApiBaseUrl(savedBaseUrl);
      
      const savedModel = await flowDb.getSetting('openai_model');
      if (savedModel) setApiModel(savedModel);
    } catch (error) {
      console.error('Init failed:', error);
    }
  };

  const loadData = async () => {
    const [sessionsData, flowsData] = await Promise.all([
      flowDb.getAllSessions(),
      flowDb.getAllFlows(),
    ]);
    setSessions(sessionsData);
    setFlows(flowsData);
  };

  // 从 Chrome 扩展导入数据
  const importFromExtension = async () => {
    if (!chrome?.runtime) {
      alert('Please open this page from the Chrome extension');
      return;
    }
    
    try {
      // 1. 导入当前正在录制的会话
      const response = await chrome.runtime.sendMessage({ 
        action: 'GET_SESSIONS',
        limit: 20,
      });
      
      let importedCount = 0;
      
      for (const session of response.sessions) {
        await flowDb.saveSession(session);
        importedCount++;
      }

      // 2. 导入自动保存的会话（background 空闲时保存的）
      if (chrome.storage?.local) {
        try {
          const storage = await chrome.storage.local.get('autoSavedSessions');
          const autoSessions = storage.autoSavedSessions || [];
          
          for (const session of autoSessions) {
            // 检查是否已存在（避免重复导入）
            const existing = await flowDb.getSession(session.id);
            if (!existing) {
              await flowDb.saveSession(session);
              importedCount++;
            }
          }

          // 清空已导入的会话
          if (autoSessions.length > 0) {
            await chrome.storage.local.set({ autoSavedSessions: [] });
          }
        } catch (storageErr) {
          console.log('No auto-saved sessions or storage error');
        }
      }
      
      await loadData();
      alert(`✅ 成功导入 ${importedCount} 个会话`);
    } catch (error) {
      alert('Import failed: ' + error);
    }
  };

  // 分析会话生成流程
  const analyzeSession = async (session: OperationSession) => {
    // 立即更新UI状态
    setSelectedSession(session);
    setIsAnalyzing(true);
    
    try {
      // 步骤1: 初始化分析器
      await new Promise(resolve => setTimeout(resolve, 50)); // 让UI先渲染
      
      // 强制从数据库读取最新的 API Key！React state 可能还没更新！
      const freshApiKey = await flowDb.getSetting('openai_api_key');
      
      const analyzer = new FlowAnalyzer({ 
        apiKey: freshApiKey || apiKey,
        baseUrl: apiBaseUrl,
        model: apiModel,
        taskDescription: taskDescription || undefined,
        targetDomain: targetDomain || undefined,
      });
      
      const flow = await analyzer.analyzeOperations(session.operations, {
        taskDescription: taskDescription || undefined,
        targetDomain: targetDomain || undefined,
      });
      
      // 步骤3: 保存到数据库
      await flowDb.saveFlow(flow);
      await loadData();
      
      // 步骤4: 选中并生成代码
      setSelectedFlow(flow);
      
      const runner = new PlaywrightRunner();
      const code = runner.generateCode(flow);
      setGeneratedCode(code);
      
    } catch (error) {
      console.error('Analysis failed:', error);
      alert('Analysis failed: ' + error);
    } finally {
      setIsAnalyzing(false);
    }
  };

  // 🚀 一键智能挖掘 - 从所有会话中自动提取所有工作流
  const mineAllWorkflows = async () => {
    if (sessions.length === 0) {
      alert('没有可分析的会话数据！请先录制一些操作。');
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
      setMiningProgress(prev => prev ? { ...prev, currentStep: '收集操作数据...' } : null);
      
      let allOperations: any[] = [];
      for (const session of sessions) {
        allOperations.push(...session.operations);
      }
      
      // 按时间排序
      allOperations.sort((a, b) => a.timestamp - b.timestamp);
      
      setMiningProgress(prev => prev ? {
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
      for (let i = 0; i < splitSessions.length; i++) {
        const sessionOps = splitSessions[i];
        setMiningProgress(prev => prev ? {
          ...prev,
          currentStep: `🤖 分析第 ${i + 1}/${splitSessions.length} 个任务...`,
        } : null);
        
        const flow = await analyzer.analyzeOperations(sessionOps, { taskDescription: '提取核心工作流' });
        flow.isAutoMined = true;
        flow.description += '\n\n💡 使用 LLM 智能分析生成';
        finalFlows.push(flow);
      }

      setMiningProgress(prev => prev ? {
        ...prev,
        filteredCount: filtered,
        sessionCount,
        flowCount: finalFlows.length,
        currentStep: '保存工作流...',
      } : null);

      // 保存所有挖掘出的工作流
      for (const flow of finalFlows) {
        await flowDb.saveFlow(flow);
      }

      // 刷新数据
      await loadData();

      setMiningProgress(prev => prev ? {
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
          `  • 提取工作流: ${finalFlows.length}\n\n` +
          `已自动保存到 Flows 列表中！`
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

      const runner = new PlaywrightRunner();
      const baseCode = runner.generateCode(flowWithParams);
      
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

  // 保存 API 设置
  const saveApiKey = async () => {
    await flowDb.setSetting('openai_api_key', apiKey);
    await flowDb.setSetting('openai_base_url', apiBaseUrl);
    await flowDb.setSetting('openai_model', apiModel);
    alert('✅ API Settings saved');
  };

  // 删除会话
  const deleteSession = async (id: string) => {
    if (confirm('Delete this session?')) {
      await flowDb.deleteSession(id);
      await loadData();
      if (selectedSession?.id === id) setSelectedSession(null);
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

  // 删除流程
  const deleteFlow = async (id: string) => {
    if (confirm('Delete this flow?')) {
      await flowDb.deleteFlow(id);
      await loadData();
      if (selectedFlow?.id === id) setSelectedFlow(null);
    }
  };

  // 复制代码
  const copyCode = () => {
    navigator.clipboard.writeText(generatedCode);
    alert('Code copied to clipboard');
  };

  return (
    <div style={{ 
      minHeight: '100vh', 
      background: '#0a0a0a', 
      color: '#fff',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      {/* Header */}
      <header style={{
        padding: '20px 40px',
        borderBottom: '1px solid #222',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 36,
            height: 36,
            background: 'linear-gradient(135deg, #00d4aa, #3b82f6)',
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 'bold',
            fontSize: 18,
          }}>A</div>
          <h1 style={{ margin: 0, fontSize: 20 }}>Autopilot Dashboard</h1>
        </div>
        
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          {/* LLM 挖掘开关 */}
          <button 
            onClick={mineAllWorkflows}
            disabled={isMining}
            style={{
              padding: '8px 16px',
              background: isMining 
                ? '#666' 
                : 'linear-gradient(135deg, #8b5cf6, #06b6d4)',
              border: 'none',
              borderRadius: 6,
              color: '#fff',
              cursor: isMining ? 'not-allowed' : 'pointer',
              fontWeight: 500,
            }}
          >
            {isMining ? '⏳ 挖掘中...' : '🤖 LLM 智能挖掘'}
          </button>
          
          <button 
            onClick={importFromExtension}
            style={{
              padding: '8px 16px',
              background: 'linear-gradient(135deg, #00d4aa, #3b82f6)',
              border: 'none',
              borderRadius: 6,
              color: '#fff',
              cursor: 'pointer',
              fontWeight: 500,
            }}
          >
            🔄 Import from Extension
          </button>
        </div>
      </header>

      {/* Tabs */}
      <nav style={{
        padding: '0 40px',
        borderBottom: '1px solid #222',
      }}>
        {(['sessions', 'flows', 'execute', 'settings'] as TabType[]).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: '16px 24px',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === tab ? '2px solid #00d4aa' : '2px solid transparent',
              color: activeTab === tab ? '#00d4aa' : '#888',
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: 500,
              textTransform: 'capitalize',
            }}
          >
            {tab === 'sessions' && '📋 Sessions'}
            {tab === 'flows' && '⚡ Flows'}
            {tab === 'execute' && '🚀 Execute'}
            {tab === 'settings' && '⚙️ Settings'}
          </button>
        ))}
      </nav>

      {/* Content */}
      <main style={{ padding: 24, display: 'grid', gridTemplateColumns: 'minmax(400px, 1fr) minmax(500px, 1fr)', gap: 24 }}>
        {/* Left Panel - List */}
        <div style={{ minWidth: 0 }}>
          {activeTab === 'sessions' && (
            <div>
              <h2 style={{ fontSize: 16, marginBottom: 16, color: '#888' }}>
                Recorded Sessions ({sessions.length})
              </h2>

              {/* 挖掘进度显示 */}
              {miningProgress && (
                <div style={{
                  marginBottom: 20,
                  padding: 20,
                  background: 'linear-gradient(135deg, #1a1a2e, #16213e)',
                  borderRadius: 12,
                  border: '1px solid #8b5cf6',
                }}>
                  <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 12, color: '#8b5cf6' }}>
                    🧠 {miningProgress.currentStep}
                  </div>
                  <div style={{ fontSize: 13, color: '#888', lineHeight: 1.8 }}>
                    <div>📊 原始操作数: <b>{miningProgress.totalOps}</b></div>
                    <div>🧹 已过滤噪音: <b>{miningProgress.filteredCount}</b></div>
                    <div>🎯 识别任务数: <b>{miningProgress.sessionCount}</b></div>
                    <div>⚡ 提取工作流: <b>{miningProgress.flowCount}</b></div>
                  </div>
                </div>
              )}

              {/* Session 统计卡片 */}
              {!isMining && sessions.length > 0 && (
                <div style={{
                  marginBottom: 20,
                  padding: 16,
                  background: '#151515',
                  borderRadius: 10,
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: 12,
                }}>
                  <div>
                    <div style={{ fontSize: 11, color: '#666', marginBottom: 4 }}>总操作数</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: '#00d4aa' }}>
                      {sessions.reduce((sum, s) => sum + s.operations.length, 0)}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: '#666', marginBottom: 4 }}>覆盖域名</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: '#3b82f6' }}>
                      {new Set(sessions.flatMap(s => 
                        s.operations.map(op => {
                          try { return new URL(op.url).hostname; } 
                          catch { return null; }
                        }).filter(Boolean)
                      )).size}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: '#666', marginBottom: 4 }}>可挖掘工作流</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: '#8b5cf6' }}>
                      ~{Math.max(1, Math.floor(sessions.length * 0.8))}
                    </div>
                  </div>
                </div>
              )}
              
              {sessions.length === 0 ? (
                <div style={{ 
                  padding: 40, 
                  textAlign: 'center', 
                  background: '#151515',
                  borderRadius: 12,
                  color: '#666',
                }}>
                  No sessions yet. Start browsing with the extension installed!
                </div>
              ) : (
                sessions.map(session => (
                  <div
                    key={session.id}
                    onClick={() => setSelectedSession(session)}
                    style={{
                      padding: 16,
                      background: selectedSession?.id === session.id ? '#1a2a2a' : '#151515',
                      borderRadius: 12,
                      marginBottom: 8,
                      cursor: 'pointer',
                      border: selectedSession?.id === session.id ? '1px solid #00d4aa' : 'none',
                    }}
                  >
                    <div style={{ 
                      display: 'flex', 
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      marginBottom: 8,
                      gap: 12,
                    }}>
                      <span style={{ fontWeight: 500, flex: 1, wordBreak: 'break-word' }}>{session.name}</span>
                      <span style={{ 
                        fontSize: 12, 
                        color: '#00d4aa',
                        background: '#001a14',
                        padding: '2px 8px',
                        borderRadius: 4,
                      }}>
                        {session.operations?.length || 0} ops
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: '#666' }}>
                      {new Date(session.startTime).toLocaleString()}
                    </div>
                    
                    <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                      {selectedSession?.id === session.id && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            analyzeSession(session);
                          }}
                          disabled={isAnalyzing}
                          style={{
                            flex: 1,
                            padding: '10px',
                            background: isAnalyzing ? '#333' : 'linear-gradient(135deg, #00d4aa, #3b82f6)',
                            border: 'none',
                            borderRadius: 8,
                            color: '#fff',
                            cursor: isAnalyzing ? 'not-allowed' : 'pointer',
                            fontWeight: 500,
                            transition: 'all 0.2s ease',
                          }}
                        >
                          {isAnalyzing ? '⏳ Analyzing...' : '✨ Analyze & Create Flow'}
                        </button>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteSession(session.id);
                        }}
                        style={{
                          padding: '8px 16px',
                          background: '#331a1a',
                          border: '1px solid #ff444444',
                          borderRadius: 8,
                          color: '#ff4444',
                          cursor: 'pointer',
                          fontWeight: 500,
                          fontSize: 12,
                        }}
                      >
                        🗑️ Delete
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === 'flows' && (
            <div>
              <h2 style={{ fontSize: 16, marginBottom: 16, color: '#888' }}>
                Saved Flows ({flows.length})
              </h2>
              
              {flows.length === 0 ? (
                <div style={{ 
                  padding: 40, 
                  textAlign: 'center', 
                  background: '#151515',
                  borderRadius: 12,
                  color: '#666',
                }}>
                  No flows yet. Analyze a session to create a flow!
                </div>
              ) : (
                flows.map(flow => (
                  <div
                    key={flow.id}
                    onClick={() => {
                      setSelectedFlow(flow);
                      const runner = new PlaywrightRunner();
                      setGeneratedCode(runner.generateCode(flow));
                    }}
                    style={{
                      padding: 16,
                      background: selectedFlow?.id === flow.id ? '#1a2a2a' : '#151515',
                      borderRadius: 12,
                      marginBottom: 8,
                      cursor: 'pointer',
                      border: selectedFlow?.id === flow.id ? '1px solid #00d4aa' : 'none',
                    }}
                  >
                    <div style={{ 
                      display: 'flex', 
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: 8,
                    }}>
                      <span style={{ fontWeight: 500, flex: 1, wordBreak: 'break-word' }}>{flow.name}</span>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        {/* 质量评分 */}
                        {flow.qualityScore !== undefined && (
                          <span style={{ 
                            fontSize: 11, 
                            color: flow.qualityScore >= 70 ? '#00d4aa' : flow.qualityScore >= 50 ? '#f59e0b' : '#666',
                            background: flow.qualityScore >= 70 ? '#001a14' : '#1a1a1a',
                            padding: '2px 8px',
                            borderRadius: 4,
                            fontWeight: 600,
                          }}>
                            {flow.qualityScore >= 70 ? '⭐ ' : flow.qualityScore >= 50 ? '✨ ' : ''}
                            {flow.qualityScore}分
                          </span>
                        )}
                        <span style={{ 
                          fontSize: 12, 
                          color: '#3b82f6',
                          background: '#0f172a',
                          padding: '2px 8px',
                          borderRadius: 4,
                        }}>
                          {flow.steps.length}步
                        </span>
                      </div>
                    </div>
                    <p style={{ fontSize: 13, color: '#888', margin: '0 0 8px 0' }}>
                      {flow.description}
                    </p>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {flow.tags.map(tag => (
                        <span key={tag} style={{
                          fontSize: 11,
                          padding: '2px 8px',
                          background: '#222',
                          borderRadius: 4,
                          color: '#888',
                        }}>
                          {tag}
                        </span>
                      ))}
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteFlow(flow.id);
                      }}
                      style={{
                        marginTop: 12,
                        width: '100%',
                        padding: '8px',
                        background: '#331a1a',
                        border: '1px solid #ff444444',
                        borderRadius: 8,
                        color: '#ff4444',
                        cursor: 'pointer',
                        fontWeight: 500,
                        fontSize: 12,
                      }}
                    >
                      🗑️ Delete Flow
                    </button>
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === 'execute' && (
            <div>
              <h2 style={{ fontSize: 16, marginBottom: 16, color: '#888' }}>
                Execute with Natural Language
              </h2>
              
              {/* ⚠️ LLM 强制模式提示 */}
              <div style={{
                background: apiKey ? '#0a1f1a' : '#1a0a0a',
                border: `1px solid ${apiKey ? '#00d4aa' : '#ef4444'}`,
                borderRadius: 10,
                padding: '12px 16px',
                marginBottom: 16,
                fontSize: 13,
                color: apiKey ? '#00d4aa' : '#ef4444',
              }}>
                {apiKey 
                  ? '🤖 LLM 智能模式：将使用 AI 分析您的需求并自动匹配最佳工作流'
                  : '❌ 请先在 Settings 页面配置 OpenAI API Key，才能使用智能分析功能'
                }
              </div>
              
              <div style={{
                background: '#151515',
                borderRadius: 12,
                padding: 20,
                marginBottom: 20,
              }}>
                <textarea
                  value={executeQuery}
                  onChange={(e) => setExecuteQuery(e.target.value)}
                  placeholder="Describe what you want to do, e.g.: 'Login to GitHub and check notifications'"
                  style={{
                    width: '100%',
                    minHeight: 80,
                    padding: 12,
                    background: '#222',
                    border: '1px solid #333',
                    borderRadius: 8,
                    color: '#fff',
                    fontSize: 14,
                    resize: 'vertical',
                    marginBottom: 12,
                    fontFamily: 'inherit',
                  }}
                />
                
                <button
                  onClick={executeNaturalLanguage}
                  style={{
                    width: '100%',
                    padding: '12px',
                    background: 'linear-gradient(135deg, #00d4aa, #3b82f6)',
                    border: 'none',
                    borderRadius: 8,
                    color: '#fff',
                    cursor: 'pointer',
                    fontWeight: 500,
                    fontSize: 14,
                  }}
                >
                  🔍 Find & Execute
                </button>
              </div>

              {executionResult && (
                <div style={{
                  background: executionResult.matched || executionResult.isMatching ? '#0a1f1a' : '#1a0a0a',
                  border: `1px solid ${executionResult.matched || executionResult.isMatching ? '#00d4aa' : '#ff4444'}`,
                  borderRadius: 12,
                  padding: 20,
                }}>
                  {executionResult.isMatching ? (
                    // ✅ 匹配中状态
                    <>
                      <div style={{ 
                        fontSize: 16, 
                        fontWeight: 600, 
                        color: '#00d4aa',
                        marginBottom: 12,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                      }}>
                        🔍 正在分析您的需求
                      </div>
                      <div style={{ fontSize: 13, color: '#888' }}>
                        {executionResult.message}
                      </div>
                      <div style={{ 
                        marginTop: 12, 
                        height: 4, 
                        background: '#1a1a1a',
                        borderRadius: 2,
                        overflow: 'hidden' 
                      }}>
                        <div style={{
                          width: '60%',
                          height: '100%',
                          background: 'linear-gradient(90deg, #00d4aa, #3b82f6)',
                          animation: 'pulse 1.5s ease-in-out infinite'
                        }} />
                      </div>
                    </>
                  ) : executionResult.matched ? (
                    // ✅ 匹配成功状态
                    <>
                      <div style={{ 
                        fontSize: 16, 
                        fontWeight: 600, 
                        color: '#00d4aa',
                        marginBottom: 12,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                      }}>
                        {executionResult.codeReady ? '✨ 完成' : '✅ 处理中'}
                      </div>
                      
                      {/* 🔥 显示用户的需求 */}
                      <div style={{ 
                        fontSize: 14, 
                        fontWeight: 500, 
                        color: '#fff',
                        background: 'linear-gradient(135deg, #0a1f1a, #0a1628)',
                        padding: '12px 16px',
                        borderRadius: 8,
                        marginBottom: 12,
                        borderLeft: '3px solid #00d4aa',
                      }}>
                        🎯 {executeQuery}
                      </div>
                      
                      {/* 显示当前状态消息 */}
                      <div style={{
                        fontSize: 13,
                        color: '#888',
                        marginBottom: 12,
                      }}>
                        {executionResult.reasoning}
                      </div>
                      
                      {/* 🚀 代码生成完成后显示执行按钮 */}
                      {executionResult.codeReady && (
                        <button
                          onClick={executeFlowInPage}
                          disabled={isExecuting}
                          style={{
                            width: '100%',
                            padding: '12px',
                            background: isExecuting 
                              ? '#333' 
                              : 'linear-gradient(135deg, #00d4aa, #3b82f6)',
                            border: 'none',
                            borderRadius: 8,
                            color: '#fff',
                            cursor: isExecuting ? 'not-allowed' : 'pointer',
                            fontWeight: 600,
                            fontSize: 14,
                          }}
                        >
                          {isExecuting ? '⏳ 执行中...' : '🚀 立即执行'}
                        </button>
                      )}
                    </>
                  ) : (
                    <>
                      <div style={{ color: '#ff4444', fontWeight: 500, marginBottom: 8 }}>
                        ❌ 未找到匹配
                      </div>
                      <div style={{ fontSize: 13, color: '#888' }}>
                        {executionResult.message}
                      </div>
                      {executionResult.reasoning && (
                        <div style={{
                          fontSize: 12,
                          color: '#666',
                          marginTop: 8,
                        }}>
                          🧠 <em>{executionResult.reasoning}</em>
                        </div>
                      )}
                      {!apiKey && (
                        <div style={{
                          fontSize: 12,
                          color: '#ef4444',
                          background: '#1a0a0a',
                          padding: '8px 12px',
                          borderRadius: 6,
                          marginTop: 8,
                        }}>
                          ⚠️ 必须配置 OpenAI API Key 才能使用智能分析功能！请前往 Settings 页面配置。
                        </div>
                      )}
                      {apiKey && executionResult.message?.includes('403') && (
                        <div style={{
                          fontSize: 12,
                          color: '#f59e0b',
                          marginTop: 8,
                        }}>
                          🔧 403 Error Solutions: 1) Check API Key is valid, 2) Check account balance, 
                          3) Use a proxy/API endpoint accessible from your region in Settings
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {activeTab === 'settings' && (
            <div>
              <h2 style={{ fontSize: 16, marginBottom: 16, color: '#888' }}>
                Settings
              </h2>
              
              <div style={{
                background: '#151515',
                borderRadius: 12,
                padding: 20,
                marginBottom: 16,
              }}>
                <label style={{
                  display: 'block',
                  fontSize: 13,
                  color: '#888',
                  marginBottom: 8,
                }}>
                  OpenAI API Key (for LLM analysis)
                </label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-..."
                  style={{
                    width: '100%',
                    padding: 12,
                    background: '#222',
                    border: '1px solid #333',
                    borderRadius: 8,
                    color: '#fff',
                    fontSize: 14,
                    marginBottom: 12,
                  }}
                />
                
                <label style={{
                  display: 'block',
                  fontSize: 13,
                  color: '#888',
                  marginBottom: 8,
                }}>
                  API Base URL (for proxy / other providers)
                </label>
                <input
                  type="text"
                  value={apiBaseUrl}
                  onChange={(e) => setApiBaseUrl(e.target.value)}
                  placeholder="https://api.openai.com/v1"
                  style={{
                    width: '100%',
                    padding: 12,
                    background: '#222',
                    border: '1px solid #333',
                    borderRadius: 8,
                    color: '#fff',
                    fontSize: 14,
                    marginBottom: 12,
                  }}
                />
                
                <label style={{
                  display: 'block',
                  fontSize: 13,
                  color: '#888',
                  marginBottom: 8,
                }}>
                  Model Name
                </label>
                <input
                  type="text"
                  value={apiModel}
                  onChange={(e) => setApiModel(e.target.value)}
                  placeholder="gpt-4o-mini / gpt-3.5-turbo / deepseek-chat"
                  style={{
                    width: '100%',
                    padding: 12,
                    background: '#222',
                    border: '1px solid #333',
                    borderRadius: 8,
                    color: '#fff',
                    fontSize: 14,
                    marginBottom: 12,
                  }}
                />
                <div style={{
                  fontSize: 12,
                  color: apiKey ? '#00d4aa' : '#f59e0b',
                  marginBottom: 12,
                  padding: '8px 12px',
                  background: apiKey ? '#001a14' : '#1a1400',
                  borderRadius: 6,
                }}>
                  {apiKey ? '✅ API Key configured' : '⚠️ No API Key configured - LLM features disabled'}
                  {apiKey && <span style={{ marginLeft: 8, color: '#666' }}>(starts with {apiKey.slice(0, 5)})</span>}
                </div>
                
                <button
                  onClick={saveApiKey}
                  style={{
                    width: '100%',
                    padding: '10px',
                    background: '#333',
                    border: 'none',
                    borderRadius: 8,
                    color: '#fff',
                    cursor: 'pointer',
                  }}
                >
                  Save API Key
                </button>
              </div>

              <div style={{
                background: '#151515',
                borderRadius: 12,
                padding: 20,
              }}>
                <h3 style={{ fontSize: 14, marginBottom: 12 }}>Stats</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div style={{ textAlign: 'center', padding: 16, background: '#1a1a1a', borderRadius: 8 }}>
                    <div style={{ fontSize: 24, fontWeight: 600, color: '#00d4aa' }}>{sessions.length}</div>
                    <div style={{ fontSize: 12, color: '#666' }}>Sessions</div>
                  </div>
                  <div style={{ textAlign: 'center', padding: 16, background: '#1a1a1a', borderRadius: 8 }}>
                    <div style={{ fontSize: 24, fontWeight: 600, color: '#3b82f6' }}>{flows.length}</div>
                    <div style={{ fontSize: 12, color: '#666' }}>Flows</div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right Panel - Details / Code */}
        <div style={{ minWidth: 0 }}>
          {(selectedFlow || isAnalyzing) && (
            <div>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 16,
              }}>
                <h2 style={{ fontSize: 16, color: '#888', margin: 0 }}>
                  {isAnalyzing ? 'Analyzing...' : 'Generated Code'}
                </h2>
                
                {generatedCode && (
                  <button
                    onClick={copyCode}
                    style={{
                      padding: '6px 12px',
                      background: '#222',
                      border: 'none',
                      borderRadius: 6,
                      color: '#fff',
                      cursor: 'pointer',
                      fontSize: 12,
                    }}
                  >
                    📋 Copy Code
                  </button>
                )}
              </div>

              {isAnalyzing ? (
                <div style={{
                  padding: 50,
                  textAlign: 'center',
                  background: '#151515',
                  borderRadius: 12,
                }}>
                  <div style={{
                    width: 56,
                    height: 56,
                    border: '3px solid #222',
                    borderTop: '3px solid #00d4aa',
                    borderRadius: '50%',
                    margin: '0 auto 20px',
                    animation: 'spin 0.8s linear infinite',
                  }} />
                  <div style={{ color: '#fff', fontSize: 16, marginBottom: 8, fontWeight: 500 }}>
                    🧠 AI 分析中...
                  </div>
                  <div style={{ color: '#888', fontSize: 13, lineHeight: 1.8 }}>
                    <div>✅ 过滤冗余操作</div>
                    <div>🔄 正在调用大模型分析工作流...</div>
                    <div style={{ color: '#666', marginTop: 8 }}>通常需要 2-5 秒，请稍候</div>
                  </div>
                  <style>{`
                    @keyframes spin {
                      0% { transform: rotate(0deg); }
                      100% { transform: rotate(360deg); }
                    }
                  `}</style>
                </div>
              ) : (
                <>
                  {/* Flow Steps - 只在非 Execute 场景下显示 */}
                  {selectedFlow && !executionResult && (
                    <div style={{
                      background: '#151515',
                      borderRadius: 12,
                      padding: 20,
                      marginBottom: 16,
                    }}>
                      <h3 style={{ fontSize: 14, marginBottom: 12 }}>{selectedFlow.name}</h3>
                      <p style={{ fontSize: 13, color: '#888', marginBottom: 16 }}>
                        {selectedFlow.description}
                      </p>
                      
                      <div style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                      }}>
                        {selectedFlow.steps.map((step, i) => (
                          <div key={step.id} style={{
                            padding: 10,
                            background: '#1a1a1a',
                            borderRadius: 8,
                            display: 'flex',
                            gap: 12,
                            alignItems: 'flex-start',
                          }}>
                            <span style={{
                              width: 24,
                              height: 24,
                              background: '#00d4aa22',
                              color: '#00d4aa',
                              borderRadius: '50%',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: 12,
                              flexShrink: 0,
                            }}>{i + 1}</span>
                            <div>
                              <div style={{ fontWeight: 500, fontSize: 13 }}>
                                {step.description}
                              </div>
                              {step.target?.cssSelector && (
                                <div style={{
                                  fontSize: 11,
                                  color: '#666',
                                  fontFamily: 'monospace',
                                  marginTop: 4,
                                }}>
                                  {step.target.cssSelector}
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                      
                      {/* 执行按钮 */}
                      <div style={{
                        display: 'flex',
                        gap: 12,
                        marginTop: 16,
                        marginBottom: 12,
                      }}>
                        <button
                          onClick={executeFlowInPage}
                          disabled={isExecuting}
                          style={{
                            flex: 1,
                            padding: '12px 16px',
                            background: isExecuting ? '#333' : 'linear-gradient(135deg, #00d4aa, #3b82f6)',
                            border: 'none',
                            borderRadius: 8,
                            color: '#fff',
                            cursor: isExecuting ? 'not-allowed' : 'pointer',
                            fontWeight: 600,
                            fontSize: 14,
                          }}
                        >
                          {isExecuting ? '⏳ Executing...' : '🚀 Execute on Active Tab'}
                        </button>
                        
                        <button
                          onClick={copyCode}
                          style={{
                            padding: '12px 16px',
                            background: '#222',
                            border: 'none',
                            borderRadius: 8,
                            color: '#fff',
                            cursor: 'pointer',
                            fontWeight: 500,
                          }}
                        >
                          📋 Copy Code
                        </button>
                      </div>

                      {/* 执行进度显示 */}
                      {executionProgress && (
                        <div style={{
                          padding: 12,
                          background: executionProgress.status.includes('✅') || executionProgress.status.includes('🎉')
                            ? '#001a14' 
                            : executionProgress.status.includes('❌')
                              ? '#1a0a0a'
                              : '#1a1a00',
                          borderRadius: 8,
                          border: `1px solid ${executionProgress.status.includes('✅') || executionProgress.status.includes('🎉')
                            ? '#00d4aa' 
                            : executionProgress.status.includes('❌')
                              ? '#ff4444'
                              : '#facc15'}`,
                          marginBottom: 12,
                        }}>
                          <div style={{
                            fontSize: 13,
                            color: executionProgress.status.includes('❌') ? '#ff4444' : '#fff',
                          }}>
                            {executionProgress.status}
                          </div>
                          {executionProgress.totalSteps > 0 && (
                            <div style={{
                              width: '100%',
                              height: 4,
                              background: '#333',
                              borderRadius: 2,
                              marginTop: 8,
                              overflow: 'hidden',
                            }}>
                              <div style={{
                                width: `${(executionProgress.currentStep / executionProgress.totalSteps) * 100}%`,
                                height: '100%',
                                background: '#00d4aa',
                                transition: 'width 0.3s',
                              }} />
                            </div>
                          )}
                        </div>
                      )}

                      <div style={{
                        fontSize: 12,
                        color: '#00d4aa',
                        background: '#001a14',
                        padding: 12,
                        borderRadius: 8,
                        marginBottom: 12,
                        lineHeight: 1.6,
                      }}>
                        ✨ <strong>Auto-launch & execute!</strong><br />
                        When you click execute:<br />
                        1. 🚀 The target website will open automatically<br />
                        2. 🎬 Watch that page for the automation<br />
                        3. 📝 Check the page console (F12) for logs<br />
                        <br />
                        Just click the button! 🚀
                      </div>
                      
                    </div>
                  )}

                  {/* Code */}
                  <pre style={{
                    background: '#0d0d0d',
                    borderRadius: 12,
                    padding: 20,
                    overflow: 'auto',
                    maxHeight: 500,
                    margin: 0,
                    fontSize: 12,
                    lineHeight: 1.6,
                    color: '#ccc',
                    fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                  }}>
                    <code>{generatedCode}</code>
                  </pre>
                </>
              )}
            </div>
          )}

          {!selectedFlow && !isAnalyzing && selectedSession && (
            <div>
              <h2 style={{ fontSize: 16, color: '#888', marginBottom: 16 }}>
                Session Details
              </h2>
              <div style={{
                background: '#151515',
                borderRadius: 12,
                padding: 20,
              }}>
                <h3 style={{ marginBottom: 12 }}>{selectedSession.name}</h3>
                <div style={{ fontSize: 13, color: '#888', marginBottom: 16 }}>
                  {selectedSession.operations?.length || 0} operations recorded
                </div>

                {/* 智能分析选项 */}
                <div style={{
                  background: '#0d1a15',
                  border: '1px solid #00d4aa33',
                  borderRadius: 8,
                  padding: 16,
                  marginBottom: 16,
                }}>
                  <h4 style={{ 
                    margin: '0 0 12px 0', 
                    fontSize: 14,
                    color: '#00d4aa',
                  }}>
                    🧠 Intelligent Task Extraction
                  </h4>
                  
                  <div style={{ marginBottom: 12 }}>
                    <label style={{
                      display: 'block',
                      fontSize: 12,
                      color: '#888',
                      marginBottom: 6,
                    }}>
                      What task were you doing? (help AI extract the core flow)
                    </label>
                    <input
                      type="text"
                      value={taskDescription}
                      onChange={(e) => setTaskDescription(e.target.value)}
                      placeholder="e.g., Login to GitHub, Submit a form, Search for product"
                      style={{
                        width: '100%',
                        padding: 10,
                        background: '#1a1a1a',
                        border: '1px solid #333',
                        borderRadius: 6,
                        color: '#fff',
                        fontSize: 13,
                      }}
                    />
                  </div>

                  <div style={{ marginBottom: 12 }}>
                    <label style={{
                      display: 'block',
                      fontSize: 12,
                      color: '#888',
                      marginBottom: 6,
                    }}>
                      Target domain (optional, filter out other websites):
                    </label>
                    <input
                      type="text"
                      value={targetDomain}
                      onChange={(e) => setTargetDomain(e.target.value)}
                      placeholder="e.g., github.com, google.com"
                      style={{
                        width: '100%',
                        padding: 10,
                        background: '#1a1a1a',
                        border: '1px solid #333',
                        borderRadius: 6,
                        color: '#fff',
                        fontSize: 13,
                      }}
                    />
                  </div>

                  <div style={{ fontSize: 11, color: '#666' }}>
                    💡 AI will automatically remove distractions and find the shortest path
                  </div>
                </div>
                
                <div style={{
                  maxHeight: 250,
                  overflow: 'auto',
                  background: '#0d0d0d',
                  borderRadius: 8,
                  padding: 16,
                }}>
                  <pre style={{
                    margin: 0,
                    fontSize: 11,
                    color: '#888',
                    whiteSpace: 'pre-wrap',
                  }}>
                    {JSON.stringify(selectedSession.operations?.slice(0, 50), null, 2)}
                    {selectedSession.operations && selectedSession.operations.length > 50 && 
                      `\n\n... and ${selectedSession.operations.length - 50} more`
                    }
                  </pre>
                </div>

                <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                  <button
                    onClick={() => analyzeSession(selectedSession)}
                    style={{
                      flex: 1,
                      padding: '10px',
                      background: 'linear-gradient(135deg, #00d4aa, #3b82f6)',
                      border: 'none',
                      borderRadius: 8,
                      color: '#fff',
                      cursor: 'pointer',
                      fontWeight: 500,
                    }}
                  >
                    ✨ Analyze
                  </button>
                  <button
                    onClick={() => deleteSession(selectedSession.id)}
                    style={{
                      padding: '10px 16px',
                      background: 'none',
                      border: '1px solid #ff4444',
                      borderRadius: 8,
                      color: '#ff4444',
                      cursor: 'pointer',
                    }}
                  >
                    🗑️
                  </button>
                </div>
              </div>
            </div>
          )}

          {!selectedSession && !selectedFlow && !isAnalyzing && (
            <div style={{
              padding: 60,
              textAlign: 'center',
              background: '#151515',
              borderRadius: 12,
            }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>👈</div>
              <div style={{ color: '#888' }}>
                Select a session or flow to see details
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
