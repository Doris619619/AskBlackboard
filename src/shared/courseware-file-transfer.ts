/** 文件用途：读取选中课件的响应，逐跳验证 Blackboard 文件地址并限制网络空闲等待。 */
import { coursewareFileUrl } from '../blackboard/courseware-policy';
import { readFileFromSchoolTab } from './courseware-file-relay';
import { AppError } from './errors';

const networkIdleMs = 30_000;
const maxRedirects = 3;

interface FileTransferSource { originalUrl: URL; courseId: string; schoolTabId?: number }

/** 限制本次网络等待，计时到期时中止该文件的请求并解除等待中的读取。 */
export async function waitForNetwork<T>(pending: Promise<T>, request: AbortController): Promise<T> {
  const { signal } = request;
  let interrupt!: () => void;
  const interrupted = new Promise<never>(/** 收到超时或用户取消时结束当前等待。 */ function onInterrupted(_resolve, reject) {
    /** 保留取消方提供的原因，使批次区分用户取消和单文件超时。 */
    interrupt = function rejectAbort() { reject(signal.reason); };
    signal.addEventListener('abort', interrupt, { once: true });
    if (signal.aborted) interrupt();
  });
  /** 一次停滞只中止当前文件，让同一批中其他文件继续保存。 */
  function timeOut() { request.abort(new AppError('file_download_failed', '等待课件数据超时，请重试。')); }
  const timer = setTimeout(timeOut, networkIdleMs);
  try { return await Promise.race([pending, interrupted]); }
  finally { clearTimeout(timer); signal.removeEventListener('abort', interrupt); }
}

/** 发起一次手动跳转的 GET，只观察本扩展针对当前地址发出的请求。 */
async function readFileHop(target: URL, source: FileTransferSource, request: AbortController): Promise<Response | string> {
  request.signal.throwIfAborted();
  const browser = globalThis.chrome;
  const redirects = browser?.webRequest?.onBeforeRedirect;
  const extensionId = browser?.runtime?.id;
  const { schoolTabId } = source;
  const destinations = new Set<string>();
  /** 跳转响应在 Fetch 中不可见，临时监听只记目标地址，不读请求头或 Cookie。 */
  function record(details: chrome.webRequest.OnBeforeRedirectDetails): void {
    if (details.method !== 'GET' || details.url !== target.href) return;
    const sameSource = schoolTabId === undefined
      ? extensionId && details.initiator === `chrome-extension://${extensionId}`
      : details.initiator === target.origin && details.tabId === schoolTabId && details.frameId === 0;
    if (sameSource) destinations.add(details.redirectUrl);
  }
  redirects?.addListener(record, { urls: [`${target.origin}${target.pathname}*`], types: ['xmlhttprequest'], ...(schoolTabId === undefined ? {} : { tabId: schoolTabId }) });
  try {
    let response: Response;
    try {
      const pending = schoolTabId === undefined
        ? fetch(target.href, { method: 'GET', credentials: 'include', cache: 'no-store', redirect: 'manual', signal: request.signal })
        : readFileFromSchoolTab(schoolTabId, { type: 'open', url: target.href, originalUrl: source.originalUrl.href, courseId: source.courseId }, request.signal);
      response = await waitForNetwork(pending, request);
    } catch (error) {
      request.signal.throwIfAborted();
      if (error instanceof AppError) throw error;
      throw new AppError('file_download_failed', 'Blackboard 课件连接失败，请检查网络后重试。');
    }
    if (response.type !== 'opaqueredirect' && (response.status < 300 || response.status >= 400)) return response;
    if (destinations.size === 1) return destinations.values().next().value!;
    throw new AppError('file_redirect_blocked', '未能确认 Blackboard 课件的跳转地址，请从课程目录重试。');
  } finally { redirects?.removeListener(record); }
}

/** 从校验过的文件入口开始读取，后续仅允许同源 WebDAV 文件，禁止登录页和其他地址。 */
export async function readCoursewareResponse(entry: URL, source: FileTransferSource, request: AbortController): Promise<{ response: Response; url: URL }> {
  const visited = new Set<string>();
  let url = entry;
  for (let hop = 0; hop <= maxRedirects && !visited.has(url.href); hop++) {
    visited.add(url.href);
    const locks = globalThis.navigator?.locks;
    /** 同一扩展可能有多个保存页。同地址请求串行到响应头，避免跳转事件被另一请求接收。 */
    function readCurrentHop(): Promise<Response | string> { return readFileHop(url, source, request); }
    const result = await (locks ? locks.request(`askblackboard-file-request:${url.href}`, { signal: request.signal }, readCurrentHop) : readCurrentHop());
    if (typeof result !== 'string') return { response: result, url };
    let target: URL;
    try { target = new URL(result, url); }
    catch { throw new AppError('file_redirect_blocked', '未能确认 Blackboard 课件的跳转地址，请从课程目录重试。'); }
    if (target.origin === url.origin && /^\/webapps\/login(?:\/|$)/.test(target.pathname)) {
      throw new AppError('login_required', '请在 Blackboard 页面重新登录后再下载。');
    }
    try { url = coursewareFileUrl(target.href); }
    catch { throw new AppError('file_redirect_blocked', 'Blackboard 将课件跳转到了非课件地址，请在课程页面打开该文件。'); }
  }
  throw new AppError('file_redirect_blocked', 'Blackboard 课件地址重复跳转，请从课程目录重试。');
}
