/** 文件用途：用虚构课件响应和内存目录验证批量下载的单文件边界与原始字节保存。 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { saveCoursewareFile } from '../src/shared/courseware-download';
import type { CoursewareSelection } from '../src/shared/courseware-types';

const schoolFile = 'https://bb.cuhk.edu.cn/bbcswebdav/pid-100-dt-content-rid-200_1/xid-200_1';
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
  return saveCoursewareFile(root as unknown as FileSystemDirectoryHandle, 'ECE4016', item, signal);
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

afterEach(/** 复原测试中替换的网络接口。 */ function restoreNetwork() { vi.unstubAllGlobals(); });

describe('课件文件保存', /** 验证目录、格式、拒绝范围和失败清理。 */ function coursewareDownloadCases() {
  it('保留课程和目录层级、UTF-8 文件名及原始 PDF 字节', /** 模拟 XID 响应和用户选中的本地目录。 */ async function savesPdf() {
    const root = new MemoryDirectory();
    const fetchMock = mockResponse(new Response(pdf, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="Week 01.pdf"; filename*=UTF-8\'\'%E8%AE%B2%E4%B9%89%2001.pdf' } }));
    expect(await save(root)).toBe('ECE4016/Content/Lecture/讲义 01.pdf');
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(schoolFile, expect.objectContaining({ method: 'GET', credentials: 'include', redirect: 'error' }));
    expect((await (await lecture(root)).getFileHandle('讲义 01.pdf')).bytes).toEqual([...pdf]);
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
});
