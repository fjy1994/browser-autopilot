type TabType = 'flows' | 'execute' | 'settings';

interface TabsNavProps {
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
}

export function TabsNav({ activeTab, setActiveTab }: TabsNavProps) {
  const tabs: { key: TabType; label: string }[] = [
    { key: 'flows', label: '⚡ 事务' },
    { key: 'execute', label: '🚀 执行' },
    { key: 'settings', label: '⚙️ 设置' },
  ];

  return (
    <nav style={{
      padding: '0 40px',
      borderBottom: '1px solid #222',
    }}>
      {tabs.map(tab => (
        <button
          key={tab.key}
          onClick={() => setActiveTab(tab.key)}
          style={{
            padding: '16px 24px',
            background: 'none',
            border: 'none',
            borderBottom: activeTab === tab.key ? '2px solid #00d4aa' : '2px solid transparent',
            color: activeTab === tab.key ? '#00d4aa' : '#888',
            cursor: 'pointer',
            fontSize: 14,
            fontWeight: 500,
            textTransform: 'capitalize',
          }}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
