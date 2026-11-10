/** 文件用途：供侧栏调用后台只读采集、课件下载前的课程校验和来源回跳。 */
import { AppError } from './errors';
import { RUNTIME_PROTOCOL, RELOAD_REQUIRED_MESSAGE } from './runtime-version';
import type { AnnouncementSnapshot, Course, CourseBrowseSnapshot, ExtensionMessage, RuntimeResult, SourceEvidence } from './types';
import type { CoursewareFolder, CoursewareListing } from './courseware-types';

/** 发送一个受约束的扩展消息并将后台失败转换成业务错误。 */
async function request<T>(message: ExtensionMessage): Promise<T> {
  if (!globalThis.chrome?.runtime?.id) throw new AppError('extension_required', '请在浏览器加载扩展后使用课程读取功能。');
  // 不缓存握手结果：打开侧栏后重新构建或更新后台时也要发现版本错配。
  const runtime: RuntimeResult<{ protocol: number }> = await chrome.runtime.sendMessage({ type: 'ping' });
  if (!runtime?.ok || runtime.data?.protocol !== RUNTIME_PROTOCOL) throw new AppError('extension_reload_required', RELOAD_REQUIRED_MESSAGE);
  const result: RuntimeResult<T> = await chrome.runtime.sendMessage(message);
  if (result?.ok === false && result.error.code === 'invalid_message') throw new AppError('extension_reload_required', RELOAD_REQUIRED_MESSAGE);
  if (!result?.ok) throw new AppError(result?.error?.code ?? 'connection_failed', result?.error?.message ?? '扩展连接已断开，请重新打开侧栏。', result?.error?.diagnostic);
  return result.data;
}

/** 用户主动点击后重新加载本扩展；不清除受信设置，但浏览器会关闭当前侧栏。 */
export function reloadExtension(): void { chrome.runtime.reload(); }

/** 从当前学生登录的 Blackboard 页面发现课程和学期。 */
export function discoverCourses(): Promise<CourseBrowseSnapshot> { return request({ type: 'discover_courses' }); }
/** 从已核对的原学校页面取仍可展示的课程快照。 */
export function readCachedCourses(): Promise<CourseBrowseSnapshot | null> { return request({ type: 'read_cached_courses' }); }
/** 实时读取指定课程全部可见公告，返回资料覆盖状态。 */
export function collectAnnouncements(course: Course): Promise<AnnouncementSnapshot> { return request({ type: 'collect_announcements', course }); }
/** 读取指定课程的只读内容列表与作业说明，不访问提交入口。 */
export function collectAssignments(course: Course): Promise<AnnouncementSnapshot> { return request({ type: 'collect_assignments', course }); }
/** 读取一层课件目录；未指定文件夹时只读取课程左侧菜单。 */
export function collectCourseware(course: Course, folder?: CoursewareFolder, cacheScope?: string): Promise<CoursewareListing> {
  return request({ type: 'collect_courseware', course, folderUrl: folder?.url, cacheScope });
}
/** 读取同一浏览范围中已访问的目录。未命中时由实时请求填充。 */
export function readCachedCourseware(course: Course, folder: CoursewareFolder | undefined, cacheScope: string): Promise<CoursewareListing | null> {
  return request({ type: 'read_cached_courseware', course, folderUrl: folder?.url, cacheScope });
}
/** 成功保存后为当前会话中的该文件保存后缀提示。 */
export function rememberCoursewareFormat(course: Course, fileUrl: string, extension: string, cacheScope: string): Promise<void> {
  return request({ type: 'remember_courseware_format', course, fileUrl, extension, cacheScope });
}
/** 保存前实时确认课程权限，并提供仍连接的学校标签页用于同源读取。 */
export function validateCoursewareDownload(course: Course, cacheScope?: string): Promise<number | undefined> {
  return request({ type: 'validate_courseware_download', course, cacheScope });
}
/** 在 Blackboard 打开保存的来源并定位引用段落。 */
export function openSource(source: SourceEvidence, quote?: string): Promise<void> { return request({ type: 'open_source', source, quote }); }
