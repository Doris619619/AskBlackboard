/** 文件用途：读取课程内容列表中的作业说明与截止字段，只遍历同课程文件夹，不点击提交入口或下载附件。 */
import { AppError } from '../shared/errors';
import type { AnnouncementSnapshot, Course, SourceEvidence } from '../shared/types';
import { assertReadableDocument, parseHtml, plainText } from './dom';
import { assignmentEntry, assignmentReadUrl, CONTENT_PATH } from './assignment-policy';

export interface AssignmentPage { sources: SourceEvidence[]; nextUrls: string[]; warnings: string[] }

/** 从已验证列表提取作业元信息；上传链接只用于辨认条目类型，永远不进入读取队列。 */
export function parseAssignmentPage(document: Document, pageUrl: string, course: Course, fetchedAt = new Date().toISOString()): AssignmentPage {
  assertReadableDocument(document);
  const url = assignmentReadUrl(pageUrl, course.courseId);
  const list = document.querySelector('#content_listContainer');
  const menu = document.querySelector('#courseMenuPalette_contents');
  if (!list && !menu) throw new AppError('unsupported_page', '未识别到课程内容列表，不能判断是否有作业。');
  // 同页课程导航也必须匹配，避免服务器返回另一门课程的 HTML。
  for (const link of document.querySelectorAll('#breadcrumbs a[href*="courseMain"], #courseMenu_combo')) {
    const href = link.getAttribute('href');
    if (href) assignmentReadUrl(href, course.courseId, url.href);
  }
  const sources: SourceEvidence[] = [];
  const warnings: string[] = [];
  const nextUrls = new Set<string>();
  for (const link of document.querySelectorAll('#courseMenuPalette_contents a[href], #content_listContainer h3 a[href], .paging a[href]')) {
    try {
      const next = assignmentReadUrl(link.getAttribute('href')!, course.courseId, url.href);
      if (next.pathname !== CONTENT_PATH) continue;
      next.searchParams.delete('mode');
      if (next.href !== url.href) nextUrls.add(next.href);
    } catch { /* 非文件夹链接（包括提交、测验、附件和其他课程）不读取。 */ }
  }
  for (const item of list?.children ?? []) {
    const title = plainText(item.querySelector('h3'));
    const icon = item.querySelector('img.item_icon')?.getAttribute('alt') ?? '';
    const headingLink = item.querySelector('h3 a')?.getAttribute('href') ?? '';
    let headingUrl: URL | undefined;
    try { if (headingLink) headingUrl = new URL(headingLink, url.href); }
    catch { warnings.push('一个内容条目的链接无效，已跳过。'); continue; }
    if (/folder|文件夹/i.test(icon) || headingUrl?.pathname === CONTENT_PATH) continue;
    if (/test|quiz|测验|考试/i.test(icon) || /assessment|launchAssessment/i.test(headingLink)) continue;
    if (!/assignment|作业/i.test(icon) && !headingLink.includes('/webapps/assignment/uploadAssignment') && !/assignment|homework|作业|report|报告|project|项目|\bhw\s*\d/i.test(title)) continue;
    if (headingLink.includes('/webapps/assignment/uploadAssignment')) {
      const target = headingUrl!;
      if (target.origin !== url.origin || target.searchParams.get('course_id') !== course.courseId) { warnings.push('一个作业条目的课程范围不匹配，已跳过。'); continue; }
    }
    const id = item.id.replace(/^contentListItem:/, '');
    if (!/^_\d+_\d+$/.test(id)) { warnings.push('一个作业没有可定位编号，已跳过。'); continue; }
    const bodyParts = [...item.querySelectorAll('.vtbegenerated')].map(plainText);
    // 标签字段和说明同时保留；不同字段冲突时交由直接回答明确列出。
    for (const field of item.querySelectorAll('.contextItemDetailsHeaders')) {
      const label = plainText(field.querySelector('.detailsLabel'));
      if (/due|deadline|截止/i.test(label)) bodyParts.push(`${label} ${plainText(field.querySelector('.detailsValue')).replace(/\s+/g, ' ')}`.trim());
    }
    const body = bodyParts.filter(Boolean).join('\n');
    if (!body) warnings.push(`${title || '一项作业'}没有可见说明或截止字段。`);
    sources.push({ kind: 'assignment', sourceId: `assignment:${id}`, courseId: course.courseId, title: title || '未命名作业', publishedAt: '', body, url: url.href, anchorId: id, breadcrumb: [course.code, plainText(document.querySelector('#pageTitleHeader')) || '课程内容', title], fetchedAt });
  }
  return { sources, nextUrls: [...nextUrls], warnings };
}

/** 同源读取课程列表，校验最终位置；不读取Cookie、附件、提交页面或表单值。 */
async function fetchAssignmentPage(url: string, course: Course): Promise<AssignmentPage> {
  const safe = assignmentReadUrl(url, course.courseId);
  try {
    const response = await fetch(safe.href, { method: 'GET', credentials: 'same-origin', redirect: 'follow', cache: 'no-store', signal: AbortSignal.timeout(15000) });
    if ([401, 403].includes(response.status) || /login|signon|sso|auth/i.test(new URL(response.url || safe.href).pathname)) throw new AppError('login_required', '请在 Blackboard 正常登录后查询作业。');
    if (!response.ok) throw new AppError('transport_error', '作业列表暂时无法读取。');
    const final = assignmentReadUrl(response.url || safe.href, course.courseId);
    if (!/text\/html|application\/xhtml\+xml/i.test(response.headers.get('content-type') || 'text/html')) throw new AppError('unsupported_page', '作业列表不是支持的网页格式。');
    return parseAssignmentPage(parseHtml(await response.text()), final.href, course);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('transport_error', '作业列表读取超时或网络断开。');
  }
}

/** 有界遍历实际可见文件夹并去重；失败明确标记覆盖不完整，不把失败当成没有作业。 */
export async function readCourseAssignments(course: Course, readPage: (url: string, course: Course) => Promise<AssignmentPage> = fetchAssignmentPage): Promise<AnnouncementSnapshot> {
  const queue = [assignmentEntry(course.courseId)];
  const visited = new Set<string>();
  const queued = new Set(queue);
  const sources = new Map<string, SourceEvidence>();
  const warnings = new Set<string>();
  const fetchedAt = new Date().toISOString();
  const start = Date.now();
  let pagesRead = 0;
  while (queue.length && visited.size < 40 && Date.now() - start < 60000) {
    const url = queue.shift()!;
    visited.add(url);
    try {
      const page = await readPage(assignmentReadUrl(url, course.courseId).href, course);
      pagesRead += 1;
      for (const source of page.sources) sources.set(source.sourceId, { ...source, fetchedAt });
      for (const warning of page.warnings) warnings.add(warning);
      for (const next of page.nextUrls) {
        const safe = assignmentReadUrl(next, course.courseId).href;
        if (!queued.has(safe)) { queued.add(safe); queue.push(safe); }
      }
    } catch (error) {
      if (visited.size === 1 || (error instanceof AppError && ['login_required', 'consent_required', 'course_mismatch', 'unsafe_url'].includes(error.code))) throw error;
      warnings.add('部分课程文件夹未读取成功，当前作业列表可能不完整。');
    }
  }
  if (queue.length) warnings.add('达到读取页数或时间上限，部分课程文件夹尚未读取。');
  return { course, scope: 'assignments', sources: [...sources.values()], fetchedAt, coverage: { status: warnings.size ? 'partial' : 'complete', pagesRead, warnings: [...warnings] } };
}
