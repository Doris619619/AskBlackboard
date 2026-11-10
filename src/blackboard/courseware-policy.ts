/** 文件用途：将课件目录与同源 WebDAV 文件限定在独立的只读地址范围。 */
import { AppError } from '../shared/errors';
import { assignmentEntry, assignmentReadUrl, CONTENT_PATH } from './assignment-policy';
import { BLACKBOARD_ORIGIN, schoolUrl } from './policy';

const fileSuffix = /\.(?:pdf|pptx?|docx?|xlsx?|txt|csv|rtf|odt|ods|odp|zip|rar|7z|png|jpe?g|gif)$/i;
const webDavId = /^xid-\d+_\d+$/i;
const webDavItem = /^pid-\d+-dt-content-rid-\d+_\d+$/i;
const repositories = new Set(['courses', 'institution', 'orgs', 'library']);

/** 判断可保存的课件格式；目录页没有文件名的 XID 链接还需由响应确认格式。 */
export function isCoursewareFilename(name: string): boolean { return fileSuffix.test(name.trim()); }

/** 验证课程入口或课件子目录，只允许从当前课程的内容列表读取。 */
export function coursewarePageUrl(courseId: string, url?: string): URL {
  if (url === undefined) return new URL(assignmentEntry(courseId));
  const target = assignmentReadUrl(url, courseId);
  if (target.pathname !== CONTENT_PATH) throw new AppError('unsafe_url', '只能读取当前课程的课件目录。');
  return target;
}

/** 接受学校内容系统中明确的文件链接，拒绝目录地址、操作参数和编码的路径分隔符。 */
export function coursewareFileUrl(raw: string, base = BLACKBOARD_ORIGIN): URL {
  try {
    const url = schoolUrl(raw, base);
    const [root, namespace, ...parts] = url.pathname.split('/').map(decodeURIComponent);
    if (root || namespace !== 'bbcswebdav' || !parts.length || url.search || raw.includes('\\')) throw new Error();
    for (const part of parts) {
      if (!part || part === '.' || part === '..' || /[\\/\u0000-\u001f\u007f]|%[a-f\d]{2}/i.test(part)) throw new Error();
    }
    const first = parts[0];
    const last = parts[parts.length - 1];
    const namedFile = isCoursewareFilename(last);
    const isFile = (parts.length === 1 && (webDavId.test(first) || namedFile))
      || (parts.length === 2 && webDavItem.test(first) && (webDavId.test(last) || namedFile))
      || (parts.length >= 2 && repositories.has(first) && namedFile);
    if (!isFile) throw new Error();
    url.hash = '';
    return url;
  } catch {
    throw new AppError('unsafe_url', '只能下载课程列表中可见的 Blackboard 课件文件。');
  }
}
