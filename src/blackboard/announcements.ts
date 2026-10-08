/** 文件用途：解析单门课程公告、纯文字证据与安全分页地址，保留原文出处和覆盖缺口。 */
import { AppError } from '../shared/errors';
import type { Course, SourceEvidence } from '../shared/types';
import { assertReadableDocument, plainText, textFingerprint } from './dom';
import { announcementUrl } from './policy';

export interface ParsedAnnouncementPage { sources: SourceEvidence[]; nextUrls: string[]; warnings: string[] }

/** 从完整正文容器取文字；MessageUniqueBody 可能只覆盖 Welcome 公告的一部分。 */
export function announcementBody(item: Element): string {
  const root = item.querySelector('.vtbegenerated, .announcementBody, .announcement-body') ?? item.querySelector('[id$="MessageUniqueBody"]');
  if (!root) return '';
  const clone = root.cloneNode(true) as Element;
  for (const metadata of clone.querySelectorAll('.announcementInfo, script, style, noscript')) metadata.remove();
  return plainText(clone);
}

/** 读取 Posted on 原始时间，避免按浏览器本机时区改写学校通知。 */
function publishedAt(item: Element): string {
  const candidates = item.querySelectorAll('.details > p, [id$="MessagePostedDate"], .announcementDate, .announcementInfo');
  for (const element of candidates) {
    const text = plainText(element);
    const match = text.match(/Posted on\s*:\s*([\s\S]*?)(?:\n|Posted by|Posted to|$)/i);
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return '';
}

/** 使用实际公告 DOM ID；缺少 ID 时以标题正文生成可重复识别的本地标识。 */
export function announcementIdentity(item: Element): string {
  const id = item.getAttribute('id') ?? '';
  if (/^_\d+_\d+$/.test(id)) return id;
  return `announcement-${textFingerprint(`${plainText(item.querySelector('h3.item, h3'))}\n${announcementBody(item)}`)}`;
}

/** 提取常见分页控件中的链接；有无法安全跟随的控件时明确标为覆盖不完整。 */
function pagination(document: Document, pageUrl: string, courseId: string): { nextUrls: string[]; warnings: string[] } {
  const urls = new Set<string>();
  const warnings = new Set<string>();
  for (const anchor of document.querySelectorAll<HTMLAnchorElement>('a[rel="next"], .paging a, .pagination a, .pagingcontrols a, .pagingControl a, .pageNext a, a[title*="Next"], a[aria-label*="Next"], a[title*="下一页"]')) {
    if (anchor.getAttribute('aria-disabled') === 'true' || anchor.classList.contains('disabled')) continue;
    const raw = anchor.getAttribute('href') ?? '';
    if (!raw || raw.startsWith('#') || /^javascript:/i.test(raw)) { warnings.add('页面分页依赖动态操作，未能读取该分页。'); continue; }
    try {
      const url = announcementUrl(raw, courseId, pageUrl);
      url.hash = '';
      if (url.href !== new URL(pageUrl).href.split('#')[0]) urls.add(url.href);
    } catch { warnings.add('发现无法验证课程范围的分页链接，已停止跟随该链接。'); }
  }
  for (const control of document.querySelectorAll('button[aria-label*="Next"], input[value="Next"], button[title*="Next"]')) {
    if (!control.hasAttribute('disabled')) warnings.add('页面分页按钮没有只读地址，未能读取该分页。');
  }
  return { nextUrls: [...urls], warnings: [...warnings] };
}

/** 校验筛选状态后解析公告列表；未知 DOM、混入其他课程与缺失正文均不能报完整成功。 */
export function parseAnnouncementPage(document: Document, pageUrl: string, course: Course, fetchedAt = new Date().toISOString()): ParsedAnnouncementPage {
  announcementUrl(pageUrl, course.courseId);
  assertReadableDocument(document);
  const selector = document.querySelector<HTMLSelectElement>('#searchSelectId');
  if (!selector && new URL(pageUrl).searchParams.get('context') === 'mybb') throw new AppError('unsupported_page', '没有识别到公告的课程筛选状态，请打开所选课程公告后重试。');
  if (selector && selector.value !== course.courseId) throw new AppError('course_mismatch', 'Blackboard 没有应用所选课程筛选，已停止读取。');
  const list = document.querySelector('#announcementList');
  if (!list) throw new AppError('unsupported_page', '公告页面结构没有识别成功，请在 Blackboard 打开该课公告后重试。');
  const sources: SourceEvidence[] = [];
  const warnings: string[] = [];
  for (const item of list.children) {
    if (item.tagName.toUpperCase() !== 'LI') continue;
    const title = plainText(item.querySelector('h3.item, h3'));
    if (!title) {
      if (plainText(item)) warnings.push('一个公告条目没有识别到标题，未将它纳入问答。');
      continue;
    }
    const body = announcementBody(item);
    if (!body) { warnings.push(`公告“${title}”没有识别到正文，未将它纳入问答。`); continue; }
    const sourceId = announcementIdentity(item);
    const anchorId = /^_\d+_\d+$/.test(item.id) ? item.id : '';
    const url = announcementUrl(pageUrl, course.courseId);
    url.hash = anchorId;
    sources.push({ sourceId, courseId: course.courseId, title, body, publishedAt: publishedAt(item), url: url.href, anchorId, breadcrumb: ['Blackboard 首页', 'Announcements', `${course.code}${course.section ? ` ${course.section}` : ''}`, title], fetchedAt });
  }
  const pages = pagination(document, pageUrl, course.courseId);
  return { sources, nextUrls: pages.nextUrls, warnings: [...warnings, ...pages.warnings] };
}
