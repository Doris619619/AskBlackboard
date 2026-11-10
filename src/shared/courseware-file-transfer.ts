/** 文件用途：读取选中课件的响应，逐跳验证 Blackboard 文件地址并限制网络空闲等待。 */
import { coursewareFileUrl } from '../blackboard/courseware-policy';
import { fileFromCoursewareView } from '../blackboard/courseware-file-view';
import { readFileFromSchoolTab } from './courseware-file-relay';
import { AppError } from './errors';

const networkIdleMs = 30_000;
const maxRedirects = 3;
const viewProbeBytes = 4096;
const maxViewBytes = 128 * 1024;
const genericViewMimes = new Set(['', 'application/octet-stream', 'binary/octet-stream', 'application/download', 'application/force-download']);

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

/** 将探测文件类型时取出的原字节接回流，正文仍按需从网络读取。 */
function replayFile(response: Response, reader: ReadableStreamDefaultReader<Uint8Array<ArrayBuffer>>, buffered: Uint8Array<ArrayBuffer>[], done: boolean): Response {
  let index = 0;
  const body = new ReadableStream<Uint8Array<ArrayBuffer>>({
    /** 先交付探测缓冲，然后继续原始流。 */
    async pull(controller) {
      if (index < buffered.length) { controller.enqueue(buffered[index++]); return; }
      if (done) { controller.close(); return; }
      const next = await reader.read();
      if (next.done) controller.close();
      else controller.enqueue(next.value);
    },
    /** 保存取消时释放最初的网络流。 */
    cancel() { return reader.cancel(); },
  }, { highWaterMark: 0 });
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}

/** 与文件头检查一致，识别常见 UTF-16 BOM 及默认 UTF-8。 */
function viewDecoder(prefix?: Uint8Array<ArrayBuffer>): TextDecoder {
  const encoding = prefix?.[0] === 255 && prefix[1] === 254 ? 'utf-16le' : prefix?.[0] === 254 && prefix[1] === 255 ? 'utf-16be' : 'utf-8';
  return new TextDecoder(encoding);
}

/** 仅在已验证的文件查看入口处理有界 HTML 正文，普通二进制响应继续保存。 */
async function readFileView(response: Response, entry: URL, original: URL, request: AbortController): Promise<Response | URL> {
  if (response.status !== 200 || response.redirected || (response.url && response.url !== entry.href) || !response.body) return response;
  const mime = (response.headers.get('content-type') ?? '').split(';', 1)[0].trim().toLowerCase();
  const isHtml = mime === 'text/html' || mime === 'application/xhtml+xml';
  if (!isHtml && !genericViewMimes.has(mime)) return response;

  const reader = response.body.getReader();
  let handedOff = false;
  let done = false;
  let bytes = 0;
  /** 对入口查看页的探测设总时限，避免不断送少量数据拖住批次。 */
  const timer = setTimeout(function viewTimedOut() { request.abort(new AppError('file_download_failed', '读取 Blackboard 课件查看页超时，请重试。')); }, networkIdleMs);
  /** 拉取一块并累计大小，探测和 HTML 读取共用原始流。 */
  async function next(): Promise<Uint8Array<ArrayBuffer> | undefined> {
    request.signal.throwIfAborted();
    const result = await waitForNetwork(reader.read(), request);
    if (result.done) { done = true; return undefined; }
    bytes += result.value.length;
    return result.value;
  }
  const buffered: Uint8Array<ArrayBuffer>[] = [];
  try {
    let decoder: TextDecoder | undefined;
    if (!isHtml) {
      const probe = new Uint8Array(viewProbeBytes);
      let length = 0;
      let htmlDetected = false;
      while (length < probe.length && !done) {
        const chunk = await next();
        if (!chunk) break;
        buffered.push(chunk);
        const prefix = chunk.subarray(0, probe.length - length);
        probe.set(prefix, length);
        length += prefix.length;
        decoder = viewDecoder(probe);
        const text = decoder.decode(probe.subarray(0, length)).trimStart();
        htmlDetected = /^<(?:!doctype\b|!--|\?xml\b|[a-z][\w:-]*(?:\s|\/?>))/i.test(text);
        // 足够的字节才区分二进制，允许分块跨越 BOM 或 HTML 开始标记。
        if (htmlDetected || (length >= 4 && text && !text.startsWith('<'))) break;
      }
      if (!htmlDetected) {
        const file = replayFile(response, reader, buffered, done);
        handedOff = true;
        return file;
      }
    }
    let html = '';
    /** 不复制超限分块，HTML 允许字节边界落在多字节字符内。 */
    function append(chunk: Uint8Array<ArrayBuffer>): void {
      if (bytes > maxViewBytes) throw new AppError('file_not_available', 'Blackboard 课件查看页过大，请在课程页面打开该文件。');
      decoder ??= viewDecoder(chunk);
      html += decoder.decode(chunk, { stream: true });
    }
    for (const chunk of buffered) {
      append(chunk);
    }
    while (!done) {
      const chunk = await next();
      if (!chunk) break;
      append(chunk);
    }
    return fileFromCoursewareView(html + (decoder?.decode() ?? ''), entry, original);
  } finally {
    clearTimeout(timer);
    if (!handedOff) { try { await reader.cancel(); } catch { /* 请求可能已中止。 */ } }
  }
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
    if (typeof result !== 'string') {
      const file = hop === 0 && entry.href !== source.originalUrl.href ? await readFileView(result, entry, source.originalUrl, request) : result;
      if (file instanceof Response) return { response: file, url };
      url = file;
      continue;
    }
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
