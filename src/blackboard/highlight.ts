/** 文件用途：在公告页面定位已有证据并短暂高亮；不修改学校资料或任何作答表单。 */
import { AppError } from '../shared/errors';
import { announcementBody, announcementIdentity } from './announcements';
import { plainText } from './dom';
import { ANNOUNCEMENT_PATH, schoolUrl } from './policy';
import { assignmentReadUrl, CONTENT_PATH } from './assignment-policy';

/** 查找证据对应的公告；DOM ID 失效时只能使用同一公告的稳定正文指纹。 */
function sourceElement(document: Document, sourceId: string): Element | undefined {
  const list = document.querySelector('#announcementList');
  if (!list) return undefined;
  for (const item of list.children) if (announcementIdentity(item) === sourceId) return item;
  return undefined;
}

/** 将正确公告滚入视野并高亮引用所在段落；不能把找不到的来源定位到同标题公告。 */
export function highlightSource(document: Document, pageUrl: string, sourceId: string, quote?: string): void {
  const assignment = sourceId.startsWith('assignment:');
  const url = schoolUrl(pageUrl);
  if (assignment) {
    assignmentReadUrl(pageUrl, url.searchParams.get('course_id') ?? '');
    if (url.pathname !== CONTENT_PATH || !/^assignment:_\d+_\d+$/.test(sourceId)) throw new AppError('unsafe_url', '作业定位仅限内容列表。');
  } else if (url.pathname !== ANNOUNCEMENT_PATH) throw new AppError('unsafe_url', '来源定位只能在公告页面执行。');
  const item = assignment ? document.getElementById(`contentListItem:${sourceId.slice('assignment:'.length)}`) : sourceElement(document, sourceId);
  if (!item) throw new AppError('source_not_found', '该公告已不可见或页面结构发生变化，请在原文页确认来源。');
  let target = item;
  if (quote && announcementBody(item).includes(quote)) {
    for (const paragraph of item.querySelectorAll('.vtbegenerated p, .vtbegenerated li, .announcementBody p, [id$="MessageUniqueBody"] p')) {
      if (plainText(paragraph).includes(quote)) { target = paragraph; break; }
    }
  }
  const element = target as HTMLElement;
  const reduceMotion = document.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  element.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
  const previousOutline = element.style.outline;
  const previousBackground = element.style.backgroundColor;
  element.style.outline = '3px solid #b28422';
  element.style.backgroundColor = '#fff3bd';
  /** 恢复高亮前页面样式，不保存或改变公告内容。 */
  function restoreAppearance(): void { element.style.outline = previousOutline; element.style.backgroundColor = previousBackground; }
  setTimeout(restoreAppearance, 5000);
}
