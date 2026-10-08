/** 文件用途：定义后台与 Blackboard 内容脚本之间的内部只读单页消息并校验发送者。 */
import type { Course, ExtensionMessage } from '../shared/types';

export type ContentMessage = ExtensionMessage | { type: 'read_announcement_page'; course: Course; url: string } | { type: 'read_discovery_page' };

/** 仅接受本扩展受信页面或 worker 发来的消息；网页中的内容脚本不能请求特权操作。 */
export function isTrustedExtensionSender(sender: chrome.runtime.MessageSender): boolean {
  if (sender.id !== chrome.runtime.id) return false;
  if (!sender.url) return !sender.tab;
  try { const url = new URL(sender.url); return url.protocol === 'chrome-extension:' && url.hostname === chrome.runtime.id; } catch { return false; }
}

/** 在运行时验证课程数据形状，避免将页面伪造的对象或任意地址交给采集器。 */
export function isCourse(value: unknown): value is Course {
  if (!value || typeof value !== 'object') return false;
  const course = value as Record<string, unknown>;
  for (const key of ['courseId', 'code', 'title', 'termId', 'termLabel', 'section', 'announcementUrl']) if (typeof course[key] !== 'string') return false;
  return /^_\d+_\d+$/.test(course.courseId as string) && (course.announcementUrl as string).length < 4096;
}
