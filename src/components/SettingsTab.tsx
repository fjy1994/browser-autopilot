interface SettingsTabProps {
  apiKey: string;
  apiBaseUrl: string;
  apiModel: string;
  taskDescription: string;
  targetDomain: string;
  setApiKey: (val: string) => void;
  setApiBaseUrl: (val: string) => void;
  setApiModel: (val: string) => void;
  setTaskDescription: (val: string) => void;
  setTargetDomain: (val: string) => void;
  onSave: () => void;
}

export function SettingsTab({
  apiKey,
  apiBaseUrl,
  apiModel,
  taskDescription,
  targetDomain,
  setApiKey,
  setApiBaseUrl,
  setApiModel,
  setTaskDescription,
  setTargetDomain,
  onSave,
}: SettingsTabProps) {
  return (
    <div>
      <h2 style={{ fontSize: 16, marginBottom: 16, color: '#888' }}>
        ⚙️ Settings
      </h2>

      <div style={{
        background: '#151515',
        padding: 20,
        borderRadius: 12,
      }}>
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 13, color: '#888', marginBottom: 6 }}>
            OpenAI API Key
          </label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-..."
            style={{
              width: '100%',
              padding: 10,
              background: '#1a1a1a',
              border: '1px solid #333',
              borderRadius: 6,
              color: '#fff',
              fontSize: 14,
              boxSizing: 'border-box',
            }}
          />
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 13, color: '#888', marginBottom: 6 }}>
            API Base URL
          </label>
          <input
            type="text"
            value={apiBaseUrl}
            onChange={(e) => setApiBaseUrl(e.target.value)}
            style={{
              width: '100%',
              padding: 10,
              background: '#1a1a1a',
              border: '1px solid #333',
              borderRadius: 6,
              color: '#fff',
              fontSize: 14,
              boxSizing: 'border-box',
            }}
          />
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 13, color: '#888', marginBottom: 6 }}>
            Model
          </label>
          <input
            type="text"
            value={apiModel}
            onChange={(e) => setApiModel(e.target.value)}
            style={{
              width: '100%',
              padding: 10,
              background: '#1a1a1a',
              border: '1px solid #333',
              borderRadius: 6,
              color: '#fff',
              fontSize: 14,
              boxSizing: 'border-box',
            }}
          />
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 13, color: '#888', marginBottom: 6 }}>
          Task Description (optional)
          </label>
          <input
            type="text"
            value={taskDescription}
            onChange={(e) => setTaskDescription(e.target.value)}
            placeholder="e.g., 电商网站搜索商品"
            style={{
              width: '100%',
              padding: 10,
              background: '#1a1a1a',
              border: '1px solid #333',
              borderRadius: 6,
              color: '#fff',
              fontSize: 14,
              boxSizing: 'border-box',
            }}
          />
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'block', fontSize: 13, color: '#888', marginBottom: 6 }}>
          Target Domain (optional)
          </label>
          <input
            type="text"
            value={targetDomain}
            onChange={(e) => setTargetDomain(e.target.value)}
            placeholder="e.g., taobao.com"
            style={{
              width: '100%',
              padding: 10,
              background: '#1a1a1a',
              border: '1px solid #333',
              borderRadius: 6,
              color: '#fff',
              fontSize: 14,
              boxSizing: 'border-box',
            }}
          />
        </div>

        <button
          onClick={onSave}
          style={{
            width: '100%',
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
          💾 Save Settings
        </button>
      </div>
    </div>
  );
}
