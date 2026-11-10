/** 文件用途：以当前学校页面绑定课程浏览缓存，并在观察到登录、退出或导航时使缓存失效。 */
import { assignmentReadUrl } from '../blackboard/assignment-policy';
import { coursewareMenuUrl } from '../blackboard/courseware-policy';
import { ANNOUNCEMENT_PATH, BLACKBOARD_ORIGIN, announcementUrl, isPortalUrl } from '../blackboard/policy';
import type { RuntimeResult } from '../shared/types';

export interface BrowseAnchor {
  tabId: number;
  documentToken: string;
  accountName: string;
}

const myBlackboardPath = '/webapps/bb-social-learning-BBLEARN/execute/mybb';

/** 仅在已知只读学校页面提取页头身份提示，拒绝登录、作答、提交和任意外部页面。 */
export function isBrowseAnchorUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.origin !== BLACKBOARD_ORIGIN || url.username || url.password) return false;
    if (isPortalUrl(url.href)) {
      for (const key of url.searchParams.keys()) {
        if (!['tabId', 'tab_tab_group_id'].includes(key) || url.searchParams.getAll(key).length !== 1 || !/^_\d+_\d+$/.test(url.searchParams.get(key)!)) return false;
      }
      return true;
    }
    if (url.pathname === myBlackboardPath) {
      for (const key of url.searchParams.keys()) if (!['cmd', 'toolId'].includes(key) || url.searchParams.getAll(key).length !== 1) return false;
      return url.searchParams.get('cmd') === 'display';
    }
    const courseId = url.searchParams.get('course_id') ?? '';
    if (url.pathname === ANNOUNCEMENT_PATH) {
      if (courseId && coursewareMenuUrl(courseId).href === url.href) return true;
      return Boolean(announcementUrl(url.href));
    }
    return Boolean(assignmentReadUrl(url.href, courseId));
  } catch { return false; }
}

/** 只认当前窗口仍在展示的学校顶层文档，避免选中后台旧标签页。 */
async function activeAnchorTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab?.id !== undefined && !tab.incognito && !tab.discarded && !tab.pendingUrl && isBrowseAnchorUrl(tab.url ?? '') ? tab : undefined;
}

/** 从同一顶层文档获取随机标识和页头姓名，不发网络请求，无法证明时按缓存未命中处理。 */
export async function readBrowseAnchor(): Promise<BrowseAnchor | undefined> {
  try {
    const tab = await activeAnchorTab();
    if (tab?.id === undefined) return undefined;
    const result: RuntimeResult<Omit<BrowseAnchor, 'tabId'> | undefined> = await chrome.tabs.sendMessage(tab.id, { type: 'read_browse_anchor' }, { frameId: 0 });
    if (!result?.ok || !result.data || typeof result.data.accountName !== 'string' || !result.data.accountName || !/^[0-9a-f-]{36}$/i.test(result.data.documentToken)) return undefined;
    const current = await activeAnchorTab();
    if (current?.id !== tab.id || current.url !== tab.url) return undefined;
    return { tabId: tab.id, documentToken: result.data.documentToken, accountName: result.data.accountName };
  } catch { return undefined; }
}

/** 只检查 Blackboard 已知认证路径，不读取查询参数、请求头或 Cookie。 */
function isAuthenticationUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.origin === BLACKBOARD_ORIGIN && /^\/webapps\/(?:login(?:\/|$)|bb-auth-provider-[^/]+(?:\/|$)|blackboard\/execute\/(?:login|logout)(?:\/|$))/i.test(url.pathname);
  } catch { return false; }
}

/** 监听现有浏览器事件，不请求页面；任一标签页的认证流程清除全局缓存。 */
export function watchBrowseSession(invalidate: (tabId?: number) => void): void {
  /** 已知认证请求可能改变整个浏览器的学校登录状态。 */
  function authenticationRequest(details: chrome.webRequest.OnBeforeRequestDetails): undefined {
    if (isAuthenticationUrl(details.url)) invalidate();
    return undefined;
  }
  chrome.webRequest.onBeforeRequest.addListener(authenticationRequest, {
    urls: [
      `${BLACKBOARD_ORIGIN}/webapps/login*`,
      `${BLACKBOARD_ORIGIN}/webapps/bb-auth-provider-*`,
      `${BLACKBOARD_ORIGIN}/webapps/blackboard/execute/login*`,
      `${BLACKBOARD_ORIGIN}/webapps/blackboard/execute/logout*`,
    ],
  });
  /** 认证地址变化清除全局缓存，普通导航和卸载仅影响对应文档。 */
  function tabUpdated(tabId: number, change: chrome.tabs.OnUpdatedInfo): void {
    if (change.url && isAuthenticationUrl(change.url)) invalidate();
    else if (change.url || change.status === 'loading' || change.discarded) invalidate(tabId);
  }
  chrome.tabs.onUpdated.addListener(tabUpdated);
  chrome.tabs.onRemoved.addListener(invalidate);
  /** 浏览器替换标签页时舍弃原页面对应的缓存。 */
  function tabReplaced(_newTabId: number, oldTabId: number): void { invalidate(oldTabId); }
  chrome.tabs.onReplaced.addListener(tabReplaced);
}
