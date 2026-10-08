/** 文件用途：在已登录网页来源发起受限同源 GET，读取课程目录和逐页公告并报告不完整读取。 */
import { AppError } from '../shared/errors';
import type { AnnouncementSnapshot, Course, CourseDiscovery } from '../shared/types';
import { parseAnnouncementPage } from './announcements';
import { parseCourseDiscovery } from './discovery';
import { parseHtml } from './dom';
import { announcementUrl, BLACKBOARD_ORIGIN, isPortalUrl, PORTAL_URL, schoolUrl } from './policy';

export const MAX_ANNOUNCEMENT_PAGES = 20;
const REQUEST_TIMEOUT_MS = 15000;
const COLLECTION_TIMEOUT_MS = 60000;

/** 请求学校门户或一门课公告，凭据由浏览器携带，禁止读取或保存 Cookie。 */
export async function fetchSchoolDocument(url: string, courseId?: string): Promise<Document> {
  const requested = courseId ? announcementUrl(url, courseId) : schoolUrl(url);
  if (!courseId && !isPortalUrl(requested.href)) throw new AppError('unsafe_url', '只能读取学生门户与课程公告。');
  const controller = new AbortController();
  /** 结束无法及时返回的学校读取请求，不将网络原始错误展示给用户。 */
  function timeoutRequest(): void { controller.abort(); }
  const timer = setTimeout(timeoutRequest, REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(requested.href, { method: 'GET', credentials: 'same-origin', redirect: 'follow', cache: 'no-store', signal: controller.signal });
    if (response.status === 401 || response.status === 403) throw new AppError('login_required', '请确认仍登录 Blackboard，且能够访问所选课程公告。');
    if (!response.ok) throw new AppError('transport_error', 'Blackboard 暂时没有完成读取，请重试。');
    const finalUrl = new URL(response.url || requested.href);
    if (/login|signon|sso|auth/i.test(finalUrl.pathname) || finalUrl.origin !== BLACKBOARD_ORIGIN) throw new AppError('login_required', '登录状态已过期，请在学校页面重新登录。');
    schoolUrl(finalUrl.href);
    if (courseId) announcementUrl(finalUrl.href, courseId);
    else if (!isPortalUrl(finalUrl.href)) throw new AppError('unsupported_page', '学校门户发生了跳转，请打开 Blackboard 首页后重试。');
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) throw new AppError('unsupported_page', '学校返回的内容不是公告网页。');
    return parseHtml(await response.text());
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('transport_error', 'Blackboard 读取超时或网络断开，请重试。');
  } finally { clearTimeout(timer); }
}

/** 刷新门户课程列表；当前文档只用于专用标签页中已完整加载的同源门户备用读取。 */
export async function readCourseDiscovery(): Promise<CourseDiscovery> {
  const document = await fetchSchoolDocument(PORTAL_URL);
  return parseCourseDiscovery(document, PORTAL_URL);
}

/** 从所有已发现的安全公告分页合并证据；登录失败立即停止，分页失败明确返回 partial。 */
export async function readCourseAnnouncements(course: Course): Promise<AnnouncementSnapshot> {
  const startUrl = announcementUrl(course.announcementUrl, course.courseId).href;
  const pending = [startUrl];
  const visited = new Set<string>();
  const sources = new Map<string, AnnouncementSnapshot['sources'][number]>();
  const warnings = new Set<string>();
  const fetchedAt = new Date().toISOString();
  const started = Date.now();
  while (pending.length && visited.size < MAX_ANNOUNCEMENT_PAGES && Date.now() - started < COLLECTION_TIMEOUT_MS) {
    const url = pending.shift()!;
    if (visited.has(url)) continue;
    try {
      const document = await fetchSchoolDocument(url, course.courseId);
      const page = parseAnnouncementPage(document, url, course, fetchedAt);
      visited.add(url);
      for (const source of page.sources) sources.set(source.sourceId, source);
      for (const warning of page.warnings) warnings.add(warning);
      for (const next of page.nextUrls) if (!visited.has(next) && !pending.includes(next)) pending.push(next);
    } catch (error) {
      if (!visited.size || (error instanceof AppError && ['login_required', 'consent_required', 'course_mismatch', 'unsafe_url'].includes(error.code))) throw error;
      warnings.add('一页公告没有读取完成，回答仅能依据已读取的公告。');
      break;
    }
  }
  if (pending.length) warnings.add('公告分页超过本次读取上限或时间限制，部分公告尚未读取。');
  return { course, sources: [...sources.values()], fetchedAt, coverage: { status: warnings.size ? 'partial' : 'complete', pagesRead: visited.size, warnings: [...warnings] } };
}
