/** 文件用途：协调 Blackboard 标签页、受限只读采集、专用 DOM 备用标签页与来源回跳。 */
import { AppError, friendlyError } from '../shared/errors';
import type { AnnouncementSnapshot, Course, CourseDiscovery, ExtensionMessage, RuntimeResult, SourceEvidence } from '../shared/types';
import { MAX_ANNOUNCEMENT_PAGES } from '../blackboard/collector';
import type { ParsedAnnouncementPage } from '../blackboard/announcements';
import { isCourse, isTrustedExtensionSender, type ContentMessage } from '../blackboard/messages';
import { announcementUrl, BLACKBOARD_ORIGIN, PORTAL_URL, isPortalUrl } from '../blackboard/policy';
import { assignmentReadUrl, assignmentEntry, CONTENT_PATH } from '../blackboard/assignment-policy';
import { readCourseAssignments, type AssignmentPage } from '../blackboard/assignments';

const TAB_TIMEOUT_MS = 20000;

/** 延迟一次短暂的内容脚本就绪检查；不建立后台常驻轮询。 */
function delay(milliseconds: number): Promise<void> {
  /** 完成本次短延迟，不改变页面或保存数据。 */
  function finish(resolve: () => void): void { resolve(); }
  /** 设置仅用于当前读取的计时器。 */
  function schedule(resolve: () => void): void { setTimeout(finish, milliseconds, resolve); }
  return new Promise(schedule);
}

/** 等待指定标签页加载结束，监听器和超时均在结束时移除。 */
async function waitForTab(tabId: number): Promise<void> {
  const existing = await chrome.tabs.get(tabId);
  if (existing.status === 'complete') return;
  /** 在等待期间监听页面加载完成或标签页被关闭。 */
  function subscribe(resolve: () => void, reject: (error: Error) => void): void {
    /** 移除本次等待的所有事件及计时器。 */
    function cleanup(): void { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(updated); chrome.tabs.onRemoved.removeListener(removed); }
    /** 只响应本次目标标签页的加载完成。 */
    function updated(changedTabId: number, change: chrome.tabs.OnUpdatedInfo): void { if (changedTabId === tabId && change.status === 'complete') { cleanup(); resolve(); } }
    /** 用户关闭采集标签页时结束等待，不复建或操作用户的其他标签页。 */
    function removed(changedTabId: number): void { if (changedTabId === tabId) { cleanup(); reject(new AppError('tab_closed', 'Blackboard 采集页面已关闭，请重试。')); } }
    /** 为页面加载设置上限，避免查询永久等待。 */
    function timedOut(): void { cleanup(); reject(new AppError('tab_timeout', 'Blackboard 页面加载超时，请检查网络后重试。')); }
    const timer = setTimeout(timedOut, TAB_TIMEOUT_MS);
    chrome.tabs.onUpdated.addListener(updated);
    chrome.tabs.onRemoved.addListener(removed);
    /** 捕获在初次检查和监听器注册之间完成的快速导航。 */
    function checked(tab: chrome.tabs.Tab): void { if (tab.status === 'complete') { cleanup(); resolve(); } }
    /** 目标页已关闭或无法访问时移除等待监听。 */
    function checkFailed(): void { cleanup(); reject(new AppError('tab_closed', 'Blackboard 页面已关闭，请重新打开。')); }
    void chrome.tabs.get(tabId).then(checked, checkFailed);
  }
  return new Promise(subscribe);
}

/** 将受控消息交给已有内容脚本；脚本未注入时短暂重试，业务错误保持原代码。 */
async function sendContent<T>(tabId: number, message: ContentMessage): Promise<T> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    let result: RuntimeResult<T>;
    try { result = await chrome.tabs.sendMessage(tabId, message); } catch {
      if (attempt === 11) throw new AppError('content_unavailable', 'Blackboard 页面尚未连接扩展，请刷新学校页面后重试。');
      await delay(200);
      continue;
    }
    if (!result || !result.ok) throw new AppError(result?.ok === false ? result.error.code : 'content_unavailable', result?.ok === false ? result.error.message : 'Blackboard 页面尚未连接扩展，请刷新学校页面后重试。');
    return result.data;
  }
  throw new AppError('content_unavailable', '无法连接 Blackboard 内容脚本。');
}

/** 优先选择门户或公告标签页；不存在学校标签页时为用户打开正常登录入口。 */
async function blackboardTab(): Promise<number> {
  const tabs = await chrome.tabs.query({ url: `${BLACKBOARD_ORIGIN}/*` });
  /** 优先已打开的门户，其次公告；不会导航或读取现有作答、提交页 DOM。 */
  function order(left: chrome.tabs.Tab, right: chrome.tabs.Tab): number {
    const leftSafe = isPortalUrl(left.url ?? '') ? 2 : left.url?.includes('/execute/announcement') ? 1 : 0;
    const rightSafe = isPortalUrl(right.url ?? '') ? 2 : right.url?.includes('/execute/announcement') ? 1 : 0;
    return rightSafe - leftSafe || Number(right.active) - Number(left.active);
  }
  const existing = tabs.sort(order)[0];
  if (existing?.id !== undefined) return existing.id;
  const created = await chrome.tabs.create({ url: PORTAL_URL, active: true });
  if (created.id === undefined) throw new AppError('tab_unavailable', '无法打开 Blackboard，请手动打开学校首页。');
  await waitForTab(created.id);
  return created.id;
}

/** 判断需用户正常登录或同意学校条款的失败，备用传输不能绕过这些页面。 */
function requiresUserAction(error: unknown): boolean { return error instanceof AppError && ['login_required', 'consent_required', 'unsafe_url', 'invalid_course', 'account_unknown'].includes(error.code); }

/** 创建属于本轮的备用标签页，读取完成即关闭，只处理经过校验的学校只读地址。 */
async function fallbackTab<T>(url: string, operation: (tabId: number) => Promise<T>): Promise<T> {
  if (!isPortalUrl(url)) {
    const target = new URL(url);
    if (target.searchParams.has('course_id') && target.pathname !== '/webapps/blackboard/execute/announcement') assignmentReadUrl(url, target.searchParams.get('course_id')!);
    else announcementUrl(url);
  }
  const tab = await chrome.tabs.create({ url, active: false });
  if (tab.id === undefined) throw new AppError('tab_unavailable', '无法打开专用资料读取页面。');
  try { await waitForTab(tab.id); return await operation(tab.id); }
  finally { try { await chrome.tabs.remove(tab.id); } catch { /* 用户已经关闭专用页时无需重建或关闭其他页面。 */ } }
}

/** 动态页面可能晚于加载事件呈现，仅在专用页短暂重读，不点击条款或页面控件。 */
async function readRendered<T>(tabId: number, message: ContentMessage): Promise<T> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try { return await sendContent<T>(tabId, message); } catch (error) {
      if (!(error instanceof AppError) || !['unsupported_page', 'courses_not_found', 'page_loading'].includes(error.code) || attempt === 7) throw error;
      await delay(350);
    }
  }
  throw new AppError('unsupported_page', 'Blackboard 页面没有完成数据加载。');
}

/** 每次刷新课程目录，防止切换账号或学期后继续使用旧课程映射。 */
async function discover(tabId: number): Promise<CourseDiscovery> {
  try { return await sendContent<CourseDiscovery>(tabId, { type: 'read_discovery' }); } catch (error) {
    if (requiresUserAction(error)) throw error;
    /** 在已加载的专用门户 DOM 中提取课程与账号，无额外登录手段。 */
    async function readPortal(id: number): Promise<CourseDiscovery> { return readRendered(id, { type: 'read_discovery_page' }); }
    return fallbackTab(PORTAL_URL, readPortal);
  }
}

/** 对照刚读取的课程目录，验证请求来自当前学生实际可见的学期和教学班。 */
async function currentCourse(tabId: number, requested: Course): Promise<Course> {
  announcementUrl(requested.announcementUrl, requested.courseId);
  const discovery = await discover(tabId);
  for (const course of discovery.courses) if (course.courseId === requested.courseId && course.termId === requested.termId && course.code === requested.code && course.section === requested.section) return course;
  throw new AppError('course_changed', '当前账号、学期或课程列表已变化，请重新选择课程。');
}

/** 用本轮专用标签页逐页读取渲染后的公告；不会改动学生已经打开的页面。 */
async function collectRendered(course: Course): Promise<AnnouncementSnapshot> {
  /** 在单个专用标签页导航经过验证的公告分页，并合并来源与覆盖状态。 */
  async function readPages(tabId: number): Promise<AnnouncementSnapshot> {
    const queue = [announcementUrl(course.announcementUrl, course.courseId).href];
    const visited = new Set<string>();
    const sources = new Map<string, SourceEvidence>();
    const warnings = new Set<string>();
    const fetchedAt = new Date().toISOString();
    const started = Date.now();
    while (queue.length && visited.size < MAX_ANNOUNCEMENT_PAGES && Date.now() - started < 60000) {
      const url = queue.shift()!;
      if (visited.has(url)) continue;
      try {
        if (visited.size) { await chrome.tabs.update(tabId, { url: announcementUrl(url, course.courseId).href }); await waitForTab(tabId); }
        const page = await readRendered<ParsedAnnouncementPage>(tabId, { type: 'read_announcement_page', course, url });
        visited.add(url);
        for (const source of page.sources) sources.set(source.sourceId, { ...source, fetchedAt });
        for (const warning of page.warnings) warnings.add(warning);
        for (const next of page.nextUrls) if (!visited.has(next) && !queue.includes(next)) queue.push(announcementUrl(next, course.courseId).href);
      } catch (error) {
        if (!visited.size || requiresUserAction(error) || (error instanceof AppError && error.code === 'course_mismatch')) throw error;
        warnings.add('一页公告没有加载完成，已保留读取成功的其他公告。');
        break;
      }
    }
    if (queue.length) warnings.add('达到本次分页读取数量或时间上限，部分公告尚未读取。');
    return { course, sources: [...sources.values()], fetchedAt, coverage: { status: warnings.size ? 'partial' : 'complete', pagesRead: visited.size, warnings: [...warnings] } };
  }
  return fallbackTab(course.announcementUrl, readPages);
}

/** 主路线同源请求失败时改用专用页 DOM；部分读取的结果始终保持 partial。 */
async function collect(tabId: number, course: Course): Promise<AnnouncementSnapshot> {
  try { return await sendContent<AnnouncementSnapshot>(tabId, { type: 'read_announcements', course }); } catch (error) {
    if (requiresUserAction(error)) throw error;
    return collectRendered(course);
  }
}

/** 同源读取不支持时复用专用只读标签页，统一遍历规则与页面数量上限。 */
async function collectAssignments(tabId: number, course: Course): Promise<AnnouncementSnapshot> {
  try { return await sendContent<AnnouncementSnapshot>(tabId, { type: 'read_assignments', course }); }
  catch (error) { if (requiresUserAction(error)) throw error; }
  /** 专用标签页只导航经过同课程白名单验证的课程入口或内容列表。 */
  async function readRenderedAssignments(id: number): Promise<AnnouncementSnapshot> {
    let first = true;
    /** 页面加载后调用相同解析器，任何提交、作答与附件链接都不能进入队列。 */
    async function readPage(url: string): Promise<AssignmentPage> {
      if (!first) { await chrome.tabs.update(id, { url: assignmentReadUrl(url, course.courseId).href }); await waitForTab(id); }
      first = false;
      return readRendered<AssignmentPage>(id, { type: 'read_assignment_page', course });
    }
    return readCourseAssignments(course, readPage);
  }
  return fallbackTab(assignmentEntry(course.courseId), readRenderedAssignments);
}

/** 验证来源属于课程公告或作业列表后打开原文，再让内容脚本定位该公告和引用段落。 */
async function openSource(source: SourceEvidence, quote?: string): Promise<void> {
  if (!source || typeof source.url !== 'string' || typeof source.courseId !== 'string' || typeof source.sourceId !== 'string' || source.sourceId.length > 256 || (quote !== undefined && (typeof quote !== 'string' || quote.length > 10000))) throw new AppError('invalid_source', '来源信息无效，请重新查询。');
  const url = source.kind === 'assignment' ? assignmentReadUrl(source.url, source.courseId) : announcementUrl(source.url, source.courseId);
  if (source.kind === 'assignment' && url.pathname !== CONTENT_PATH) throw new AppError('unsafe_url', '作业出处只能打开内容列表。');
  if (source.anchorId) {
    if (!/^_\d+_\d+$/.test(source.anchorId)) throw new AppError('invalid_source', '公告定位信息无效。');
    url.hash = source.anchorId;
  }
  const tab = await chrome.tabs.create({ url: url.href, active: true });
  if (tab.id === undefined) throw new AppError('tab_unavailable', '无法打开来源页面。');
  await waitForTab(tab.id);
  await sendContent(tab.id, { type: 'highlight_source', sourceId: source.sourceId, quote });
}

/** 执行侧栏允许的查询或来源回跳；内部内容读取动作不能从网页入口触发。 */
async function handleMessage(raw: unknown): Promise<unknown> {
  if (!raw || typeof raw !== 'object' || typeof (raw as { type?: unknown }).type !== 'string') throw new AppError('invalid_message', '扩展请求无效，请重新打开侧栏。');
  const message = raw as ExtensionMessage;
  switch (message.type) {
    case 'ping': return true;
    case 'discover_courses': return discover(await blackboardTab());
    case 'collect_announcements': {
      if (!isCourse(message.course)) throw new AppError('invalid_course', '课程数据无效，请重新读取课程列表。');
      const tabId = await blackboardTab();
      return collect(tabId, await currentCourse(tabId, message.course));
    }
    case 'collect_assignments': {
      if (!isCourse(message.course)) throw new AppError('invalid_course', '课程数据无效，请刷新课程。');
      const tabId = await blackboardTab();
      return collectAssignments(tabId, await currentCourse(tabId, message.course));
    }
    case 'open_source': return openSource(message.source, message.quote);
    default: throw new AppError('invalid_message', '该操作不属于侧栏支持的只读查询。');
  }
}

/** 在消息通道中报告本轮结果；任何错误均不得包含学校会话或模型凭据。 */
function messageListener(raw: unknown, sender: chrome.runtime.MessageSender, respond: (result: RuntimeResult<unknown>) => void): boolean {
  if (!isTrustedExtensionSender(sender)) { respond({ ok: false, error: { code: 'untrusted_sender', message: '已拒绝网页发起的扩展操作。' } }); return false; }
  /** 将课程、公告或原文打开结果回复受信侧栏。 */
  function succeeded(data: unknown): void { respond({ ok: true, data }); }
  /** 将采集失败转换成稳定业务代码和无凭据说明。 */
  function failed(error: unknown): void { respond({ ok: false, error: { code: error instanceof AppError ? error.code : 'read_failed', message: friendlyError(error) } }); }
  void handleMessage(raw).then(succeeded, failed);
  return true;
}

/** 安装或启动时将配置存储限制在受信上下文，并配置用户点击图标打开侧栏。 */
async function initialize(): Promise<void> {
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  if (chrome.sidePanel?.setPanelBehavior) await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
}

/** 忽略不支持侧栏的浏览器初始化异常，查询错误由对应动作处理。 */
function initializationFailed(): void { /* 不记录可能含凭据的浏览器错误。 */ }
/** 浏览器启动或安装时恢复受信存储和侧栏动作设置，无后台学校轮询。 */
function initializeListener(): void { void initialize().catch(initializationFailed); }

chrome.runtime.onMessage.addListener(messageListener);
chrome.runtime.onInstalled.addListener(initializeListener);
chrome.runtime.onStartup.addListener(initializeListener);
initializeListener();
