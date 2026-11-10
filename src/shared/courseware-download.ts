/** 文件用途：校验已选课件的学校响应，并把原始字节流安全保存到用户选择的目录。 */
import { coursewareFileEntryUrl, coursewareFileExtension, coursewareFileUrl, isCoursewareFilename } from '../blackboard/courseware-policy';
import { readCoursewareResponse, waitForNetwork } from './courseware-file-transfer';
import type { CoursewareFile, CoursewareSelection } from './courseware-types';
import { AppError } from './errors';
import type { Course } from './types';

const mimeExtensions = new Map(Object.entries({
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/mspowerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.oasis.opendocument.text': 'odt',
  'application/vnd.oasis.opendocument.spreadsheet': 'ods',
  'application/vnd.oasis.opendocument.presentation': 'odp',
  'application/zip': 'zip',
  'application/x-zip-compressed': 'zip',
  'application/vnd.rar': 'rar',
  'application/x-rar-compressed': 'rar',
  'application/x-7z-compressed': '7z',
  'application/rtf': 'rtf',
  'text/rtf': 'rtf',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
}));
const genericTypes = new Set(['', 'application/octet-stream', 'binary/octet-stream', 'application/download', 'application/force-download']);
const zipExtensions = new Set(['zip', 'docx', 'pptx', 'xlsx', 'odt', 'ods', 'odp']);
const oleExtensions = new Set(['doc', 'ppt', 'xls']);
const recognizableHeaders = ['pdf', 'rtf', 'png', 'jpg', 'gif', 'rar', '7z'];
const headerBytes = 4096;

/** 把名称限制成一个 Windows 路径段，保留常用 Unicode 字符并为后缀留出长度。 */
function pathPart(value: string, fallback: string): string {
  const safe = [...value.normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_').trim()].slice(0, 100).join('').replace(/[ .]+$/, '');
  if (!safe) return fallback;
  return /^(?:con|prn|aux|nul|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³])(?: *\.|$)/i.test(safe) ? `_${safe}` : safe;
}

/** 优先读取 RFC 6266 的 UTF-8 文件名，格式不合法时退回普通 filename 参数。 */
function attachmentName(value: string): string {
  const encoded = value.match(/(?:^|;)\s*filename\*\s*=\s*UTF-8'[^']*'([^;]+)/i)?.[1];
  if (encoded) {
    try { return decodeURIComponent(encoded.trim()); } catch { /* 可继续使用普通文件名。 */ }
  }
  const fallback = value.match(/(?:^|;)\s*filename\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^;]+))/i);
  return fallback?.[1]?.replace(/\\(["\\])/g, '$1') ?? fallback?.[2]?.trim() ?? '';
}

/** 解码学校文件地址最后一段作为备用文件名，保留未能解码的显示内容。 */
function urlFilename(url: URL): string {
  const name = url.pathname.split('/').at(-1) ?? '';
  try { return decodeURIComponent(name); } catch { return name; }
}

/** 判断响应声明的类型能否与文件后缀共存，兼容通用 ZIP 和文本类型。 */
function compatibleMime(extension: string, declared: string): boolean {
  if (extension === declared) return true;
  if (declared === 'zip') return zipExtensions.has(extension);
  if (declared === 'txt') return ['csv', 'rtf'].includes(extension);
  return declared === 'jpg' && extension === 'jpeg';
}

/** 比较文件头签名，短响应也安全地判定为不匹配。 */
function startsWithBytes(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every(/** 逐字节比较响应开头。 */ function same(byte, index) { return bytes[index] === byte; });
}

/** 核对已支持格式的文件头。文本课件只接受无二进制控制字符的内容。 */
function matchesFileHeader(extension: string, bytes: Uint8Array, decoded: string): boolean {
  if (zipExtensions.has(extension)) return startsWithBytes(bytes, [80, 75, 3, 4]) || startsWithBytes(bytes, [80, 75, 5, 6]);
  if (oleExtensions.has(extension)) return startsWithBytes(bytes, [208, 207, 17, 224, 161, 177, 26, 225]);
  switch (extension) {
    case 'pdf': return decoded.startsWith('%PDF-');
    case 'rtf': return decoded.startsWith('{\\rtf');
    case 'png': return startsWithBytes(bytes, [137, 80, 78, 71, 13, 10, 26, 10]);
    case 'jpg': case 'jpeg': return startsWithBytes(bytes, [255, 216, 255]);
    case 'gif': return decoded.startsWith('GIF87a') || decoded.startsWith('GIF89a');
    case 'rar': return startsWithBytes(bytes, [82, 97, 114, 33, 26, 7, 0]) || startsWithBytes(bytes, [82, 97, 114, 33, 26, 7, 1, 0]);
    case '7z': return startsWithBytes(bytes, [55, 122, 188, 175, 39, 28]);
    case 'txt': case 'csv': return !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(decoded);
    default: return false;
  }
}

/** 确定已选课件的文件名。学校缺少格式元信息时，仅用可区分文件类型的签名补后缀。 */
function validatedName(response: Response, url: URL, originalUrl: URL, file: CoursewareFile, prefix: Uint8Array): string {
  const mime = (response.headers.get('content-type') ?? '').split(';', 1)[0].trim().toLowerCase();
  const encoding = startsWithBytes(prefix, [255, 254]) ? 'utf-16le' : startsWithBytes(prefix, [254, 255]) ? 'utf-16be' : 'utf-8';
  const decoded = new TextDecoder(encoding).decode(prefix);
  if (mime === 'text/html' || mime === 'application/xhtml+xml' || /^\s*<(?:!doctype\b|!--|\?xml\b|[a-z][\w:-]*(?:\s|\/?>))/i.test(decoded)) {
    if (/type\s*=\s*["']?password\b|\/webapps\/login|\bsign[ -]?in\b|\blog[ -]?in\b|登录/i.test(decoded)) throw new AppError('login_required', '请在 Blackboard 页面重新登录后再下载。');
    throw new AppError('file_not_available', '学校返回的是网页，未保存为课件。');
  }
  const fromHeader = attachmentName(response.headers.get('content-disposition') ?? '').trim();
  const fromUrl = urlFilename(url).trim();
  const declared = mimeExtensions.get(mime);
  const named = [fromHeader, fromUrl, urlFilename(originalUrl).trim(), file.name.trim()].find(isCoursewareFilename);
  const hint = coursewareFileExtension(`.${file.extension ?? ''}`);
  const compatibleHint = hint && (!declared || compatibleMime(hint, declared)) ? hint : undefined;
  const suffix = named?.split('.').at(-1) ?? compatibleHint ?? declared ?? recognizableHeaders.find(
    /** ZIP 和 OLE 的签名可对应多种文档格式，单凭签名不能决定后缀。 */
    function matches(candidate) { return matchesFileHeader(candidate, prefix, decoded); },
  );
  const extension = suffix?.toLowerCase();
  if (!suffix || !extension || (declared ? !compatibleMime(extension, declared) : !genericTypes.has(mime)) || !matchesFileHeader(extension, prefix, decoded)) {
    throw new AppError('file_not_available', '课件格式未识别或文件内容不完整，未写入本地。');
  }
  const stem = named ? named.slice(0, -(suffix.length + 1)) : fromHeader || file.name;
  return `${pathPart(stem, '课件')}.${suffix}`;
}

/** 读取网络流的一个分块，保留超时和取消状态，并屏蔽底层网络错误。 */
async function readChunk(reader: ReadableStreamDefaultReader<Uint8Array<ArrayBuffer>>, request: AbortController) {
  try { request.signal.throwIfAborted(); return await waitForNetwork(reader.read(), request); }
  catch { request.signal.throwIfAborted(); throw new AppError('file_download_failed', '课件传输中断，请重试。'); }
}

/** 最多检查固定长度的文件头，并保存已经取出的分块供后续原样写入。 */
async function readHeader(reader: ReadableStreamDefaultReader<Uint8Array<ArrayBuffer>>, request: AbortController) {
  const prefix = new Uint8Array(headerBytes);
  const buffered: Uint8Array<ArrayBuffer>[] = [];
  let length = 0;
  while (length < prefix.length) {
    const { done, value } = await readChunk(reader, request);
    if (done) break;
    buffered.push(value);
    const head = value.subarray(0, prefix.length - length);
    prefix.set(head, length);
    length += head.length;
  }
  return { prefix: prefix.subarray(0, length), buffered };
}

/** 在目标目录内查找一个未占用的文件名，按 Windows 规则忽略大小写。 */
async function unusedName(directory: FileSystemDirectoryHandle, filename: string): Promise<string> {
  const occupied = new Set<string>();
  for await (const name of directory.keys()) occupied.add(name.normalize('NFC').toLowerCase());
  const dot = filename.lastIndexOf('.');
  let candidate = filename;
  for (let index = 1; occupied.has(candidate.toLowerCase()); index++) candidate = `${filename.slice(0, dot)} (${index})${filename.slice(dot)}`;
  return candidate;
}

/** 写入经过检查的完整流。中断只清理本次创建且仍为空的文件。 */
async function writeCourseware(root: FileSystemDirectoryHandle, path: string[], filename: string, reader: ReadableStreamDefaultReader<Uint8Array<ArrayBuffer>>, buffered: Uint8Array<ArrayBuffer>[], request: AbortController): Promise<string> {
  const { signal } = request;
  let directory = root;
  let file: FileSystemFileHandle | undefined;
  let stream: FileSystemWritableFileStream | undefined;
  let name = filename;
  try {
    for (const part of path) {
      signal.throwIfAborted();
      directory = await directory.getDirectoryHandle(part, { create: true });
    }
    name = await unusedName(directory, filename);
    signal.throwIfAborted();
    const candidate = await directory.getFileHandle(name, { create: true });
    if ((await candidate.getFile()).size) throw new AppError('file_write_failed', '文件名刚被占用，请重试保存。');
    file = candidate;
    stream = await file.createWritable();
    for (const chunk of buffered) {
      signal.throwIfAborted();
      await stream.write(chunk);
    }
    while (true) {
      const { done, value } = await readChunk(reader, request);
      if (done) break;
      await stream.write(value);
    }
    signal.throwIfAborted();
    await stream.close();
    return [...path, name].join('/');
  } catch (error) {
    try { await stream?.abort(); } catch { /* 写入流可能已自行关闭。 */ }
    try { if (file && !(await file.getFile()).size) await directory.removeEntry(name); } catch { /* 权限变化时保留原错误。 */ }
    signal.throwIfAborted();
    if (error instanceof AppError) throw error;
    throw new AppError('file_write_failed', '无法写入所选目录，请检查目录权限或磁盘空间。');
  }
}

/** 使用学校声明的只读入口读取一个已选课件，并验证文件字节后写入所选目录。 */
export async function saveCoursewareFile(root: FileSystemDirectoryHandle, course: Pick<Course, 'code' | 'courseId'>, selection: CoursewareSelection, signal?: AbortSignal, schoolTabId?: number): Promise<string> {
  const file = coursewareFileUrl(selection.file.url);
  const entry = selection.file.entryUrl ? coursewareFileEntryUrl(selection.file.entryUrl, file, course.courseId) : file;
  signal?.throwIfAborted();
  const request = new AbortController();
  /** 将用户取消传给当前文件的请求。单文件超时由自身控制器处理。 */
  function cancel() { request.abort(signal?.reason); }
  signal?.addEventListener('abort', cancel, { once: true });
  let reader: ReadableStreamDefaultReader<Uint8Array<ArrayBuffer>> | undefined;
  try {
    const { response, url } = await readCoursewareResponse(entry, { originalUrl: file, courseId: course.courseId, schoolTabId }, request);
    reader = response.body?.getReader();
    if (response.status === 401) throw new AppError('login_required', '请在 Blackboard 页面重新登录后再下载。');
    if (response.status === 403) throw new AppError('file_not_available', '当前账号没有这份课件的访问权限。');
    if (response.status !== 200 || response.redirected || (response.url && response.url !== url.href) || !reader) throw new AppError('file_not_available', '学校没有返回可保存的课件文件。');
    const { prefix, buffered } = await readHeader(reader, request);
    const filename = validatedName(response, url, file, selection.file, prefix);
    const path = [pathPart(course.code, '课程'), ...selection.folders.map(/** 保留老师设置的栏目层级，并逐段清理目录名称。 */ function folderPart(folder) { return pathPart(folder.name, '文件夹'); })];
    /** 在扩展页面间串行分配本地文件名，防止两个批次覆盖彼此的文件。 */
    async function write(): Promise<string> { return writeCourseware(root, path, filename, reader!, buffered, request); }
    return await (navigator.locks ? navigator.locks.request('askblackboard-courseware-write', { signal: request.signal }, write) : write());
  } finally {
    signal?.removeEventListener('abort', cancel);
    try { await reader?.cancel(); } catch { /* 网络断开时读取流已关闭。 */ }
  }
}
