/** 文件用途：验证密钥存储只向受信上下文开放，损坏的配置不会改变默认模型和外观。 */
// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadSettings, saveSettings } from '../src/shared/settings';

/** 每例结束移除模拟浏览器，避免影响学校和模型测试。 */
afterEach(function restoreBrowser() { vi.unstubAllGlobals(); });

/** 构造受信存储替身，使用虚构配置而不涉及真实凭据。 */
function storage(value: unknown) {
  const local = { setAccessLevel: vi.fn().mockResolvedValue(undefined), get: vi.fn().mockResolvedValue({ settings: value }), set: vi.fn().mockResolvedValue(undefined) };
  vi.stubGlobal('chrome', { storage: { local } });
  return local;
}

/** 测试授权顺序、未知字段和本地网页预览的空配置。 */
describe('trusted settings', function settingsCases() {
  it('uses empty defaults outside the extension', async function previewDefault() { expect((await loadSettings()).apiKey).toBe(''); });
  it('restricts access before reading and tolerates corrupt settings', async function rejectMalformed() {
    const local = storage({ apiKey: 123, model: 'https://untrusted.example', theme: 'unknown', ignored: true });
    expect(await loadSettings()).toEqual({ apiKey: '', model: 'deepseek-flash', theme: 'system' });
    expect(local.setAccessLevel).toHaveBeenCalledWith({ accessLevel: 'TRUSTED_CONTEXTS' });
    expect(local.setAccessLevel.mock.invocationCallOrder[0]).toBeLessThan(local.get.mock.invocationCallOrder[0]);
  });
  it('restricts access before saving a new personal configuration', async function saveTrusted() {
    const local = storage(null);
    const settings = { apiKey: 'sk-fictional-example', model: 'deepseek-flash', theme: 'dark' as const };
    await saveSettings(settings);
    expect(local.set).toHaveBeenCalledWith({ settings });
    expect(local.setAccessLevel.mock.invocationCallOrder[0]).toBeLessThan(local.set.mock.invocationCallOrder[0]);
  });
});
