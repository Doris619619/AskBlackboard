/** 文件用途：用虚构课件响应和内存目录验证批量下载的单文件边界与原始字节保存。 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { saveCoursewareFile } from '../src/shared/courseware-download';
import type { CoursewareSelection } from '../src/shared/courseware-types';

const schoolFile = 'https://bb.cuhk.edu.cn/bbcswebdav/pid-100-dt-content-rid-200_1/xid-200_1';
const schoolEntry = 'https://bb.cuhk.edu.cn/webapps/blackboard/execute/content/file?cmd=view&content_id=_100_1&course_id=_700_1';
const pdf = new TextEncoder().encode('%PDF-1.7\r\nfixture\n');

/** 模拟浏览器文件只在关闭写入流时提交，写入中断后保留原文件。 */
class MemoryFile {
  bytes: number[] = [];

  /** 注入磁盘写入失败以验证清理路径。 */
  constructor(private failWrite = false) {}

  /** 保存大小供中断清理检查，测试无需构造浏览器 File 对象。 */
  async getFile(): Promise<Pick<File, 'size'>> { return { size: this.bytes.length }; }

  /** 模拟分块写入和提交，允许中断前检查待写数据没有变成本地文件。 */
  async createWritable() {
    const pending: number[] = [];
    const owner = this;
    return {
      /** 追加二进制分块，磁盘异常时不修改已提交数据。 */
      async write(chunk: Uint8Array) {
        if (owner.failWrite) throw new DOMException('disk unavailable', 'QuotaExceededError');
        pending.push(...chunk);
      },
      /** 模拟浏览器关闭后原子提交字节。 */
      async close() { owner.bytes = [...pending]; },
      /** 模拟中断后丢弃临时分块。 */
      async abort() { pending.length = 0; },
    };
  }
}

/** 为下载器提供目录遍历、查找、保留既有文件和删除空文件的最小替身。 */
class MemoryDirectory {
  entries = new Map<string, MemoryDirectory | MemoryFile>();

  /** 把磁盘写入失败模拟传到各级子目录。 */
  constructor(private failWrite = false) {}

  /** 以异步迭代器列出当前名称，包含重名目录。 */
  async *keys() { yield* this.entries.keys(); }

  /** 按照 File System Access API 行为返回或新建目录。 */
  async getDirectoryHandle(name: string, { create = false } = {}) {
    const entry = this.entries.get(name);
    if (entry instanceof MemoryDirectory) return entry;
    if (entry || !create) throw new Error('directory unavailable');
    const child = new MemoryDirectory(this.failWrite);
    this.entries.set(name, child);
    return child;
  }

  /** 按照 File System Access API 行为返回或新建文件。 */
  async getFileHandle(name: string, { create = false } = {}) {
    const entry = this.entries.get(name);
    if (entry instanceof MemoryFile) return entry;
    if (entry || !create) throw new Error('file unavailable');
    const child = new MemoryFile(this.failWrite);
    this.entries.set(name, child);
    return child;
  }

  /** 移除中断时产生的文件，目录和同名现存文件由用例检查。 */
  async removeEntry(name: string) { this.entries.delete(name); }
}

/** 构造从课程目录选中的课件，标题和子目录包含真实界面常见的格式。 */
function selection(name = 'Week 01.pdf', url = schoolFile): CoursewareSelection {
  return { file: { kind: 'file', id: 'file-1', name, url }, folders: [
    { kind: 'folder', id: 'content', name: 'Content', url: '' },
    { kind: 'folder', id: 'lecture', name: 'Lecture', url: '' },
  ] };
}

/** 将测试替身接入下载器，浏览器实测另用实际目录接口。 */
function save(root: MemoryDirectory, item = selection(), signal?: AbortSignal) {
  return saveCoursewareFile(root as unknown as FileSystemDirectoryHandle, { code: 'ECE4016', courseId: '_700_1' }, item, signal);
}

/** 按课件层级读取已创建的最后一级目录，供检查结果字节和文件名。 */
async function lecture(root: MemoryDirectory) {
  const course = await root.getDirectoryHandle('ECE4016');
  const content = await course.getDirectoryHandle('Content');
  return content.getDirectoryHandle('Lecture');
}

/** 用单个虚构响应替代全部网络请求，测试无法触达真实 Blackboard。 */
function mockResponse(response: Response) {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** 模拟浏览器发给扩展的跳转事件和手动跳转响应，后续请求仍由测试断言。 */
function mockFileRedirect(destination: string, response: Response) {
  const listeners = new Set<(event: Pick<chrome.webRequest.OnBeforeRedirectDetails, 'url' | 'redirectUrl' | 'method' | 'initiator'>) => void>();
  const redirects = { addListener: vi.fn(/** 暂存本轮监听器。 */ listener => listeners.add(listener)), removeListener: vi.fn(/** 请求结束后释放监听器。 */ listener => listeners.delete(listener)) };
  vi.stubGlobal('chrome', { runtime: { id: 'test-extension' }, webRequest: { onBeforeRedirect: redirects } });
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(/** 只为官方入口提供跳转，其他地址返回虚构文件。 */ async function fetchFile(url) {
    if (url !== schoolEntry) return response;
    for (const listener of listeners) listener({ url, redirectUrl: destination, method: 'GET', initiator: 'chrome-extension://test-extension' });
    return new Response(null, { status: 302 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, redirects, listeners };
}

afterEach(/** 复原测试中替换的网络接口和计时器。 */ function restoreNetwork() { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('课件文件保存', /** 验证目录、格式、拒绝范围和失败清理。 */ function coursewareDownloadCases() {
  it('保留课程和目录层级、UTF-8 文件名及原始 PDF 字节', /** 模拟 XID 响应和用户选中的本地目录。 */ async function savesPdf() {
    const root = new MemoryDirectory();
    const fetchMock = mockResponse(new Response(pdf, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="Week 01.pdf"; filename*=UTF-8\'\'%E8%AE%B2%E4%B9%89%2001.pdf' } }));
    expect(await save(root)).toBe('ECE4016/Content/Lecture/讲义 01.pdf');
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(schoolFile, expect.objectContaining({ method: 'GET', credentials: 'include', redirect: 'manual' }));
    expect((await (await lecture(root)).getFileHandle('讲义 01.pdf')).bytes).toEqual([...pdf]);
  });

  it('文件响应只有通用类型时用 PDF 签名补全标题后缀', /** 课件目录和下载响应都没有真实文件名，仍可从文件头确认格式。 */ async function detectsPdfFromBytes() {
    const root = new MemoryDirectory();
    const request = mockResponse(new Response(pdf, { headers: { 'Content-Type': 'application/octet-stream' } }));
    expect(await save(root, selection('Introduction'))).toBe('ECE4016/Content/Lecture/Introduction.pdf');
    expect(request).toHaveBeenCalledTimes(1);
    expect((await (await lecture(root)).getFileHandle('Introduction.pdf')).bytes).toEqual([...pdf]);
  });

  it('先请求学校只读文件入口，再经确认的 WebDAV 跳转保存原字节', /** 重现教师目录点击入口与原始 WebDAV 链接不同的下载。 */ async function savesThroughCourseEntry() {
    const root = new MemoryDirectory();
    const item = selection('Lecture 7');
    item.file.entryUrl = schoolEntry;
    const { fetchMock, listeners } = mockFileRedirect(schoolFile, new Response(pdf));
    expect(await save(root, item)).toBe('ECE4016/Content/Lecture/Lecture 7.pdf');
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual([schoolEntry, schoolFile]);
    for (const [, init] of fetchMock.mock.calls) expect(init).toMatchObject({ method: 'GET', redirect: 'manual' });
    expect(listeners.size).toBe(0);
    expect((await (await lecture(root)).getFileHandle('Lecture 7.pdf')).bytes).toEqual([...pdf]);
  });

  it.each([
    ['https://external.example/bbcswebdav/xid-200_1', 'file_redirect_blocked'],
    ['https://bb.cuhk.edu.cn/webapps/assignment/uploadAssignment?course_id=_700_1', 'file_redirect_blocked'],
    ['https://bb.cuhk.edu.cn/webapps/login/', 'login_required'],
  ])('不请求课件跳转到的非文件地址 %s', /** 同源操作页、外站和登录入口均不会收到后续 GET。 */ async function rejectsFileRedirect(destination, code) {
    const root = new MemoryDirectory();
    const item = selection();
    item.file.entryUrl = schoolEntry;
    const { fetchMock, listeners } = mockFileRedirect(destination, new Response(pdf));
    await expect(save(root, item)).rejects.toMatchObject({ code });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(0);
    expect(root.entries.size).toBe(0);
  });

  it('不请求与选中课程、课件不匹配的官方入口', /** 缓存或交接给出的入口也需按当前选中范围复核。 */ async function rejectsOtherFileEntry() {
    const root = new MemoryDirectory();
    const fetchMock = mockResponse(new Response(pdf));
    const item = selection();
    item.file.entryUrl = schoolEntry.replace('_700_1', '_799_1');
    await expect(save(root, item)).rejects.toMatchObject({ code: 'unsafe_url' });
    item.file.entryUrl = schoolEntry.replace('_100_1', '_101_1');
    await expect(save(root, item)).rejects.toMatchObject({ code: 'unsafe_url' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('下载响应没有文件名时结合课件目录给出的后缀和实际签名', /** ZIP 文件头无法区分多种 Office 文档，以学校目录的明确文件后缀确认格式。 */ async function savesWithListingHint() {
    const root = new MemoryDirectory();
    const item = selection('Introduction');
    item.file.extension = 'pptx';
    mockResponse(new Response(Uint8Array.of(80, 75, 3, 4, 1, 2, 3), { headers: { 'Content-Type': 'application/zip' } }));
    expect(await save(root, item)).toBe('ECE4016/Content/Lecture/Introduction.pptx');
  });

  it('只有共用的 ZIP 文件头时不猜测文件格式', /** 通用类型和无后缀文件名无法确认内部文档类别。 */ async function rejectsAmbiguousSignature() {
    const root = new MemoryDirectory();
    mockResponse(new Response(Uint8Array.of(80, 75, 3, 4, 1, 2, 3), { headers: { 'Content-Type': 'application/octet-stream' } }));
    await expect(save(root, selection('Introduction'))).rejects.toMatchObject({ code: 'file_not_available' });
    expect(root.entries.size).toBe(0);
  });

  it('在文件名或目录名冲突时分配新编号并保留既有文件', /** 测试大小写冲突且相邻编号已被目录占用。 */ async function preservesExistingFiles() {
    const root = new MemoryDirectory();
    const course = await root.getDirectoryHandle('ECE4016', { create: true });
    const content = await course.getDirectoryHandle('Content', { create: true });
    const directory = await content.getDirectoryHandle('Lecture', { create: true });
    const prior = await directory.getFileHandle('WEEK 01.PDF', { create: true });
    prior.bytes = [22];
    await directory.getDirectoryHandle('week 01 (1).pdf', { create: true });
    mockResponse(new Response(pdf, { headers: { 'Content-Type': 'application/octet-stream' } }));
    expect(await save(root)).toBe('ECE4016/Content/Lecture/Week 01 (2).pdf');
    expect(prior.bytes).toEqual([22]);
  });

  it.each([
    ['ppt', 'application/octet-stream', [208, 207, 17, 224, 161, 177, 26, 225]],
    ['pptx', 'application/zip', [80, 75, 3, 4, 1, 2, 3]],
  ] as const)('接受正确的 %s 二进制文件头', /** 普通 WebDAV MIME 仍需文件名和签名共同支持。 */ async function savesPowerPoint(extension, mime, bytes) {
    const root = new MemoryDirectory();
    mockResponse(new Response(Uint8Array.from(bytes), { headers: { 'Content-Type': mime } }));
    expect(await save(root, selection(`Week 01.${extension}`))).toBe(`ECE4016/Content/Lecture/Week 01.${extension}`);
    expect((await (await lecture(root)).getFileHandle(`Week 01.${extension}`)).bytes).toEqual([...bytes]);
  });

  it('拒绝伪装成 PDF 的登录页，且不创建本地条目', /** 即使响应文件名和 MIME 看似正常，也应识别真实登录内容。 */ async function rejectsDisguisedLogin() {
    const root = new MemoryDirectory();
    mockResponse(new Response('  <!DOCTYPE html><html><form><input type="password"></form></html>', { headers: { 'Content-Type': 'application/pdf' } }));
    await expect(save(root)).rejects.toMatchObject({ code: 'login_required' });
    expect(root.entries.size).toBe(0);
  });

  it('拒绝文件名、MIME 和实际内容不匹配的响应', /** 截断或错误页不能伪装为课件。 */ async function rejectsInvalidBody() {
    const root = new MemoryDirectory();
    mockResponse(new Response(pdf, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="wrong.pptx"' } }));
    await expect(save(root)).rejects.toMatchObject({ code: 'file_not_available' });
    expect(root.entries.size).toBe(0);
  });

  it('拒绝外站地址，取消后不发文件请求', /** 直接调用下载器也必须通过 URL 政策和用户取消状态。 */ async function rejectsBeforeFetching() {
    const root = new MemoryDirectory();
    const fetchMock = mockResponse(new Response(pdf));
    await expect(save(root, selection('Week 01.pdf', 'https://example.test/bbcswebdav/xid-200_1'))).rejects.toThrow();
    const controller = new AbortController();
    controller.abort();
    await expect(save(root, selection(), controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('本地写入失败时删除本次创建的空文件', /** 权限或空间错误不能留下看似成功的半成品。 */ async function cleansInterruptedFile() {
    const root = new MemoryDirectory(true);
    mockResponse(new Response(pdf, { headers: { 'Content-Type': 'application/pdf' } }));
    await expect(save(root)).rejects.toMatchObject({ code: 'file_write_failed' });
    expect((await lecture(root)).entries.size).toBe(0);
  });

  it('完成文件头检查后继续写入后续分块，路径段无法越出所选目录', /** 模拟分段传输以及老师或服务器提供的路径特殊字符。 */ async function preservesChunkedBody() {
    const root = new MemoryDirectory();
    const first = new Uint8Array(4096);
    first.set(pdf);
    const tail = Uint8Array.of(82, 255, 0, 12);
    const body = new ReadableStream<Uint8Array<ArrayBuffer>>({
      /** 发出跨越文件头读取上限的两个原始分块。 */
      start(controller) { controller.enqueue(first); controller.enqueue(tail); controller.close(); },
    });
    const item = selection();
    item.folders[1].name = '../Lecture';
    mockResponse(new Response(body, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="NUL.PDF"' } }));
    expect(await save(root, item)).toBe('ECE4016/Content/.._Lecture/_NUL.PDF');
    const course = await root.getDirectoryHandle('ECE4016');
    const content = await course.getDirectoryHandle('Content');
    const directory = await content.getDirectoryHandle('.._Lecture');
    expect((await directory.getFileHandle('_NUL.PDF')).bytes).toEqual([...first, ...tail]);
  });

  it('网络在文件头之后中断时取消保存并清理空文件', /** 验证传输中断的错误与写入中断可区分。 */ async function cleansBrokenTransfer() {
    const root = new MemoryDirectory();
    let first = true;
    const body = new ReadableStream<Uint8Array<ArrayBuffer>>({
      /** 通过首段校验后，在下一次读取时模拟连接中断。 */
      pull(controller) {
        if (!first) { controller.error(new Error('connection interrupted')); return; }
        first = false;
        const bytes = new Uint8Array(4096);
        bytes.set(pdf);
        controller.enqueue(bytes);
      },
    }, { highWaterMark: 0 });
    mockResponse(new Response(body, { headers: { 'Content-Type': 'application/pdf' } }));
    await expect(save(root)).rejects.toMatchObject({ code: 'file_download_failed' });
    expect((await lecture(root)).entries.size).toBe(0);
  });

  it('等待响应头超时会中止请求，且不会创建本地文件', /** 用假时钟控制一直不响应的学校请求。 */ async function timesOutWaitingForHeaders() {
    vi.useFakeTimers();
    const root = new MemoryDirectory();
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(/** 保持请求挂起直到下载器发出取消信号。 */ function stalledFetch(_url, init) {
      return new Promise(/** 模拟浏览器收到中止信号后结束请求。 */ function waitForAbort(_resolve, reject) {
        init?.signal?.addEventListener('abort', /** 以标准中止错误结束网络等待。 */ function aborted() { reject(new DOMException('aborted', 'AbortError')); }, { once: true });
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const saving = save(root);
    const failure = expect(saving).rejects.toMatchObject({ code: 'file_download_failed', message: expect.stringContaining('超时') });
    await vi.advanceTimersByTimeAsync(30_000);
    await failure;
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(root.entries.size).toBe(0);
  });

  it('等待后续数据超时会取消流并清理未写完的文件', /** 首段合法但后续没有任何数据，批量保存仍可继续。 */ async function timesOutWaitingForBody() {
    vi.useFakeTimers();
    const root = new MemoryDirectory();
    let cancelled = false;
    const body = new ReadableStream<Uint8Array<ArrayBuffer>>({
      /** 发出足够的文件头，使保存进入磁盘写入，然后保持网络停滞。 */
      start(controller) {
        const first = new Uint8Array(4096);
        first.set(pdf);
        controller.enqueue(first);
      },
      /** 记录下载器释放了挂起的响应流。 */
      cancel() { cancelled = true; },
    });
    mockResponse(new Response(body, { headers: { 'Content-Type': 'application/pdf' } }));
    const saving = save(root);
    const failure = expect(saving).rejects.toMatchObject({ code: 'file_download_failed', message: expect.stringContaining('超时') });
    await vi.advanceTimersByTimeAsync(0);
    expect((await lecture(root)).entries.size).toBe(1);
    await vi.advanceTimersByTimeAsync(30_000);
    await failure;
    expect(cancelled).toBe(true);
    expect((await lecture(root)).entries.size).toBe(0);
  });

  it('只要分块持续到达，总下载时间超过超时门槛也能完成', /** 每个分块均在等待期限内到达，但整份文件传输更久。 */ async function allowsSteadilyProgressingTransfer() {
    vi.useFakeTimers();
    const root = new MemoryDirectory();
    const first = new Uint8Array(4096);
    first.set(pdf);
    const middle = Uint8Array.of(1, 2);
    const last = Uint8Array.of(3, 4);
    const body = new ReadableStream<Uint8Array<ArrayBuffer>>({
      /** 以固定间隔发出虚构数据，模拟慢速但持续的网络。 */
      start(controller) {
        setTimeout(/** 先交付文件头。 */ function firstChunk() { controller.enqueue(first); }, 20_000);
        setTimeout(/** 继续传输正文分块。 */ function middleChunk() { controller.enqueue(middle); }, 40_000);
        setTimeout(/** 交付最后分块并结束响应。 */ function lastChunk() { controller.enqueue(last); controller.close(); }, 60_000);
      },
    });
    mockResponse(new Response(body, { headers: { 'Content-Type': 'application/pdf' } }));
    const saving = save(root);
    const success = expect(saving).resolves.toBe('ECE4016/Content/Lecture/Week 01.pdf');
    await vi.advanceTimersByTimeAsync(60_000);
    await success;
    expect((await (await lecture(root)).getFileHandle('Week 01.pdf')).bytes).toEqual([...first, ...middle, ...last]);
  });
});
