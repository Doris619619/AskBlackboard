/** 文件用途：合并同一标签页正在进行的问答课程校验，每次校验结束后释放结果。 */
import type { CourseDiscovery } from '../shared/types';

const pending = new Map<number, Promise<CourseDiscovery>>();

/** 并行资料读取共用一次实时门户请求。成功或失败后，下一次调用都会重新读取。 */
export function shareCourseAuthorization(tabId: number, discover: (tabId: number) => Promise<CourseDiscovery>): Promise<CourseDiscovery> {
  const active = pending.get(tabId);
  if (active) return active;
  /** 校验结果只在当前请求未完成期间可复用。 */
  function forget() { pending.delete(tabId); }
  const request = discover(tabId).finally(forget);
  pending.set(tabId, request);
  return request;
}
