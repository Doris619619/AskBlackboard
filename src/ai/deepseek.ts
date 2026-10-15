/** 文件用途：在扩展受信上下文调用固定 DeepSeek API，并以无凭据错误和已验证引用返回问答结果。 */
import { AppError } from '../shared/errors';
import type { AnnouncementSnapshot, ModelAnswer } from '../shared/types';
import { validateModelAnswer } from './evidence';
import { buildDataPrompt, SYSTEM_PROMPT } from './prompt';
import { withModelRecovery, type ModelProgress } from './retry';

export interface AskDeepSeekInput {
  question: string;
  snapshot: AnnouncementSnapshot;
  apiKey: string;
  signal?: AbortSignal;
  model?: string;
  onProgress?: (progress: ModelProgress) => void;
}

const ENDPOINT = 'https://api.deepseek.com/chat/completions';

/** 将 HTTP 失败映射到固定说明；绝不转发原始响应（它可能包含凭据或回显资料）。 */
function providerError(status: number): AppError {
  if (status === 401 || status === 403) return new AppError('ai_auth', 'DeepSeek 密钥未通过验证。请在设置中检查密钥。');
  if (status === 402) return new AppError('ai_balance', 'DeepSeek 账户余额不足。公告来源仍可直接查看。');
  if (status === 429) return new AppError('ai_rate_limit', 'DeepSeek 请求过于频繁，请稍后重试。');
  if (status >= 500) return new AppError('ai_unavailable', 'DeepSeek 暂时不可用，请稍后重试。');
  return new AppError('ai_request', 'DeepSeek 未能处理本次请求，请重试。');
}

/** 从提供商 JSON 取出最终内容；拒绝空响应、截断内容和非预期结构。 */
function completionContent(payload: unknown): string {
  if (payload === null || typeof payload !== 'object' || !('choices' in payload) || !Array.isArray(payload.choices)) throw new AppError('ai_invalid_json', 'DeepSeek 返回的内容格式不完整，请重试。');
  const choice = payload.choices[0];
  if (choice?.finish_reason === 'length') throw new AppError('ai_incomplete', 'AI 回答被截断，请缩短问题后重试。');
  if (choice?.finish_reason !== 'stop' || typeof choice?.message?.content !== 'string' || !choice.message.content.trim()) throw new AppError('ai_invalid_json', 'DeepSeek 返回的内容格式不完整，请重试。');
  return choice.message.content;
}

/** 使用调用者提供的密钥生成有依据答案；超时或取消会中止网络读取，失败不清空原有资料。 */
export async function askDeepSeek(input: AskDeepSeekInput): Promise<ModelAnswer> {
  /** 每次重试使用同一轮资料和凭据；不重新采集或创建重复对话。 */
  function attempt(timeoutMs: number) { return requestOnce(input, timeoutMs); }
  return withModelRecovery(attempt, input.signal, input.onProgress);
}

/** 单次调用覆盖响应头和完整正文读取的超时；自动重试由外层统一协调。 */
async function requestOnce({ question, snapshot, apiKey, signal, model = 'deepseek-flash' }: AskDeepSeekInput, timeoutMs: number): Promise<ModelAnswer> {
  if (!apiKey.trim()) throw new AppError('ai_key_required', '请先在设置中填写 DeepSeek API 密钥。');
  if (!question.trim() || question.length > 2000) throw new AppError('question_invalid', '请填写不超过 2000 字的问题。');
  if (!/^[a-z0-9][a-z0-9._-]{0,79}$/iu.test(model)) throw new AppError('ai_model_invalid', '模型名称无效，请检查设置。');
  if (signal?.aborted) throw new AppError('cancelled', '已取消本次提问。');
  const controller = new AbortController();
  let timedOut = false;
  /** 用户取消时中止正在进行的请求；不把 abort reason 输出给用户。 */
  function cancel(): void { controller.abort(); }
  /** 本次预算耗尽后关闭请求，并与主动取消区分。 */
  function timeout(): void { timedOut = true; controller.abort(); }
  signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(timeout, timeoutMs);
  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      credentials: 'omit',
      redirect: 'error',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey.trim()}` },
      body: JSON.stringify({
        model,
        thinking: { type: 'disabled' },
        stream: false,
        response_format: { type: 'json_object' },
        max_tokens: 1024,
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: buildDataPrompt(question, snapshot) }],
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const error = providerError(response.status);
      const retryAfter = response.headers.get('retry-after');
      if (retryAfter) { const seconds = Number(retryAfter); error.cause = Number.isFinite(seconds) ? seconds * 1000 : Math.max(0, Date.parse(retryAfter) - Date.now()); }
      throw error;
    }
    let payload: unknown;
    try { payload = await response.json(); }
    catch { if (controller.signal.aborted) throw new Error(); throw new AppError('ai_invalid_json', 'DeepSeek 返回的内容格式不完整，请重试。'); }
    const content = completionContent(payload);
    let answer: unknown;
    try { answer = JSON.parse(content); }
    catch { throw new AppError('ai_invalid_json', 'AI 回答不是完整的 JSON，请重试。'); }
    return validateModelAnswer(answer, snapshot, question);
  } catch (error: unknown) {
    if (timedOut) throw new AppError('ai_timeout', '模型响应暂时超时。');
    if (signal?.aborted || controller.signal.aborted) throw new AppError('cancelled', '已取消本次提问。');
    if (error instanceof AppError) throw error;
    throw new AppError('ai_network', '无法连接 DeepSeek，请检查网络后重试。');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}
