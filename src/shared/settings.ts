/** 文件用途：在扩展受信本地存储中保存个人模型配置；开发预览不保存密钥。 */
import type { Settings } from './types';

const defaults: Settings = { apiKey: '', model: 'deepseek-flash', theme: 'system' };

/** 读取设置；本地网页预览没有扩展存储时返回空密钥默认值。 */
export async function loadSettings(): Promise<Settings> {
  if (!globalThis.chrome?.storage?.local) return { ...defaults };
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  const data = await chrome.storage.local.get('settings');
  const stored = data.settings;
  if (!stored || typeof stored !== 'object') return { ...defaults };
  const candidate = stored as Partial<Settings>;
  return {
    apiKey: typeof candidate.apiKey === 'string' ? candidate.apiKey : '',
    model: typeof candidate.model === 'string' && /^[a-z0-9][a-z0-9._-]{0,79}$/i.test(candidate.model) ? candidate.model : defaults.model,
    theme: candidate.theme === 'light' || candidate.theme === 'dark' ? candidate.theme : 'system',
  };
}

/** 保存个人设置到扩展受信上下文，不通过 runtime 消息发送密钥。 */
export async function saveSettings(settings: Settings): Promise<void> {
  if (!globalThis.chrome?.storage?.local) return;
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  await chrome.storage.local.set({ settings });
}
