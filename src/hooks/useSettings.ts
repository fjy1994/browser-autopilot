import { flowDb } from '../storage/flow-db';

interface SettingsDeps {
  apiKey: string;
  apiBaseUrl: string;
  apiModel: string;
  allowedDomains: string;
}

export function useSettings(deps: SettingsDeps) {
  const { apiKey, apiBaseUrl, apiModel, allowedDomains } = deps;

  // 保存设置
  const saveApiKey = async () => {
    await flowDb.setSetting('openai_api_key', apiKey);
    await flowDb.setSetting('openai_base_url', apiBaseUrl);
    await flowDb.setSetting('openai_model', apiModel);
    await flowDb.setSetting('allowed_domains', allowedDomains);
    alert('✅ Settings saved');
  };

  return { saveApiKey };
}
