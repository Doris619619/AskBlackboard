/** 文件用途：读取 Blackboard 课件入口时，逐跳验证课程范围并拦住自动导航。 */
import { COURSEWARE_REDIRECT_MESSAGE, coursewarePageUrl } from '../blackboard/courseware-policy';
import { AppError } from '../shared/errors';
import type { CoursewareListing } from '../shared/courseware-types';

const maxRedirects = 3;

/** 只观察本轮课件 GET 的跳转地址，成功、失败或结束时都移除临时监听。 */
async function readCoursewareHop(tabId: number, target: URL, readPage: (url: string) => Promise<CoursewareListing>): Promise<CoursewareListing | string> {
  const destinations = new Set<string>();
  /** 匹配指定标签页的同源顶层请求，不读取请求头或响应头。 */
  function record(details: chrome.webRequest.OnBeforeRedirectDetails): void {
    if (details.tabId === tabId && details.frameId === 0 && details.initiator === target.origin && details.method === 'GET' && details.url === target.href) {
      destinations.add(details.redirectUrl);
    }
  }
  const redirects = chrome.webRequest.onBeforeRedirect;
  redirects.addListener(record, { urls: [`${target.origin}${target.pathname}*`], types: ['xmlhttprequest'], tabId });
  try {
    return await readPage(target.href);
  } catch (error) {
    if (error instanceof AppError && error.code === 'courseware_redirect' && destinations.size === 1) {
      return destinations.values().next().value!;
    }
    throw error;
  } finally {
    redirects.removeListener(record);
  }
}

/** 跟进已核对的同课程只读跳转，拒绝其他地址、目录变化和循环。 */
export async function readCoursewareWithRedirects(tabId: number, courseId: string, folderUrl: string | undefined, readPage: (url: string) => Promise<CoursewareListing>): Promise<CoursewareListing> {
  const visited = new Set<string>();
  let target = coursewarePageUrl(courseId, folderUrl);
  for (let hop = 0; hop <= maxRedirects && !visited.has(target.href); hop += 1) {
    visited.add(target.href);
    const result = await readCoursewareHop(tabId, target, readPage);
    if (typeof result !== 'string') return result;
    try {
      target = coursewarePageUrl(courseId, folderUrl, result);
    } catch {
      throw new AppError('courseware_redirect', COURSEWARE_REDIRECT_MESSAGE);
    }
  }
  throw new AppError('courseware_redirect', COURSEWARE_REDIRECT_MESSAGE);
}
