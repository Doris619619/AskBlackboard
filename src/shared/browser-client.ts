/** 文件用途：供侧栏调用后台只读采集和来源回跳，不向页面传递模型密钥。 */
import { AppError } from './errors';
import type { AnnouncementSnapshot, Course, CourseDiscovery, ExtensionMessage, RuntimeResult, SourceEvidence } from './types';

/** 发送一个受约束的扩展消息并将后台失败转换成业务错误。 */
async function request<T>(message: ExtensionMessage): Promise<T> {
  if (!globalThis.chrome?.runtime?.id) throw new AppError('extension_required', '请在浏览器加载扩展后使用课程读取功能。');
  const result: RuntimeResult<T> = await chrome.runtime.sendMessage(message);
  if (!result?.ok) throw new AppError(result?.error?.code ?? 'connection_failed', result?.error?.message ?? '扩展连接已断开，请重新打开侧栏。');
  return result.data;
}

/** 从当前学生登录的 Blackboard 页面发现课程和学期。 */
export function discoverCourses(): Promise<CourseDiscovery> { return request({ type: 'discover_courses' }); }
/** 实时读取指定课程全部可见公告，返回资料覆盖状态。 */
export function collectAnnouncements(course: Course): Promise<AnnouncementSnapshot> { return request({ type: 'collect_announcements', course }); }
/** 在 Blackboard 打开保存的来源并定位引用段落。 */
export function openSource(source: SourceEvidence, quote?: string): Promise<void> { return request({ type: 'open_source', source, quote }); }
