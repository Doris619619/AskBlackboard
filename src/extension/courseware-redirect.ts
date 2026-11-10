/** 文件用途：读取 Blackboard 课件入口时，逐跳验证课程范围并拦住自动导航。 */
import { COURSEWARE_REDIRECT_MESSAGE, coursewareMenuUrl, coursewarePageUrl } from '../blackboard/courseware-policy';
import { AppError } from '../shared/errors';
import type { CoursewareListing } from '../shared/courseware-types';
import { RUNTIME_PROTOCOL } from '../shared/runtime-version';
import { coursewareUrlShape } from './courseware-diagnostics';

const maxRedirects = 3;

/** 只观察本轮课件 GET 的跳转地址，成功、失败或结束时都移除临时监听。 */
async function readCoursewareHop(tabId: number, target: URL, readPage: (url: string) => Promise<CoursewareListing>, diagnostic: string[]): Promise<CoursewareListing | string> {
  const destinations = new Set<string>();
  const statusCodes = new Set<number>();
  let otherContext = 0;
  /** 匹配指定标签页的同源顶层请求，不读取请求头或响应头。 */
  function record(details: chrome.webRequest.OnBeforeRedirectDetails): void {
    if (details.tabId !== tabId || details.method !== 'GET' || details.url !== target.href) return;
    if (details.frameId !== 0 || details.initiator !== target.origin) {
      otherContext += 1;
      return;
    }
    statusCodes.add(details.statusCode);
    destinations.add(details.redirectUrl);
  }
  const redirects = chrome.webRequest.onBeforeRedirect;
  redirects.addListener(record, { urls: [`${target.origin}${target.pathname}*`], types: ['xmlhttprequest'], tabId });
  try {
    return await readPage(target.href);
  } catch (error) {
    if (error instanceof AppError && error.code === 'courseware_redirect') {
      if (otherContext) diagnostic.push(`排除页面上下文不匹配的事件 ${otherContext} 次。`);
      if (destinations.size === 1) {
        diagnostic.push(`捕获跳转（HTTP ${[...statusCodes].join('、')}）。`);
        return destinations.values().next().value!;
      }
      diagnostic.push(destinations.size === 0 ? '未捕获跳转目标。' : `捕获 ${destinations.size} 个不同跳转目标。`);
    }
    throw error;
  } finally {
    redirects.removeListener(record);
  }
}

/** 读取指定路线的同课程页面，逐跳校验并记录循环、限制及被拒绝的目标。 */
async function readCoursewareRoute(tabId: number, courseId: string, folderUrl: string | undefined, initial: URL, readPage: (url: string) => Promise<CoursewareListing>, diagnostic: string[]): Promise<CoursewareListing> {
  const visited = new Set<string>();
  let target = initial;
  for (let hop = 0; hop <= maxRedirects && !visited.has(target.href); hop += 1) {
    visited.add(target.href);
    diagnostic.push(`第 ${hop + 1} 次读取：${coursewareUrlShape(target.href, courseId)}`);
    const result = await readCoursewareHop(tabId, target, readPage, diagnostic);
    if (typeof result !== 'string') return result;
    diagnostic.push(`跳转目标：${coursewareUrlShape(result, courseId)}`);
    try {
      target = coursewarePageUrl(courseId, folderUrl, result);
    } catch (error) {
      diagnostic.push(`目标未通过校验${error instanceof AppError ? `（${error.code}）` : ''}。`);
      throw new AppError('courseware_redirect', COURSEWARE_REDIRECT_MESSAGE);
    }
  }
  diagnostic.push(visited.has(target.href) ? '跳转回到已访问的页面。' : '跳转次数超过限制。');
  throw new AppError('courseware_redirect', COURSEWARE_REDIRECT_MESSAGE);
}

/** 课程根先读取同课程公告页的教师菜单，页面不可用时再核对课程入口跳转。 */
export async function readCoursewareWithRedirects(tabId: number, courseId: string, folderUrl: string | undefined, readPage: (url: string) => Promise<CoursewareListing>): Promise<CoursewareListing> {
  const diagnostic = [`AskBlackboard 课件读取诊断（协议 ${RUNTIME_PROTOCOL}）`, folderUrl === undefined ? '范围：课程根目录' : '范围：课件子目录'];
  try {
    if (folderUrl === undefined) {
      try {
        return await readCoursewareRoute(tabId, courseId, undefined, coursewareMenuUrl(courseId), readPage, diagnostic);
      } catch (error) {
        if (!(error instanceof AppError) || !['unsupported_page', 'transport_error', 'courseware_redirect'].includes(error.code)) throw error;
        diagnostic.push(`公告页菜单读取失败（${error.code}），改读课程入口。`);
      }
    }
    return await readCoursewareRoute(tabId, courseId, folderUrl, coursewarePageUrl(courseId, folderUrl), readPage, diagnostic);
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    diagnostic.push(`结果：${error.code}`);
    throw new AppError(error.code, error.message, diagnostic.join('\n'));
  }
}
