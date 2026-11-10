/** 文件用途：从已验证的 Blackboard 页面逐块接收文件响应，保持本地写入只在受信扩展页进行。 */
import { AppError } from './errors';

export const COURSEWARE_FILE_PORT = 'askblackboard-courseware-file';
export const COURSEWARE_FILE_CHUNK_SIZE = 32 * 1024;

export type CoursewareFileRequest =
  | { type: 'open'; url: string; originalUrl: string; courseId: string }
  | { type: 'pull' };

export type CoursewareFileReply =
  | { type: 'headers'; status: number; mime: string; attachment: string }
  | { type: 'chunk'; value: string }
  | { type: 'end' }
  | { type: 'error'; code: string; message: string };

/** 使用已登录学校页发起一次读取，只有写入端请求下一块时才传送数据。 */
export function readFileFromSchoolTab(tabId: number, open: Extract<CoursewareFileRequest, { type: 'open' }>, signal: AbortSignal): Promise<Response> {
  /** 先交付响应头，正文以按需读取的流交给现有下载器。 */
  function receiveResponse(resolve: (response: Response) => void, reject: (reason: unknown) => void): void {
    const port = chrome.tabs.connect(tabId, { name: COURSEWARE_FILE_PORT, frameId: 0 });
    let stream: ReadableStreamDefaultController<Uint8Array<ArrayBuffer>> | undefined;
    let finishPull: (() => void) | undefined;
    let closed = false;

    /** 结束双方传输，并释放已被取消的分块读取。 */
    function close(): void {
      if (closed) return;
      closed = true;
      signal.removeEventListener('abort', abort);
      port.disconnect();
      settlePull();
    }

    /** 将错误交给正在等待响应头或正文的调用方。 */
    function fail(error: unknown): void {
      if (closed) return;
      if (stream) stream.error(error);
      else reject(error);
      close();
    }

    /** 随下载取消释放学校页中的 GET。 */
    function abort(): void { fail(signal.reason); }

    /** 学校标签页刷新或关闭时停止传输。 */
    function disconnected(): void {
      void chrome.runtime.lastError;
      fail(new AppError('file_transport_unavailable', 'Blackboard 页面连接已中断，请保留课程标签页并重试。'));
    }

    /** 每个数据块只完成一次对应的读取。 */
    function settlePull(): void {
      const finish = finishPull;
      finishPull = undefined;
      finish?.();
    }

    /** 每次只向学校页申请一个分块，磁盘写入速度控制传输节奏。 */
    function pull(): Promise<void> {
      return new Promise(/** 直到收到当前分块，才允许发起下一次读取。 */ function ask(resolvePull) {
        finishPull = resolvePull;
        try { port.postMessage({ type: 'pull' } satisfies CoursewareFileRequest); }
        catch { disconnected(); }
      });
    }

    /** 接收来自隔离内容脚本的有限元信息与二进制分块。 */
    function receive(reply: CoursewareFileReply): void {
      if (closed) return;
      switch (reply.type) {
        case 'headers': {
          const body = reply.status === 200 ? new ReadableStream<Uint8Array<ArrayBuffer>>({
            /** 保存写入端的流控制器，以接收后续二进制分块。 */
            start(controller) { stream = controller; }, pull, cancel: close,
          }, { highWaterMark: 0 }) : null;
          resolve(new Response(body, { status: reply.status, headers: { 'Content-Type': reply.mime, 'Content-Disposition': reply.attachment } }));
          if (!body) close();
          return;
        }
        case 'chunk': {
          if (typeof reply.value !== 'string' || reply.value.length > Math.ceil(COURSEWARE_FILE_CHUNK_SIZE / 3) * 4) {
            fail(new AppError('file_download_failed', 'Blackboard 课件返回了无效数据，请重试。'));
            return;
          }
          const binary = atob(reply.value);
          const bytes = new Uint8Array(binary.length);
          for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
          stream?.enqueue(bytes);
          settlePull();
          return;
        }
        case 'end': stream?.close(); close(); return;
        case 'error': fail(new AppError(reply.code, reply.message));
      }
    }

    port.onMessage.addListener(receive);
    port.onDisconnect.addListener(disconnected);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    else try { port.postMessage(open); } catch { disconnected(); }
  }
  return new Promise(receiveResponse);
}
