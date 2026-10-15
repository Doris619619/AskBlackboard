/** 文件用途：验证旧后台/新界面的升级边界，避免将协议错配当成学校权限或模型失败。 */
// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { discoverCourses, reloadExtension } from '../src/shared/browser-client';
import { RUNTIME_PROTOCOL } from '../src/shared/runtime-version';

/** 每项测试后清理模拟扩展环境。 */
afterEach(() => vi.unstubAllGlobals());
describe('extension runtime compatibility', () => {
  it.each([true, { protocol: 1 }, { protocol: 99 }, null])('blocks incompatible background %j before collection', async data => {
    const sendMessage = vi.fn().mockResolvedValue({ ok: true, data });
    vi.stubGlobal('chrome', { runtime: { id: 'fixture', sendMessage } });
    await expect(discoverCourses()).rejects.toMatchObject({ code: 'extension_reload_required' });
    expect(sendMessage.mock.calls).toEqual([[{ type: 'ping' }]]);
  });
  it('allows compatible background and checks again on each request', async () => {
    const data = { courses: [], currentTermId: '', accountName: 'Example' };
    const sendMessage = vi.fn().mockResolvedValueOnce({ ok: true, data: { protocol: RUNTIME_PROTOCOL } }).mockResolvedValueOnce({ ok: true, data }).mockResolvedValueOnce({ ok: true, data: true });
    vi.stubGlobal('chrome', { runtime: { id: 'fixture', sendMessage } });
    expect(await discoverCourses()).toEqual(data);
    await expect(discoverCourses()).rejects.toMatchObject({ code: 'extension_reload_required' });
  });
  it('maps unsupported operations to reload guidance instead of school permission failure', async () => {
    const sendMessage = vi.fn().mockResolvedValueOnce({ ok: true, data: { protocol: RUNTIME_PROTOCOL } }).mockResolvedValueOnce({ ok: false, error: { code: 'invalid_message', message: 'unsupported' } });
    vi.stubGlobal('chrome', { runtime: { id: 'fixture', sendMessage } });
    await expect(discoverCourses()).rejects.toMatchObject({ code: 'extension_reload_required' });
  });
  it('reloads only when requested and never clears settings', async () => {
    const reload = vi.fn(); const clear = vi.fn();
    vi.stubGlobal('chrome', { runtime: { id: 'fixture', reload }, storage: { local: { clear } } });
    expect(reload).not.toHaveBeenCalled(); reloadExtension();
    expect(reload).toHaveBeenCalledTimes(1); expect(clear).not.toHaveBeenCalled();
  });
});
