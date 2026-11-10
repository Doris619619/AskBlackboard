/** 文件用途：按教师设置的菜单及内容列表顺序读取单层课件目录，只采集元信息。 */
import { AppError } from '../shared/errors';
import type { CoursewareFile, CoursewareFolder, CoursewareListing } from '../shared/courseware-types';
import type { Course } from '../shared/types';
import { assignmentReadUrl, CONTENT_PATH, COURSE_PATH } from './assignment-policy';
import { coursewareFileUrl, coursewarePageUrl, isCoursewareFilename } from './courseware-policy';
import { assertReadableDocument, parseHtml, plainText } from './dom';

export { coursewarePageUrl } from './courseware-policy';

const restrictedType = /assignment|assessment|(?:^|[^a-z])(?:quiz|test|exam|survey)(?:[^a-z]|$)|作业|作業|测验|測驗|考试|考試/i;
const restrictedAction = /\/(?:assignment|assessment)(?:\/|$)|uploadAssignment|launchAssessment/i;

/** 判断节点及其行是否可见，允许用户折叠课程菜单容器本身。 */
function isVisible(node: Element, container: Element): boolean {
  for (let item: Element | null = node; item && item !== container; item = item.parentElement) {
    if (item.matches('[hidden], [aria-hidden="true"], .hideoff, .hidden') || /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(item.getAttribute('style') ?? '')) return false;
  }
  return true;
}

/** 保留教师给链接起的名字，去掉 Blackboard 仅供辅助技术使用的附加说明。 */
function linkName(link: Element): string {
  const label = link.cloneNode(true) as Element;
  for (const detail of label.querySelectorAll('.hideoff, [hidden], [aria-hidden="true"]')) detail.remove();
  return plainText(label);
}

/** 将可见链接转换成同课程目录；返回的标识稳定且保留不同名称的菜单入口。 */
function folderLink(link: Element, page: URL, course: Course): CoursewareFolder | undefined {
  const name = linkName(link);
  const href = link.getAttribute('href');
  if (!name || !href) return undefined;
  try {
    const target = assignmentReadUrl(href, course.courseId, page.href);
    if (target.pathname !== CONTENT_PATH) return undefined;
    const contentId = target.searchParams.get('content_id');
    target.searchParams.delete('mode');
    return { kind: 'folder', id: `folder:${contentId}:${name}`, name, url: target.href };
  } catch { return undefined; }
}

/** 将课件标题或附件链接转换为文件元信息，此处不读取文件响应或推断格式。 */
function fileLink(link: Element, page: URL): CoursewareFile | undefined {
  const href = link.getAttribute('href');
  if (!href) return undefined;
  try {
    const target = coursewareFileUrl(href, page.href);
    const last = decodeURIComponent(target.pathname.split('/').at(-1) ?? '');
    const name = linkName(link) || (isCoursewareFilename(last) ? last : '');
    return name ? { kind: 'file', id: target.href, name, url: target.href } : undefined;
  } catch { return undefined; }
}

/** 检查服务器返回的内容上下文，防止同源页面替换成其他课程或其他目录。 */
function checkContext(document: Document, page: URL, course: Course, requested?: string): void {
  if (requested !== undefined) {
    const folder = coursewarePageUrl(course.courseId, requested);
    if (page.pathname !== CONTENT_PATH || page.searchParams.get('content_id') !== folder.searchParams.get('content_id')) {
      throw new AppError('course_mismatch', 'Blackboard 返回了其他课件目录，请重新进入课程。');
    }
  }
  for (const link of document.querySelectorAll('#breadcrumbs a[href]')) {
    const raw = link.getAttribute('href')!;
    let target: URL;
    try { target = new URL(raw, page.href); } catch { continue; }
    if (target.pathname === COURSE_PATH || target.pathname === CONTENT_PATH) assignmentReadUrl(target.href, course.courseId);
  }
}

/** 从当前课程菜单提取全部内容区；保留 DOM 顺序，不按栏目名称或固定英文词归类。 */
function readMenu(menu: Element, page: URL, course: Course): CoursewareListing {
  const items = new Map<string, CoursewareFolder>();
  for (const link of menu.querySelectorAll('a[href]')) {
    if (!isVisible(link, menu)) continue;
    const folder = folderLink(link, page, course);
    if (folder && !items.has(folder.id)) items.set(folder.id, folder);
  }
  return { items: [...items.values()] };
}

/** 读取单层文件夹；先排除作业和测验条目，再考虑该条目的课件链接。 */
function readFolder(list: Element, page: URL, course: Course): CoursewareListing {
  const items = new Map<string, CoursewareFolder | CoursewareFile>();
  for (const row of list.children) {
    if (!isVisible(row, list)) continue;
    const icon = row.querySelector('img.item_icon');
    const contentType = [row.getAttribute('data-content-type'), icon?.getAttribute('alt'), icon?.getAttribute('title'), icon?.getAttribute('src')].join(' ');
    const heading = row.querySelector(':scope > h3 a[href], :scope > .item h3 a[href]');
    if (restrictedType.test(contentType) || restrictedAction.test(heading?.getAttribute('href') ?? '')) continue;
    if (heading && isVisible(heading, row)) {
      const folder = folderLink(heading, page, course);
      if (folder && new URL(folder.url).searchParams.get('content_id') !== page.searchParams.get('content_id')) {
        if (!items.has(folder.id)) items.set(folder.id, folder);
      } else {
        const file = fileLink(heading, page);
        if (file && !items.has(file.id)) items.set(file.id, file);
      }
    }
    for (const link of row.querySelectorAll('.attachments a[href], .vtbegenerated a[href]')) {
      if (!isVisible(link, row)) continue;
      const file = fileLink(link, page);
      if (file && !items.has(file.id)) items.set(file.id, file);
    }
  }
  return { items: [...items.values()] };
}

/** 从已验证的课程页面读取菜单或一层文件列表；未识别结构与空目录分别处理。 */
export function parseCoursewareListing(document: Document, pageUrl: string, course: Course, url?: string): CoursewareListing {
  const container = url === undefined
    ? document.querySelector('#courseMenuPalette_contents') ?? document.querySelector('.courseMenuPalette')
    : document.querySelector('#content_listContainer');
  try { assertReadableDocument(document); }
  catch (error) {
    if (!(container && error instanceof AppError && error.code === 'unsupported_page')) throw error;
    if (/^(?:Sign In|Log In|Login|登录)(?:\s|$)/i.test(plainText(document.querySelector('title')))) {
      throw new AppError('login_required', '请在 Blackboard 正常登录后重试。');
    }
  }
  const page = assignmentReadUrl(pageUrl, course.courseId);
  checkContext(document, page, course, url);
  if (!container) throw new AppError('unsupported_page', '未识别到课件目录，请在 Blackboard 打开该课程后重试。');
  return url === undefined ? readMenu(container, page, course) : readFolder(container, page, course);
}

/** 使用当前登录态读取一页 HTML；不跟随跳转，允许后台改读用户已打开且通过校验的同课程页面。 */
export async function readCoursewareListing(course: Course, url?: string): Promise<CoursewareListing> {
  const target = coursewarePageUrl(course.courseId, url);
  try {
    const response = await fetch(target.href, { method: 'GET', credentials: 'same-origin', redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(15000) });
    if ([401, 403].includes(response.status)) throw new AppError('login_required', '请在 Blackboard 正常登录后重试。');
    if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
      throw new AppError('courseware_redirect', '课件目录发生跳转，请在 Blackboard 检查登录并打开该课程后重试。');
    }
    if (!response.ok) throw new AppError('transport_error', '课件目录暂时无法读取，请重试。');
    if (!/text\/html|application\/xhtml\+xml/i.test(response.headers.get('content-type') ?? '')) {
      throw new AppError('unsupported_page', '课件目录不是支持的网页格式。');
    }
    return parseCoursewareListing(parseHtml(await response.text()), response.url || target.href, course, url);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('transport_error', '课件目录读取超时或网络断开，请重试。');
  }
}
