import { useState } from 'react';
import { flowDb } from './storage/flow-db';
import {
  useAppState,
  useWorkflowMining,
  useExecution,
  useSettings,
} from './hooks';
import {
  Header,
  TabsNav,
  FlowsTab,
  ExecuteTab,
  SettingsTab,
} from './components';

type TabType = 'flows' | 'execute' | 'settings';

export function App() {
  const [activeTab, setActiveTab] = useState<TabType>('flows');

  const appState = useAppState();
  const {
    sessions,
    flows,
    selectedFlow,
    apiKey,
    apiBaseUrl,
    apiModel,
    allowedDomains,
    executeQuery,
    executionResult,
    isMining,
    setSelectedFlow,
    setApiKey,
    setApiBaseUrl,
    setApiModel,
    setAllowedDomains,
    setExecuteQuery,
    setExecutionResult,
    setIsMining,
    setMiningProgress,
    loadData,
  } = appState;

  // 工作流挖掘 Hook
  const { mineAllWorkflows } = useWorkflowMining({
    sessions,
    apiKey,
    apiBaseUrl,
    apiModel,
    setIsMining,
    setMiningProgress,
    setActiveTab,
    loadData,
  });

  // 执行相关 Hook
  const {
    executeNaturalLanguage,
    // 分步执行相关
    executionSteps,
    currentStepIndex,
    isExecuting,
    startStepExecution,
    retryStep,
    skipStep,
    cancelExecution,
    // 失败分析
    failureAnalysis,
  } = useExecution({
    apiKey,
    apiBaseUrl,
    apiModel,
    executeQuery,
    flows,
    selectedFlow,
    setSelectedFlow,
    setExecutionResult,
  });

  // 设置相关 Hook
  const { saveApiKey } = useSettings({
    apiKey,
    apiBaseUrl,
    apiModel,
    allowedDomains,
  });

  // 删除流程
  const deleteFlow = async (id: string) => {
    if (confirm('Delete this flow?')) {
      await flowDb.deleteFlow(id);
      await loadData();
      if (selectedFlow?.id === id) setSelectedFlow(null);
    }
  };

  return (
    <div style={{ 
      minHeight: '100vh', 
      background: '#0a0a0a',
      color: '#fff',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      <Header
        mineAllWorkflows={mineAllWorkflows}
        isMining={isMining}
      />

      <TabsNav activeTab={activeTab} setActiveTab={setActiveTab} />

      {/* Content */}
      <main style={{ 
        padding: 24, 
        display: 'grid', 
        // Execute Tab / Settings 用单列布局，不需要详情面板
        gridTemplateColumns: activeTab === 'flows' ? 'minmax(400px, 1fr) minmax(500px, 1fr)' : '1fr',
        gap: 24,
        maxWidth: activeTab === 'flows' ? 'none' : '800px',
        margin: '0 auto',
      }}>
        {/* Left Panel */}
        <div style={{ minWidth: 0 }}>
          {activeTab === 'flows' && (
            <FlowsTab
              flows={flows}
              selectedFlow={selectedFlow}
              onSelectFlow={setSelectedFlow}
              onDeleteFlow={deleteFlow}
            />
          )}

          {activeTab === 'execute' && (
            <ExecuteTab
              selectedFlow={selectedFlow}
              executeQuery={executeQuery}
              setExecuteQuery={setExecuteQuery}
              executionResult={executionResult}
              executionSteps={executionSteps}
              currentStep={currentStepIndex}
              onExecute={executeNaturalLanguage}
              onStartExecution={startStepExecution}
              onStepRetry={retryStep}
              onStepSkip={skipStep}
              onStepCancel={cancelExecution}
              isExecuting={isExecuting}
              failureAnalysis={failureAnalysis}
            />
          )}

          {activeTab === 'settings' && (
            <SettingsTab
              apiKey={apiKey}
              apiBaseUrl={apiBaseUrl}
              apiModel={apiModel}
              allowedDomains={allowedDomains}
              setApiKey={setApiKey}
              setApiBaseUrl={setApiBaseUrl}
              setApiModel={setApiModel}
              setAllowedDomains={setAllowedDomains}
              onSave={saveApiKey}
            />
          )}
        </div>

        {/* Right Panel - Detail (只在事务 Tab 显示) */}
        {activeTab === 'flows' && (
          <div style={{ minWidth: 0 }}>
            {selectedFlow ? (
              <div>
                <h2 style={{ fontSize: 16, marginBottom: 16, color: '#888' }}>
                  📝 事务: {selectedFlow.name}
                </h2>
                
                {/* 步骤详情列表 */}
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 13, color: '#888', marginBottom: 8 }}>
                    步骤列表 ({selectedFlow.steps?.length || 0} 步)
                  </div>
                  {selectedFlow.steps?.map((step: any, i: number) => (
                    <div key={step.id || i} style={{
                      background: '#151515',
                      padding: '10px 14px',
                      borderRadius: 8,
                      marginBottom: 6,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                    }}>
                      <div style={{
                        width: 24,
                        height: 24,
                        borderRadius: '50%',
                        background: step.action === 'click' ? '#3b82f6' 
                          : step.action === 'input' ? '#8b5cf6'
                          : step.action === 'keydown' ? '#06b6d4'
                          : step.action === 'navigate' ? '#10b981'
                          : '#666',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 12,
                        fontWeight: 'bold',
                        color: '#fff',
                        flexShrink: 0,
                      }}>
                        {step.action === 'click' ? '👆'
                          : step.action === 'input' ? '⌨️'
                          : step.action === 'keydown' ? '⏎'
                          : step.action === 'navigate' ? '🌐'
                          : '•'}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, color: '#fff', marginBottom: 2 }}>
                          {step.description || `步骤 ${i + 1}`}
                        </div>
                        <div style={{ fontSize: 11, color: '#888', fontFamily: 'monospace' }}>
                          {step.target?.cssSelector || step.targetSelector || step.selector || ''}
                          {step.value ? ` = "${step.value.slice(0, 30)}${step.value.length > 30 ? '...' : ''}"` : ''}
                          {step.waitTimeout ? ` ⏱ ${step.waitTimeout}ms` : ''}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                
                {/* 原始事务的代码（数据库里的模板） */}
                {selectedFlow.code && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ 
                      display: 'flex', 
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: 8,
                    }}>
                      <div style={{ fontSize: 13, color: '#888' }}>📦 原始事务模板代码</div>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(selectedFlow.code || '');
                        }}
                        style={{
                          padding: '6px 12px',
                          background: '#222',
                          border: '1px solid #333',
                          borderRadius: 6,
                          color: '#fff',
                          cursor: 'pointer',
                          fontSize: 12,
                        }}
                      >
                        📋 复制代码
                      </button>
                    </div>
                    <pre style={{
                      padding: 16,
                      background: '#0a0a0a',
                      border: '1px solid #222',
                      borderRadius: 8,
                      overflow: 'auto',
                      fontSize: 11,
                      color: '#ccc',
                      lineHeight: 1.6,
                      maxHeight: 400,
                      margin: 0,
                    }}>
                      {selectedFlow.code}
                    </pre>
                  </div>
                )}
              </div>
            ) : (
              <div style={{ 
                padding: 40, 
                textAlign: 'center', 
                background: '#151515',
                borderRadius: 12,
                color: '#666',
              }}>
                选择左侧事务查看详情
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
