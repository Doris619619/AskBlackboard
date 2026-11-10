/** 文件用途：将课件目录与同源 WebDAV 文件限定在独立的只读地址范围。 */
import { AppError } from '../shared/errors';
import { assignmentEntry, assignmentReadUrl, CONTENT_PATH } from './assignment-policy';
import { ANNOUNCEMENT_PATH, BLACKBOARD_ORIGIN, schoolUrl } from './policy';

const fileSuffix = /\.(?:pdf|pptx?|docx?|xlsx?|txt|csv|rtf|odt|ods|odp|zip|rar|7z|png|jpe?g|gif)$/i;
const webDavId = /^xid-\d+_\d+$/i;
const webDavItem = /^pid-(\d+)-dt-content-rid-\d+_\d+$/i;
const fileEntryPath = '/webapps/blackboard/execute/content/file';
const repositories = new Set(['courses', 'institution', 'orgs', 'library']);
export const COURSEWARE_REDIRECT_MESSAGE = '无法确认课件目录的跳转目标，请在 Blackboard 打开该课程的课件栏目后重试。';

/** 判断可保存的课件格式；目录页没有文件名的 XID 链接还需由响应确认格式。 */
export function isCoursewareFilename(name: string): boolean { return fileSuffix.test(name.trim()); }

/** 从已知文件名提取小写后缀，只返回课件支持的格式。 */
export function coursewareFileExtension(name: string): string | undefined {
  return fileSuffix.exec(name.trim())?.[0].slice(1).toLowerCase();
}

/** 构建固定的同课程公告入口，课件读取只使用其教师菜单。 */
export function coursewareMenuUrl(courseId: string): URL {
  if (!/^_\d+_\d+$/.test(courseId)) throw new AppError('course_mismatch', '课件页面与所选课程不一致。');
  const url = new URL(ANNOUNCEMENT_PATH, BLACKBOARD_ORIGIN);
  url.search = new URLSearchParams({ method: 'search', context: 'course_entry', course_id: courseId, handle: 'announcements_entry', mode: 'view' }).toString();
  return url;
}

/** 验证请求页面。课程根可进入该课程的只读首页，子目录跳转必须保留原目录标识。 */
export function coursewarePageUrl(courseId: string, folderUrl?: string, pageUrl?: string): URL {
  const initial = folderUrl === undefined ? new URL(assignmentEntry(courseId)) : assignmentReadUrl(folderUrl, courseId);
  if (folderUrl === undefined && pageUrl !== undefined) {
    const menu = coursewareMenuUrl(courseId);
    if (pageUrl === menu.href) return menu;
  }
  const target = pageUrl === undefined ? initial : assignmentReadUrl(pageUrl, courseId, initial.href);
  if (folderUrl !== undefined && (initial.pathname !== CONTENT_PATH || target.pathname !== CONTENT_PATH || target.searchParams.get('content_id') !== initial.searchParams.get('content_id'))) {
    throw new AppError('unsafe_url', '只能读取当前课程的所选课件目录。');
  }
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

/** Blackboard 文件链接可声明一个只读点击入口，必须与选中的课程和 WebDAV 内容项匹配。 */
export function coursewareFileEntryUrl(raw: string, file: URL, courseId: string, base = BLACKBOARD_ORIGIN): URL {
  const url = schoolUrl(raw, base);
  const contentNumber = webDavItem.exec(decodeURIComponent(file.pathname.split('/')[2] ?? ''))?.[1];
  const params = url.searchParams;
  if (!contentNumber || !/^_\d+_\d+$/.test(courseId) || url.pathname !== fileEntryPath || url.hash
    || params.size !== 3 || params.get('cmd') !== 'view' || params.get('course_id') !== courseId
    || params.get('content_id') !== `_${contentNumber}_1`) {
    throw new AppError('unsafe_url', '课件入口与选中的课程或文件不一致。');
  }
  return url;
}
