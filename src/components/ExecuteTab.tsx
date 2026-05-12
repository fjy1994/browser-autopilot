export interface ExecutionStepState {
  id: string;
  index: number;
  status: 'pending' | 'running' | 'success' | 'failed';
  action: string;
  selector: string;
  description: string;
  error?: string;
}

export interface FailureAnalysis {
  loading: boolean;
  result?: any;
  error?: string;
}

interface ExecuteTabProps {
  selectedFlow: any;
  executionResult: any;
  executionSteps: ExecutionStepState[];
  currentStep: number;
  executeQuery: string;
  setExecuteQuery: (query: string) => void;
  onExecute: () => void;
  onStartExecution: () => void;
  onStepRetry: () => void;
  onStepSkip: () => void;
  onStepCancel: () => void;
  isExecuting: boolean;
  failureAnalysis: FailureAnalysis;
}

export function ExecuteTab({
  executeQuery,
  setExecuteQuery,
  executionResult,
  executionSteps,
  onExecute,
  onStartExecution,
  onStepRetry,
  onStepSkip,
  onStepCancel,
  isExecuting,
  failureAnalysis,
}: ExecuteTabProps) {
  return (
    <div>
      <h2 style={{ fontSize: 16, marginBottom: 16, color: '#888' }}>
        🚀 智能执行
      </h2>

      {/* 自然语言输入 */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 13, color: '#888', marginBottom: 8 }}>
          用自然语言描述你想要执行的操作：
        </div>
        <textarea
          value={executeQuery}
          onChange={(e) => setExecuteQuery(e.target.value)}
          placeholder="例如：搜索 '王者荣耀'，点击第一个结果..."
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
          disabled={!executeQuery.trim()}
          style={{
            width: '100%',
            marginTop: 12,
            padding: 12,
            background: executeQuery.trim()
              ? 'linear-gradient(135deg, #00d4aa, #3b82f6)'
              : '#333',
            border: 'none',
            borderRadius: 8,
            color: '#fff',
            cursor: executeQuery.trim() ? 'pointer' : 'not-allowed',
            fontWeight: 600,
            fontSize: 14,
          }}
        >
          🔍 解析并执行
        </button>
      </div>

      {/* 匹配结果 */}
      {executionResult && (
        <div style={{
          padding: 16,
          background: executionResult.loading ? '#15151a' :
            executionResult.matched ? '#151a15' : '#1a1515',
          borderRadius: 10,
          marginBottom: 16,
          border: executionResult.loading ? '1px solid #3b82f633' :
            executionResult.matched ? '1px solid #00d4aa33' : '1px solid #ff444433',
        }}>
          <div style={{
            fontSize: 14,
            fontWeight: 600,
            color: executionResult.loading ? '#3b82f6' :
              executionResult.matched ? '#00d4aa' : '#ff4444',
            marginBottom: 8,
          }}>
            {executionResult.loading ? '⏳ LLM 处理中...' :
              executionResult.matched ? '✅ 匹配成功' : '❌ 匹配失败'}
          </div>
          {executionResult.flow && (
            <div style={{ fontSize: 13, marginBottom: 4 }}>
              <span style={{ color: '#888' }}>事务:</span> {executionResult.flow.name}
            </div>
          )}
          {executionResult.confidence !== undefined && (
            <div style={{ fontSize: 12, marginBottom: 6 }}>
              <span style={{ color: '#888' }}>置信度:</span> 
              <span style={{ 
                color: executionResult.confidence > 0.8 ? '#00d4aa' : 
                       executionResult.confidence > 0.5 ? '#fbbf24' : '#ff4444',
                fontWeight: 600,
                marginLeft: 4
              }}>
                {(executionResult.confidence * 100).toFixed(0)}%
              </span>
            </div>
          )}
          <div style={{ fontSize: 13, color: '#ccc', whiteSpace: 'pre-line' }}>
            {executionResult.reasoning}
          </div>

          {/* 匹配成功且加载完成后，显示步骤预览和执行按钮 */}
          {executionResult.matched && !executionResult.loading && executionResult.flow && (
            <>
              {/* 步骤详情预览 - 匹配成功后立即显示，执行过程中也保持显示 */}
              <div style={{ marginTop: 12, marginBottom: 12 }}>
                <div style={{ fontSize: 13, color: '#888', marginBottom: 8 }}>
                  📋 事务步骤详情 ({executionResult.flow.steps?.length || 0} 步)
                </div>
                {executionResult.flow.steps?.map((step: any, i: number) => {
                  const isStepRunning = executionSteps[i]?.status === 'running';
                  const isStepSuccess = executionSteps[i]?.status === 'success';
                  const isStepFailed = executionSteps[i]?.status === 'failed';
                  const stepStatus = executionSteps[i]?.status;
                  
                  return (
                    <div key={step.id || i} style={{
                      background: isStepRunning ? '#15151a' :
                        isStepSuccess ? '#151a15' :
                        isStepFailed ? '#1a1515' : '#151515',
                      padding: '10px 12px',
                      borderRadius: 6,
                      marginBottom: 6,
                      border: isStepRunning ? '1px solid #3b82f633' :
                        isStepSuccess ? '1px solid #00d4aa33' :
                        isStepFailed ? '1px solid #ff444433' : 'none',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <div style={{
                          width: 20,
                          height: 20,
                          borderRadius: '50%',
                          background: stepStatus === 'running' ? '#3b82f6' :
                            stepStatus === 'success' ? '#00d4aa' :
                            stepStatus === 'failed' ? '#ff4444' :
                            step.action === 'click' ? '#3b82f6' 
                            : step.action === 'input' ? '#8b5cf6'
                            : step.action === 'keydown' ? '#06b6d4'
                            : step.action === 'navigate' ? '#10b981'
                            : '#666',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 10,
                          color: '#fff',
                          flexShrink: 0,
                        }}>
                          {stepStatus === 'running' ? '⏳' :
                            stepStatus === 'success' ? '✅' :
                            stepStatus === 'failed' ? '❌' :
                            step.action === 'click' ? '👆' 
                            : step.action === 'input' ? '⌨️'
                            : step.action === 'keydown' ? '🔑'
                            : step.action === 'navigate' ? '🔗'
                            : i + 1}
                        </div>
                        <div style={{ flex: 1, color: stepStatus ? '#fff' : '#ccc', fontSize: 13 }}>
                          {step.description || `步骤 ${i + 1}`}
                        </div>
                        {step.waitTimeout && (
                          <div style={{ color: '#666', fontSize: 11 }}>
                            ⏱️ {step.waitTimeout}ms
                          </div>
                        )}
                      </div>
                      
                      {/* 步骤额外信息 */}
                      <div style={{ fontSize: 11, color: '#888', marginLeft: 28, lineHeight: 1.6 }}>
                        {/* navigate 显示 URL */}
                        {step.action === 'navigate' && (step.value || step.target?.url) && (
                          <div>URL: <span style={{ color: '#10b981', fontFamily: 'monospace' }}>{step.value || step.target?.url}</span></div>
                        )}
                        
                        {/* click/input 显示 元素选择器 */}
                        {(step.action === 'click' || step.action === 'input' || step.action === 'keydown') && 
                         (step.target?.cssSelector || step.targetSelector) && (
                          <div>元素: <span style={{ color: '#3b82f6', fontFamily: 'monospace', wordBreak: 'break-all' }}>{step.target?.cssSelector || step.targetSelector}</span></div>
                        )}
                        
                        {/* input 显示 value */}
                        {step.action === 'input' && step.value && (
                          <div>输入值: <span style={{ color: '#8b5cf6', fontFamily: 'monospace' }}>{step.value}</span></div>
                        )}
                        
                        {/* 错误信息 */}
                        {isStepFailed && executionSteps[i]?.error && (
                          <div style={{ color: '#ff4444', marginTop: 4 }}>
                            ❌ 错误: {executionSteps[i]?.error}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              
              {/* 执行按钮 - 一直显示，方便重复执行 */}
              <button
                onClick={onStartExecution}
                disabled={isExecuting}
                style={{
                  width: '100%',
                  padding: '10px 16px',
                  background: isExecuting ? '#333' : 'linear-gradient(135deg, #00d4aa, #3b82f6)',
                  border: 'none',
                  borderRadius: 6,
                  color: '#fff',
                  cursor: isExecuting ? 'not-allowed' : 'pointer',
                  fontSize: 14,
                  fontWeight: 600,
                }}
              >
                {isExecuting ? '⏳ 执行中...' : '▶️ 执行'}
              </button>
            </>
          )}
        </div>
      )}

      {/* 🧠 LLM 失败分析结果 */}
      {executionSteps.length > 0 && executionSteps.some((s: any) => s.status === 'failed') && (
        <div style={{
          marginTop: 12,
          padding: 12,
          background: '#15151a',
          border: '1px solid #3b82f633',
          borderRadius: 8,
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#3b82f6', marginBottom: 10 }}>
            🧠 AI 智能分析执行失败原因
          </div>
          
          {failureAnalysis.loading ? (
            <div style={{ fontSize: 13, color: '#888' }}>
              ⏳ 正在分析失败原因（截图 + LLM）...
            </div>
          ) : failureAnalysis.error ? (
            <div style={{ fontSize: 13, color: '#ff4444' }}>
              ⚠️ 分析失败: {failureAnalysis.error}
            </div>
          ) : failureAnalysis.result ? (
            <div>
              {/* 失败原因 */}
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>失败原因:</div>
                <div style={{ fontSize: 13, color: '#fff', fontWeight: 600 }}>
                  {failureAnalysis.result.failureReason}
                </div>
              </div>
              
              {/* 详细分析 */}
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>详细分析:</div>
                <div style={{ fontSize: 13, color: '#ccc', lineHeight: 1.5 }}>
                  {failureAnalysis.result.detailedAnalysis}
                </div>
              </div>
              
              {/* 可能的原因 */}
              {failureAnalysis.result.possibleCauses?.length > 0 && (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>可能的原因:</div>
                  <ul style={{ margin: 0, paddingLeft: 20 }}>
                    {failureAnalysis.result.possibleCauses.map((cause: string, i: number) => (
                      <li key={i} style={{ fontSize: 13, color: '#ccc' }}>{cause}</li>
                    ))}
                  </ul>
                </div>
              )}
              
              {/* 解决方案 */}
              {failureAnalysis.result.suggestedSolutions?.length > 0 && (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>建议的解决方案:</div>
                  {failureAnalysis.result.suggestedSolutions.map((solution: any, i: number) => (
                    <div key={i} style={{ 
                      fontSize: 13, 
                      color: '#00d4aa', 
                      marginBottom: 4,
                      padding: '6px 8px',
                      background: '#00d4aa15',
                      borderRadius: 4,
                    }}>
                      ✅ {solution.action}
                    </div>
                  ))}
                </div>
              )}
              
              {/* 用户手动干预提示 */}
              {failureAnalysis.result.userActionRequired && (
                <div style={{ 
                  padding: '8px 10px', 
                  background: '#fbbf2420', 
                  borderRadius: 6,
                  fontSize: 13,
                  color: '#fbbf24',
                }}>
                  ⚠️ 需要用户干预: {failureAnalysis.result.userActionRequired}
                </div>
              )}
            </div>
          ) : null}
        </div>
      )}

      {/* ❌ 步骤执行失败时的用户决策按钮 */}
      {executionSteps.length > 0 && executionSteps.some((s: any) => s.status === 'failed') && (
        <div style={{
          marginTop: 12,
          padding: 12,
          background: '#1a1515',
          border: '1px solid #ff444433',
          borderRadius: 8,
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#ff4444', marginBottom: 10 }}>
            ⚠️ 步骤执行失败，请选择下一步操作：
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={onStepRetry}
              style={{
                flex: 1,
                padding: '8px 12px',
                background: '#3b82f6',
                border: 'none',
                borderRadius: 6,
                color: '#fff',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              🔄 重试
            </button>
            <button
              onClick={onStepSkip}
              style={{
                flex: 1,
                padding: '8px 12px',
                background: '#666',
                border: 'none',
                borderRadius: 6,
                color: '#fff',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              ⏭️ 跳过
            </button>
            <button
              onClick={onStepCancel}
              style={{
                flex: 1,
                padding: '8px 12px',
                background: '#ff4444',
                border: 'none',
                borderRadius: 6,
                color: '#fff',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              ❌ 取消
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
