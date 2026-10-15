/** 文件用途：用假时钟验证模型自动恢复、慢请求提示、取消和有限重试，不连接真实服务。 */
// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { withModelRecovery } from '../src/ai/retry';
import { AppError } from '../src/shared/errors';

/** 防止假时钟泄漏到其他测试。 */
afterEach(() => vi.useRealTimers());
describe('automatic model recovery', () => {
  it('recovers network failures once and uses a bounded second attempt', async () => {
    vi.useFakeTimers();
    const request = vi.fn().mockRejectedValueOnce(new AppError('ai_network','temporary')).mockResolvedValue('ok');
    const progress = vi.fn();
    const pending = withModelRecovery(request, undefined, progress);
    await vi.advanceTimersByTimeAsync(1500);
    expect(await pending).toBe('ok');
    expect(request.mock.calls).toEqual([[60000], [90000]]);
    expect(progress).toHaveBeenCalledWith({ attempt: 2, state: 'retrying' });
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(['ai_auth','ai_balance','ai_request','invalid_answer','ai_invalid_json'])('does not retry permanent or invalid output error %s', async code => {
    const request = vi.fn().mockRejectedValue(new AppError(code,'fixed'));
    await expect(withModelRecovery(request)).rejects.toMatchObject({ code });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('cancels during backoff without sending another request', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const request = vi.fn().mockRejectedValue(new AppError('ai_timeout','slow'));
    const pending = withModelRecovery(request,controller.signal);
    const assertion = expect(pending).rejects.toMatchObject({ code: 'cancelled' });
    await vi.advanceTimersByTimeAsync(1000); controller.abort();
    await assertion; await vi.advanceTimersByTimeAsync(200000);
    expect(request).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });
  it('caps Retry-After and stops after two temporary failures', async () => {
    vi.useFakeTimers(); const error = new AppError('ai_rate_limit','busy'); error.cause = 999999;
    const request = vi.fn().mockRejectedValue(error);
    const pending = withModelRecovery(request);
    const assertion = expect(pending).rejects.toThrow('自动尝试了2次');
    await vi.advanceTimersByTimeAsync(9999); expect(request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); await assertion; expect(request).toHaveBeenCalledTimes(2);
  });
  it('shows a waiting message without starting concurrent requests', async () => {
    vi.useFakeTimers(); let finish!: (value: string) => void;
    const request = vi.fn(() => new Promise<string>(resolve => { finish = resolve; }));
    const progress = vi.fn(); const pending = withModelRecovery(request,undefined,progress);
    await vi.advanceTimersByTimeAsync(15000);
    expect(progress).toHaveBeenCalledWith({ attempt: 1, state: 'waiting' }); expect(request).toHaveBeenCalledTimes(1);
    finish('ok'); expect(await pending).toBe('ok'); expect(vi.getTimerCount()).toBe(0);
  });
});
