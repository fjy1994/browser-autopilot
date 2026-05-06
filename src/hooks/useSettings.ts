import { flowDb } from '../storage/flow-db';

interface SettingsDeps {
  apiKey: string;
  apiBaseUrl: string;
  apiModel: string;
}

export function useSettings(deps: SettingsDeps) {
  const { apiKey, apiBaseUrl, apiModel } = deps;

  // 保存 API 设置
  const saveApiKey = async () => {
    await flowDb.setSetting('openai_api_key', apiKey);
    await flowDb.setSetting('openai_base_url', apiBaseUrl);
    await flowDb.setSetting('openai_model', apiModel);
    alert('✅ API Settings saved');
  };

  return { saveApiKey };
}
