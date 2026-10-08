/** 文件用途：限定 Blackboard 读取范围为学生门户与课程公告，拒绝作答、提交和任意跨站地址。 */
import { AppError } from '../shared/errors';

export const BLACKBOARD_ORIGIN = 'https://bb.cuhk.edu.cn';
export const PORTAL_URL = `${BLACKBOARD_ORIGIN}/webapps/portal/execute/tabs/tabAction?tab_tab_group_id=_1_1`;
export const ANNOUNCEMENT_PATH = '/webapps/blackboard/execute/announcement';
const readMethods = new Set(['', 'search', 'list', 'listAnnouncements']);
const readParameters = new Set(['method', 'context', 'searchSelect', 'searchSelectId', 'course_id', 'courseId', 'mode', 'page', 'pageIndex', 'startIndex', 'numResults', 'offset', 'limit', 'showAll', 'sortCol', 'sortDir']);

/** 解析学校同源绝对地址或相对链接；不接受认证信息、非 HTTPS 或其他站点。 */
export function schoolUrl(value: string, base = BLACKBOARD_ORIGIN): URL {
  let url: URL;
  try { url = new URL(value.trim(), base); } catch { throw new AppError('unsafe_url', '读取地址不属于支持的 Blackboard 公告页面。'); }
  if (url.origin !== BLACKBOARD_ORIGIN || url.username || url.password) throw new AppError('unsafe_url', '只能读取学校 Blackboard 的课程公告。');
  return url;
}

/** 判断门户路径，以免将当前作答页或其他课程内容当作课程目录读取。 */
export function isPortalUrl(value: string): boolean {
  try { return schoolUrl(value).pathname === '/webapps/portal/execute/tabs/tabAction'; } catch { return false; }
}

/** 检查公告路径、只读动作及课程范围；GET 方法本身不足以排除删除等动作。 */
export function announcementUrl(value: string, courseId?: string, base = BLACKBOARD_ORIGIN): URL {
  const url = schoolUrl(value, base);
  if (url.pathname !== ANNOUNCEMENT_PATH || !readMethods.has(url.searchParams.get('method') ?? '')) throw new AppError('unsafe_url', '只支持读取公告，不能打开测验作答或作业提交页面。');
  for (const key of url.searchParams.keys()) if (!readParameters.has(key)) throw new AppError('unsafe_url', '公告链接包含不支持的操作参数。');
  if (courseId) {
    if (!/^_\d+_\d+$/.test(courseId)) throw new AppError('invalid_course', '课程标识无效，请重新读取课程列表。');
    const scopes = ['searchSelect', 'searchSelectId', 'course_id', 'courseId'];
    let matched = false;
    for (const key of scopes) {
      const value = url.searchParams.get(key);
      if (value !== null) {
        if (value !== courseId) throw new AppError('course_mismatch', '公告链接与所选课程不一致，请重新读取课程。');
        matched = true;
      }
    }
    if (!matched) throw new AppError('course_mismatch', '公告链接没有课程筛选，已停止读取以免混入其他课程。');
  }
  return url;
}

/** 将已发现的全局或课程公告入口限定到一门课程；课程 ID 必须来自门户目录。 */
export function scopedAnnouncementUrl(value: string, courseId: string): string {
  const url = announcementUrl(value);
  for (const key of ['searchSelectId', 'course_id', 'courseId']) url.searchParams.delete(key);
  url.searchParams.set('method', 'search');
  url.searchParams.set('context', 'mybb');
  url.searchParams.set('searchSelect', courseId);
  url.hash = '';
  return announcementUrl(url.href, courseId).href;
}

/** 规范课程代码，例如 GED 2005 与 ged2005 归为 GED2005；不替代课程或教学班身份。 */
export function normalizeCourseCode(value: string): string {
  return value.toUpperCase().replace(/[\s_-]+/g, '');
}
