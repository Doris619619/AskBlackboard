/** 文件用途：从已登录学生门户发现账号显示名、学期、教学班及真实公告入口。 */
import { AppError } from '../shared/errors';
import type { Course, CourseDiscovery } from '../shared/types';
import { assertReadableDocument, plainText } from './dom';
import { announcementUrl, normalizeCourseCode, schoolUrl, scopedAnnouncementUrl } from './policy';

/** 清除辅助屏幕阅读文字和更新数量，只返回当前学生的显示姓名。 */
function accountName(document: Document): string {
  const element = document.querySelector('#global-nav-link, #loggedInUserName, #userName, .user-name');
  if (!element) return '';
  const clone = element.cloneNode(true) as Element;
  for (const hidden of clone.querySelectorAll('.hideoff, .badge, .activity-count')) hidden.remove();
  return plainText(clone).replace(/\s*\d*\s*Activity Updates.*$/i, '').replace(/\s*(?:活动更新|动态更新).*$/, '').trim();
}

/** 从课程名称取出代码；年份和学期编号不能被误认为课程代码。 */
function courseCode(value: string): string {
  const match = value.toUpperCase().replace(/_/g, '-').match(/(?:^|[^A-Z0-9])([A-Z]{2,8})[\s-]*(\d{3,5}[A-Z]?)(?=$|[^A-Z0-9])/);
  return match ? normalizeCourseCode(`${match[1]}${match[2]}`) : '';
}

/** 提取教学班原名；不猜测学生组别或根据课程编号合并教学班。 */
function sectionName(value: string): string {
  return value.toUpperCase().replace(/_/g, '-').match(/(?:^|[^A-Z0-9])((?:L|T|P|G|D)\d{1,2}[A-Z]?)(?=$|[^A-Z0-9])/)?.[1] ?? '';
}

/** 移除折叠辅助文字，读取 CUHK(SZ) 门户实际展示的学期编号。 */
function termLabel(heading: Element): string {
  const clone = heading.cloneNode(true) as Element;
  for (const hidden of clone.querySelectorAll('.hideoff')) hidden.remove();
  return plainText(clone).replace(/^(?:Collapse|Expand)\s*/i, '').trim();
}

/** 查找安全公告入口，任何作答、提交或编辑链接都不会进入目录结果。 */
function firstAnnouncementLink(root: ParentNode, base: string): string {
  for (const anchor of root.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    try { return announcementUrl(anchor.getAttribute('href') ?? '', undefined, base).href; } catch { /* 非公告链接不属于采集范围。 */ }
  }
  return '';
}

/** 解析门户课程模块；保留学期与教学班并通过真实链接建立公告读取地址。 */
export function parseCourseDiscovery(document: Document, pageUrl: string): CourseDiscovery {
  assertReadableDocument(document);
  const module = document.querySelector('#My_Courses_Tools');
  if (!module) throw new AppError('unsupported_page', '没有识别到 Blackboard 学生课程模块，请打开学校首页后重试。');
  const name = accountName(document);
  if (!name) throw new AppError('account_unknown', '没有识别到当前学生姓名，请刷新 Blackboard 首页后重试。');
  const fallbackEntry = firstAnnouncementLink(module, pageUrl) || firstAnnouncementLink(document, pageUrl);
  const courses: Course[] = [];
  const seen = new Set<string>();
  const termIds: string[] = [];
  for (const heading of module.querySelectorAll('h3.termHeading-coursefakeclass, h3')) {
    const label = termLabel(heading);
    const termId = label.match(/\b\d{4}(?:UG|PG)\b/i)?.[0]?.toUpperCase() ?? label;
    const group = heading.nextElementSibling;
    if (!termId || !group || !group.querySelector('.courseListing')) continue;
    termIds.push(termId);
    for (const item of group.querySelectorAll('.courseListing > li')) {
      let launcher: HTMLAnchorElement | undefined;
      let courseId = '';
      for (const anchor of item.querySelectorAll<HTMLAnchorElement>('a[href]')) {
        try {
          const url = schoolUrl(anchor.getAttribute('href') ?? '', pageUrl);
          const id = url.searchParams.get('id') ?? '';
          if (url.pathname === '/webapps/blackboard/execute/launcher' && url.searchParams.get('type') === 'Course' && /^_\d+_\d+$/.test(id)) { launcher = anchor; courseId = id; break; }
        } catch { /* 仅解析目录中学校同源的课程链接。 */ }
      }
      if (!launcher || seen.has(`${termId}:${courseId}`)) continue;
      const title = plainText(launcher);
      const code = courseCode(title);
      if (!code) continue;
      const entry = firstAnnouncementLink(item, pageUrl) || fallbackEntry;
      if (!entry) throw new AppError('announcements_not_found', '课程目录没有可识别的公告入口，请打开首页 Announcements 后重试。');
      courses.push({ courseId, code, title, termId, termLabel: label, section: sectionName(title), announcementUrl: scopedAnnouncementUrl(entry, courseId) });
      seen.add(`${termId}:${courseId}`);
    }
  }
  if (!courses.length) throw new AppError('courses_not_found', '没有发现可读取的学生课程，请确认 Blackboard 首页课程列表已加载。');
  /** 学校学期编号前四位按时间递增；保留全部学期供界面选择，默认使用最新编号。 */
  function newestTerm(left: string, right: string): number { return right.localeCompare(left, 'en', { numeric: true }); }
  const currentTermId = [...new Set(termIds)].sort(newestTerm)[0] ?? courses[0].termId;
  return { courses, currentTermId, accountName: name };
}
