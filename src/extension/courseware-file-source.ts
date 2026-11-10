/** 文件用途：通过学校页同源读取已选课件，并在受信连接上按需传回文件字节。 */
import { coursewareFileEntryUrl, coursewareFileUrl } from '../blackboard/courseware-policy';
import { isTrustedExtensionSender } from '../blackboard/messages';
import { COURSEWARE_FILE_CHUNK_SIZE, COURSEWARE_FILE_PORT, type CoursewareFileReply, type CoursewareFileRequest } from '../shared/courseware-file-relay';
import { AppError, friendlyError } from '../shared/errors';

/** 仅允许受信扩展页打开一次性文件流，每次请求仍核对只读地址。 */
export function connectCoursewareFile(port: chrome.runtime.Port): void {
  if (port.name !== COURSEWARE_FILE_PORT) return;
  if (!port.sender || !isTrustedExtensionSender(port.sender)) { port.disconnect(); return; }
  const request = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array<ArrayBuffer>> | undefined;
  let buffered: Uint8Array<ArrayBuffer> | undefined;
  let opened = false;
  let reading = false;

  /** 连接关闭后及时释放正在等待的网络读取和缓冲。 */
  function disconnect(): void {
    request.abort();
    void reader?.cancel().catch(/** 中止后浏览器可能已释放响应。 */ function ignoreCancel() {});
  }

  /** 连接打开时传输经过裁剪的结果，不传递会话数据。 */
  function send(reply: CoursewareFileReply): void {
    if (request.signal.aborted) return;
    try { port.postMessage(reply); } catch { disconnect(); }
  }

  /** 只返回不含凭据的失败类型。 */
  function failed(error: unknown): void {
    send({ type: 'error', code: error instanceof AppError ? error.code : 'file_download_failed', message: friendlyError(error) });
    disconnect();
  }

  /** 在 Blackboard 页同源 GET，保留学校登录态，并把重定向交给扩展复核。 */
  async function open(message: Extract<CoursewareFileRequest, { type: 'open' }>): Promise<void> {
    if (opened) return;
    opened = true;
    const original = coursewareFileUrl(message.originalUrl);
    let target: URL;
    try { target = coursewareFileUrl(message.url); }
    catch { target = coursewareFileEntryUrl(message.url, original, message.courseId); }
    const response = await fetch(target.href, { method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'manual', signal: request.signal });
    if (response.type === 'opaqueredirect') { send({ type: 'headers', status: 302, mime: '', attachment: '' }); return; }
    if (response.redirected || (response.url && response.url !== target.href)) throw new AppError('file_redirect_blocked', 'Blackboard 课件响应地址未通过核对。');
    if (response.status === 200) {
      reader = response.body?.getReader();
      if (!reader) throw new AppError('file_not_available', '学校没有返回可保存的课件文件。');
    }
    send({ type: 'headers', status: response.status, mime: response.headers.get('Content-Type') ?? '', attachment: response.headers.get('Content-Disposition') ?? '' });
  }

  /** 浏览器消息使用 JSON，每次最多发送一个可复原的 32 KiB 二进制块。 */
  async function pull(): Promise<void> {
    if (!reader || reading) return;
    reading = true;
    try {
      if (!buffered?.length) {
        const chunk = await reader.read();
        if (chunk.done) { send({ type: 'end' }); return; }
        buffered = chunk.value;
      }
      const bytes = buffered.subarray(0, COURSEWARE_FILE_CHUNK_SIZE);
      buffered = buffered.subarray(bytes.length);
      send({ type: 'chunk', value: btoa(String.fromCharCode(...bytes)) });
    } finally { reading = false; }
  }

  /** 允许连接发起一次读取，后续只能索取下一个分块。 */
  function receive(message: CoursewareFileRequest): void {
    if (message?.type === 'open') void open(message).catch(failed);
    if (message?.type === 'pull') void pull().catch(failed);
  }

  port.onDisconnect.addListener(disconnect);
  port.onMessage.addListener(receive);
}
