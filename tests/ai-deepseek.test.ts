/** 文件用途：验证固定模型请求、取消/超时以及脱敏错误；网络全部模拟，不使用真实密钥。 */
// @vitest-environment node
import { afterEach, describe, expect, test, vi } from 'vitest';
import { askDeepSeek } from '../src/ai/deepseek';
import type { AnnouncementSnapshot } from '../src/shared/types';

/** 提供无用户身份的单条公告样本。 */
function fixture(): AnnouncementSnapshot {
  return { course: { courseId: 'test-course', code: 'GED2005', title: 'Example', termId: '2610UG', termLabel: '2026', section: 'L01', announcementUrl: 'https://bb.cuhk.edu.cn/example' }, sources: [{ sourceId: 'test-notice', courseId: 'test-course', title: 'Quiz 1', body: 'Quiz 1 is on Monday, October 12.', publishedAt: '2026-10-07T10:00:00Z', fetchedAt: '2026-10-08T10:00:00Z', url: 'https://bb.cuhk.edu.cn/example', anchorId: 'test-notice', breadcrumb: ['Announcements'] }], fetchedAt: '2026-10-08T10:00:00Z', coverage: { status: 'complete', pagesRead: 1, warnings: [] } };
}

/** 生成本地模拟响应，其内容只包含样本公告编号和日期。 */
function completion(content = JSON.stringify({ status: 'found', answer: 'Quiz 1 在2026年10月12日，周一。', citations: [{ sourceId: 'test-notice', quote: 'Quiz 1 is on Monday, October 12.' }] }), finishReason = 'stop'): Response {
  return new Response(JSON.stringify({ choices: [{ finish_reason: finishReason, message: { content } }] }), { status: 200 });
}

afterEach(resetEnvironment);
/** 还原模拟网络和时间，避免模拟配置影响其它代理的测试。 */
function resetEnvironment(): void { vi.unstubAllGlobals(); vi.useRealTimers(); }

describe('DeepSeek request boundary', describeRequests);
/** 网络全部由本地模拟响应驱动，测试不会访问提供商。 */
function describeRequests(): void {
  test('uses the fixed endpoint and sends evidence as data', validateRequest);
  /** 检查URL、请求参数和角色隔离，不让用户文本或原文变成系统指令。 */
  async function validateRequest(): Promise<void> {
    const fetchMock = vi.fn().mockResolvedValue(completion());
    vi.stubGlobal('fetch', fetchMock);
    const result = await askDeepSeek({ question: 'GED2005的quiz是什么时候', snapshot: fixture(), apiKey: 'test-only-placeholder' });
    expect(result.status).toBe('found');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.deepseek.com/chat/completions');
    expect(init.credentials).toBe('omit');
    expect(init.redirect).toBe('error');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ model: 'deepseek-flash', thinking: { type: 'disabled' }, stream: false, response_format: { type: 'json_object' }, max_tokens: 1024 });
    expect(body.messages[0].role).toBe('system');
    expect(JSON.parse(body.messages[1].content).DATA.sources).toHaveLength(1);
    expect(body.messages[1].content).not.toContain('test-only-placeholder');
  }
  test.each([[401, 'ai_auth'], [402, 'ai_balance'], [429, 'ai_rate_limit'], [500, 'ai_unavailable'], [400, 'ai_request']])('maps HTTP %i to a fixed error', validateHttpError);
  /** 不读取或回显提供商错误正文，故意包含回显字符串也不会泄露。 */
  async function validateHttpError(status: number, code: string): Promise<void> {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('provider-internal-echo', { status })));
    await expect(askDeepSeek({ question: 'quiz什么时候', snapshot: fixture(), apiKey: 'test-only-placeholder' })).rejects.toMatchObject({ code });
    try { await askDeepSeek({ question: 'quiz什么时候', snapshot: fixture(), apiKey: 'test-only-placeholder' }); }
    catch (error) { expect(String(error)).not.toContain('provider-internal-echo'); }
  }
  test('rejects malformed JSON, empty content and truncated output', validateMalformedOutput);
  /** 输出不完整时必须报错而非把未校验文本展示为答案。 */
  async function validateMalformedOutput(): Promise<void> {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('invalid-json')).mockResolvedValueOnce(completion('')).mockResolvedValueOnce(completion('{}', 'length')).mockResolvedValueOnce(completion('not-json'));
    vi.stubGlobal('fetch', fetchMock);
    for (const code of ['ai_invalid_json', 'ai_invalid_json', 'ai_incomplete', 'ai_invalid_json']) {
      await expect(askDeepSeek({ question: 'quiz什么时候', snapshot: fixture(), apiKey: 'test-only-placeholder' })).rejects.toMatchObject({ code });
    }
  }
  test('redacts network failures and checks a missing key before fetch', validateNetworkFailure);
  /** 浏览器原始异常可能回显敏感参数，界面只接收固定说明。 */
  async function validateNetworkFailure(): Promise<void> {
    const fetchMock = vi.fn().mockRejectedValue(new Error('untrusted-network-details'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(askDeepSeek({ question: 'quiz什么时候', snapshot: fixture(), apiKey: 'test-only-placeholder' })).rejects.toMatchObject({ code: 'ai_network' });
    await expect(askDeepSeek({ question: 'quiz什么时候', snapshot: fixture(), apiKey: '' })).rejects.toMatchObject({ code: 'ai_key_required' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  }
  test('cancels an in-flight request', validateCancellation);
  /** 取消用AbortSignal关闭网络，而不是仅隐藏界面结果。 */
  async function validateCancellation(): Promise<void> {
    vi.stubGlobal('fetch', vi.fn(pendingFetch));
    const controller = new AbortController();
    const pending = askDeepSeek({ question: 'quiz什么时候', snapshot: fixture(), apiKey: 'test-only-placeholder', signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
  }
  test('times out after 60 seconds', validateTimeout);
  /** 假时钟验证完整超时路径，不需要实际等待或访问网络。 */
  async function validateTimeout(): Promise<void> {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(pendingFetch));
    const pending = askDeepSeek({ question: 'quiz什么时候', snapshot: fixture(), apiKey: 'test-only-placeholder' });
    const assertion = expect(pending).rejects.toMatchObject({ code: 'ai_timeout' });
    await vi.advanceTimersByTimeAsync(60_000);
    await assertion;
  }
}

/** 模拟停滞网络：只有收到取消信号才拒绝，供主动取消与超时测试共用。 */
function pendingFetch(_url: string | URL | Request, init?: RequestInit): Promise<Response> {
  return new Promise(waitForAbort);
  /** 监听本次请求中止，不保留请求头和模拟凭据。 */
  function waitForAbort(_resolve: (response: Response) => void, reject: (reason: unknown) => void): void {
    init?.signal?.addEventListener('abort', rejectAbort, { once: true });
    /** 模拟fetch的AbortError，不含请求URL或任何header。 */
    function rejectAbort(): void { reject(new DOMException('aborted', 'AbortError')); }
  }
}
