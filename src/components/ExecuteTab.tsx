interface ExecuteTabProps {
  executeQuery: string;
  setExecuteQuery: (query: string) => void;
  executionResult: any;
  executionProgress: any;
  generatedCode: string;
  isExecuting: boolean;
  onExecute: () => void;
  onExecuteFlow: () => void;
  onCopyCode: () => void;
}

export function ExecuteTab({
  executeQuery,
  setExecuteQuery,
  executionResult,
  executionProgress,
  generatedCode,
  isExecuting,
  onExecute,
  onExecuteFlow,
  onCopyCode,
}: ExecuteTabProps) {
  return (
    <div>
      <h2 style={{ fontSize: 16, marginBottom: 16, color: '#888' }}>
        🚀 Execute Workflow
      </h2>

      {/* 自然语言输入 */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 13, color: '#888', marginBottom: 8 }}>
          用自然语言描述你想要执行的操作：
        </div>
        <textarea
          value={executeQuery}
          onChange={(e) => setExecuteQuery(e.target.value)}
          placeholder="例如：在 Google 搜索 'React'，点击第一个结果..."
          style={{
            width: '100%',
            padding: 12,
            background: '#1a1a1a',
            border: '1px solid #333',
            borderRadius: 8,
            color: '#fff',
            fontSize: 14,
            minHeight: 80,
            resize: 'vertical',
            boxSizing: 'border-box',
          }}
        />
        <button
          onClick={onExecute}
          style={{
            width: '100%',
            marginTop: 12,
            padding: 12,
            background: 'linear-gradient(135deg, #00d4aa, #3b82f6)',
            border: 'none',
            borderRadius: 8,
            color: '#fff',
            cursor: 'pointer',
            fontWeight: 600,
            fontSize: 14,
          }}
        >
          🔍 匹配并执行
        </button>
      </div>

      {/* 执行结果 */}
      {executionResult && (
        <div style={{
          padding: 16,
          background: executionResult.matched ? '#151a15' : '#1a1515',
          borderRadius: 10,
          marginBottom: 16,
          border: executionResult.matched ? '1px solid #00d4aa33' : '1px solid #ff444433',
        }}>
          <div style={{ 
            fontSize: 14, 
            fontWeight: 600,
            color: executionResult.matched ? '#00d4aa' : '#ff4444',
            marginBottom: 8,
          }}>
            {executionResult.matched ? '✅ 匹配成功' : '❌ 匹配失败'}
          </div>
          {executionResult.flow && (
            <div style={{ fontSize: 13, marginBottom: 8 }}>
              <span style={{ color: '#888' }}>工作流:</span> {executionResult.flow.name}
            </div>
          )}
          <div style={{ fontSize: 13, color: '#888' }}>
            {executionResult.reasoning}
          </div>
          {executionResult.codeReady && (
            <button
              onClick={onExecuteFlow}
              disabled={isExecuting}
              style={{
                width: '100%',
                marginTop: 12,
                padding: 10,
                background: isExecuting ? '#333' : 'linear-gradient(135deg, #8b5cf6, #06b6d4)',
                border: 'none',
                borderRadius: 8,
                color: '#fff',
                cursor: isExecuting ? 'not-allowed' : 'pointer',
                fontWeight: 600,
                fontSize: 13,
              }}
            >
              {isExecuting ? '⏳ 执行中...' : '▶️ 在当前页面执行'}
            </button>
          )}
        </div>
      )}

      {/* 执行进度 */}
      {executionProgress && (
        <div style={{
          padding: 16,
          background: '#151515',
          borderRadius: 10,
          marginBottom: 16,
        }}>
          <div style={{ fontSize: 13, color: '#fff', whiteSpace: 'pre-line' }}>
            {executionProgress.status}
          </div>
          {executionProgress.totalSteps > 0 && (
            <div style={{ 
              marginTop: 8,
              height: 4,
              background: '#333',
              borderRadius: 2,
              overflow: 'hidden',
            }}>
              <div style={{
                width: `${(executionProgress.currentStep / executionProgress.totalSteps) * 100}%`,
                height: '100%',
                background: 'linear-gradient(90deg, #00d4aa, #3b82f6)',
                transition: 'width 0.3s ease',
              }} />
            </div>
          )}
        </div>
      )}

      {/* 生成的代码 */}
      {generatedCode && (
        <div>
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 8,
          }}>
            <div style={{ fontSize: 13, color: '#888' }}>生成的 Playwright 代码：</div>
            <button
              onClick={onCopyCode}
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
  );
}
