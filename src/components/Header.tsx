interface HeaderProps {
  mineAllWorkflows: () => void;
  isMining: boolean;
}

export function Header({ mineAllWorkflows, isMining }: HeaderProps) {
  return (
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
      </div>
    </header>
  );
}
