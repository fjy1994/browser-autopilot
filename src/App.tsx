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
    generatedCode,
    apiKey,
    apiBaseUrl,
    apiModel,
    executeQuery,
    executionResult,
    taskDescription,
    targetDomain,
    isExecuting,
    executionProgress,
    isMining,
    setSelectedFlow,
    setGeneratedCode,
    setApiKey,
    setApiBaseUrl,
    setApiModel,
    setExecuteQuery,
    setExecutionResult,
    setTaskDescription,
    setTargetDomain,
    setIsExecuting,
    setExecutionProgress,
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
  const { executeNaturalLanguage, executeFlowInPage, copyCode } = useExecution({
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
    generatedCode,
  });

  // 设置相关 Hook
  const { saveApiKey } = useSettings({
    apiKey,
    apiBaseUrl,
    apiModel,
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
      <main style={{ padding: 24, display: 'grid', gridTemplateColumns: 'minmax(400px, 1fr) minmax(500px, 1fr)', gap: 24 }}>
        {/* Left Panel - List */}
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
              executeQuery={executeQuery}
              setExecuteQuery={setExecuteQuery}
              executionResult={executionResult}
              executionProgress={executionProgress}
              generatedCode={generatedCode}
              isExecuting={isExecuting}
              onExecute={executeNaturalLanguage}
              onExecuteFlow={executeFlowInPage}
              onCopyCode={copyCode}
            />
          )}

          {activeTab === 'settings' && (
            <SettingsTab
              apiKey={apiKey}
              apiBaseUrl={apiBaseUrl}
              apiModel={apiModel}
              taskDescription={taskDescription}
              targetDomain={targetDomain}
              setApiKey={setApiKey}
              setApiBaseUrl={setApiBaseUrl}
              setApiModel={setApiModel}
              setTaskDescription={setTaskDescription}
              setTargetDomain={setTargetDomain}
              onSave={saveApiKey}
            />
          )}
        </div>

        {/* Right Panel - Detail / Code */}
        <div style={{ minWidth: 0 }}>
          {selectedFlow && (
            <div>
              <h2 style={{ fontSize: 16, marginBottom: 16, color: '#888' }}>
                📝 Flow: {selectedFlow.name}
              </h2>
              <div style={{
                background: '#151515',
                padding: 16,
                borderRadius: 12,
                marginBottom: 16,
              }}>
                <div style={{ fontSize: 13, color: '#888', marginBottom: 12 }}>
                  {selectedFlow.description}
                </div>
                <div style={{ fontSize: 12, color: '#666' }}>
                  {selectedFlow.steps?.length || 0} steps
                </div>
              </div>
              
              {generatedCode && (
                <div>
                  <div style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 8,
                  }}>
                    <div style={{ fontSize: 13, color: '#888' }}>生成的代码：</div>
                    <button
                      onClick={copyCode}
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
                      📋 复制
                    </button>
                  </div>
                  <pre style={{
                    padding: 16,
                    background: '#0a0a0a',
                    border: '1px solid #222',
                    borderRadius: 8,
                    overflow: 'auto',
                    fontSize: 12,
                    color: '#ccc',
                    lineHeight: 1.6,
                    maxHeight: 500,
                    margin: 0,
                  }}>
                    {generatedCode}
                  </pre>
                </div>
              )}
            </div>
          )}

          {!selectedFlow && (
            <div style={{ 
              padding: 40, 
              textAlign: 'center', 
              background: '#151515',
              borderRadius: 12,
              color: '#666',
            }}>
              Select a flow to view details
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
