/** 文件用途：只接收受信扩展的有限命令，使用当前 Blackboard 登录读取门户、公告、作业列表和选中的课件。 */
import { AppError, friendlyError } from '../shared/errors';
import type { RuntimeResult } from '../shared/types';
import { parseAnnouncementPage } from '../blackboard/announcements';
import { readCourseAnnouncements, readCourseDiscovery } from '../blackboard/collector';
import { parseCourseDiscovery, readAccountName } from '../blackboard/discovery';
import { highlightSource } from '../blackboard/highlight';
import { isCourse, isTrustedExtensionSender, type ContentMessage } from '../blackboard/messages';
import { announcementUrl, isPortalUrl, schoolUrl } from '../blackboard/policy';
import { readCourseAssignments, parseAssignmentPage } from '../blackboard/assignments';
import { parseCoursewareListing, readCoursewareListing } from '../blackboard/courseware';
import { isBrowseAnchorUrl, type BrowseAnchor } from './browse-session';
import { connectCoursewareFile } from './courseware-file-source';

const documentToken = crypto.randomUUID();

/** 从已登录页头提取显示名，使用扩展生成的文档标识，不读取学校会话凭据。 */
function readBrowseDocument(): Omit<BrowseAnchor, 'tabId'> | undefined {
  if (!isBrowseAnchorUrl(location.href) || document.querySelector('input[type="password"], #loginForm, #loginFormList')) return undefined;
  const logoutLink = document.querySelector('a[id="topframe.logout.label"]')?.getAttribute('href');
  if (!logoutLink) return undefined;
  const logout = schoolUrl(logoutLink, location.href);
  if (logout.pathname !== '/webapps/login/' || logout.searchParams.get('action') !== 'logout') return undefined;
  const accountName = readAccountName(document);
  return accountName ? { documentToken, accountName } : undefined;
}

/** 执行内部只读动作；任何未经验证的 URL、课程对象和未知动作都会失败。 */
async function handleMessage(raw: unknown): Promise<unknown> {
  if (!raw || typeof raw !== 'object' || typeof (raw as { type?: unknown }).type !== 'string') throw new AppError('invalid_message', '读取请求无效，请重新打开侧栏。');
  const message = raw as ContentMessage;
  switch (message.type) {
    case 'ping': return true;
    case 'read_browse_anchor': return readBrowseDocument();
    case 'read_discovery': return readCourseDiscovery();
    case 'read_discovery_page':
      if (/login|signon|sso/i.test(location.pathname)) throw new AppError('login_required', '请在 Blackboard 页面正常登录，再回来查询。');
      if (!isPortalUrl(location.href)) throw new AppError('unsupported_page', '当前页面不是学生课程门户。');
      return parseCourseDiscovery(document, location.href);
    case 'read_announcements':
      if (!isCourse(message.course)) throw new AppError('invalid_course', '课程数据无效，请重新读取课程列表。');
      return readCourseAnnouncements(message.course);
    case 'read_assignments':
      if (!isCourse(message.course)) throw new AppError('invalid_course', '课程数据无效，请刷新课程。');
      return readCourseAssignments(message.course);
    case 'read_assignment_page':
      if (!isCourse(message.course)) throw new AppError('invalid_course', '课程数据无效，请刷新课程。');
      return parseAssignmentPage(document, location.href, message.course);
    case 'read_courseware':
    case 'read_courseware_page':
      if (!isCourse(message.course) || (message.folderUrl !== undefined && typeof message.folderUrl !== 'string')) throw new AppError('invalid_course', '课件目录无效，请重新选择课程。');
      if (message.type === 'read_courseware_page') return parseCoursewareListing(document, location.href, message.course, message.folderUrl);
      if (typeof message.pageUrl !== 'string') throw new AppError('invalid_message', '课件页面地址无效，请重新加载插件。');
      return readCoursewareListing(message.course, message.folderUrl, message.pageUrl);
    case 'read_announcement_page':
      if (!isCourse(message.course)) throw new AppError('invalid_course', '课程数据无效，请重新读取课程列表。');
      if (typeof message.url !== 'string') throw new AppError('invalid_message', '公告分页地址无效。');
      if (/login|signon|sso/i.test(location.pathname)) throw new AppError('login_required', '请在 Blackboard 页面正常登录，再回来查询。');
      if (announcementUrl(location.href, message.course.courseId).href.split('#')[0] !== announcementUrl(message.url, message.course.courseId).href.split('#')[0]) throw new AppError('page_loading', '公告分页尚未加载完成。');
      return parseAnnouncementPage(document, location.href, message.course);
    case 'highlight_source':
      if (typeof message.sourceId !== 'string' || message.sourceId.length > 256 || (message.quote !== undefined && (typeof message.quote !== 'string' || message.quote.length > 10000))) throw new AppError('invalid_message', '来源定位信息无效。');
      highlightSource(document, location.href, message.sourceId, message.quote);
      return undefined;
    default: throw new AppError('invalid_message', '该操作不属于支持的只读查询。');
  }
}

/** 将读取成功结果回复后台，读取失败仅返回无凭据的稳定错误说明。 */
function respondSuccess(data: unknown, respond: (result: RuntimeResult<unknown>) => void): void { respond({ ok: true, data }); }
/** 将已知业务错误和其他读取异常转换为安全响应，不暴露网络或页面原始数据。 */
function respondFailure(error: unknown, respond: (result: RuntimeResult<unknown>) => void): void { respond({ ok: false, error: { code: error instanceof AppError ? error.code : 'read_failed', message: friendlyError(error) } }); }

/** 只接受同一扩展受信来源的命令，并保持响应通道直到本次异步读取完成。 */
function messageListener(raw: unknown, sender: chrome.runtime.MessageSender, respond: (result: RuntimeResult<unknown>) => void): boolean {
  if (!isTrustedExtensionSender(sender)) { respondFailure(new AppError('untrusted_sender', '已拒绝来自网页的读取请求。'), respond); return false; }
  /** 交付本次读取的无凭据课程或页面数据。 */
  function onSuccess(data: unknown): void { respondSuccess(data, respond); }
  /** 交付本次读取错误，禁止转发网络原始响应。 */
  function onFailure(error: unknown): void { respondFailure(error, respond); }
  void handleMessage(raw).then(onSuccess, onFailure);
  return true;
}

chrome.runtime.onMessage.addListener(messageListener);
chrome.runtime.onConnect.addListener(connectCoursewareFile);
