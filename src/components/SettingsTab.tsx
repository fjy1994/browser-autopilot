interface SettingsTabProps {
  apiKey: string;
  apiBaseUrl: string;
  apiModel: string;
  allowedDomains: string;
  setApiKey: (val: string) => void;
  setApiBaseUrl: (val: string) => void;
  setApiModel: (val: string) => void;
  setAllowedDomains: (val: string) => void;
  onSave: () => void;
}

export function SettingsTab({
  apiKey,
  apiBaseUrl,
  apiModel,
  allowedDomains,
  setApiKey,
  setApiBaseUrl,
  setApiModel,
  setAllowedDomains,
  onSave,
}: SettingsTabProps) {
  return (
    <div>
      <h2 style={{ fontSize: 16, marginBottom: 16, color: '#888' }}>
        ⚙️ 设置
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
            API 基础地址
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
            模型名称
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

        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'block', fontSize: 13, color: '#888', marginBottom: 6 }}>
            只记录这些域名 (用;分隔, 支持模糊匹配)
          </label>
          <input
            type="text"
            value={allowedDomains}
            onChange={(e) => setAllowedDomains(e.target.value)}
            placeholder="e.g., baidu.com;taobao.com;google.com"
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
          <div style={{ fontSize: 11, color: '#666', marginTop: 6 }}>
            留空 = 不记录任何页面。只记录域名包含配置字符串的页面。
          </div>
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
          💾 保存设置
        </button>
      </div>
    </div>
  );
}
