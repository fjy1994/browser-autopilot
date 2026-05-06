import type { OperationFlow } from '../types';

interface FlowsTabProps {
  flows: OperationFlow[];
  selectedFlow: OperationFlow | null;
  onSelectFlow: (flow: OperationFlow) => void;
  onDeleteFlow: (id: string) => void;
}

export function FlowsTab({ flows, selectedFlow, onSelectFlow, onDeleteFlow }: FlowsTabProps) {
  return (
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
            onClick={() => onSelectFlow(flow)}
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
              alignItems: 'flex-start',
              marginBottom: 8,
              gap: 12,
            }}>
              <span style={{ fontWeight: 500, flex: 1, wordBreak: 'break-word' }}>{flow.name}</span>
              <span style={{ 
                fontSize: 12, 
                color: '#3b82f6',
                background: '#16213e',
                padding: '2px 8px',
                borderRadius: 4,
              }}>
                {flow.steps?.length || 0} steps
              </span>
            </div>
            <div style={{ fontSize: 12, color: '#666', marginBottom: 8 }}>
              {flow.description}
            </div>
            {flow.isAutoMined && (
              <div style={{ fontSize: 11, color: '#8b5cf6', marginBottom: 8 }}>
                🤖 Auto-mined
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteFlow(flow.id);
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
  );
}
