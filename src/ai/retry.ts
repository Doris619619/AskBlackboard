/** 文件用途：为模型临时故障提供有上限、可取消的自动重试与进度，不保存请求正文或密钥。 */
import { AppError } from '../shared/errors';

export interface ModelProgress { attempt: number; state: 'requesting' | 'waiting' | 'retrying' }
const transient = new Set(['ai_timeout', 'ai_network', 'ai_rate_limit', 'ai_unavailable']);

/** 可取消的短退避；取消时移除计时器，绝不继续发出下一次请求。 */
function backoff(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise(/** 安装本次等待的取消处理器并在任一结束路径清理。 */ function wait(resolve, reject) {
    if (signal?.aborted) { reject(new AppError('cancelled', '已取消本次提问。')); return; }
    /** 正常等待结束后移除取消监听。 */
    function done() { signal?.removeEventListener('abort', cancel); resolve(); }
    /** 用户取消等待时立即结束，不重试。 */
    function cancel() { clearTimeout(timer); signal?.removeEventListener('abort', cancel); reject(new AppError('cancelled', '已取消本次提问。')); }
    const timer = setTimeout(done, milliseconds);
    signal?.addEventListener('abort', cancel, { once: true });
  });
}

/** 首次60秒、自动恢复一次90秒，临时故障才重试；鉴权、余额和无依据输出不重试。 */
export async function withModelRecovery<T>(request: (timeoutMs: number) => Promise<T>, signal?: AbortSignal, onProgress?: (progress: ModelProgress) => void): Promise<T> {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    if (signal?.aborted) throw new AppError('cancelled', '已取消本次提问。');
    onProgress?.({ attempt, state: 'requesting' });
    /** 慢请求仍在运行，向界面说明无需人工重试。 */
    function slow() { onProgress?.({ attempt, state: 'waiting' }); }
    const slowTimer = setTimeout(slow, 15000);
    try { return await request(attempt === 1 ? 60000 : 90000); }
    catch (error) {
      clearTimeout(slowTimer);
      if (signal?.aborted) throw new AppError('cancelled', '已取消本次提问。');
      if (!(error instanceof AppError) || !transient.has(error.code)) throw error;
      if (attempt === 2) throw new AppError(error.code, '模型连接自动尝试了2次仍未完成。已保留读取资料，可直接展开原文；作业截止查询不依赖模型。');
      onProgress?.({ attempt: 2, state: 'retrying' });
      const retryAfter = typeof error.cause === 'number' && Number.isFinite(error.cause) ? error.cause : 1500;
      await backoff(Math.min(10000, Math.max(1500, retryAfter)), signal);
    } finally { clearTimeout(slowTimer); }
  }
  throw new AppError('ai_network', '模型连接未完成。');
}
