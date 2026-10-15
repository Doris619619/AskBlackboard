/** 文件用途：将问题中的课程号或已知课程简称解析为唯一课程，在采集前阻止串课与歧义。 */
import type { Course, CourseDiscovery } from '../shared/types';

/** 将课程号中的空格和连字符统一移除，允许大小写混写。 */
function normalizeCode(value: string): string { return value.replace(/[\s-]+/g, '').toUpperCase(); }

/** 只有当前学期唯一课程时才默认选择，不为多课程账号偏置到某一门课。 */
export function defaultCourse(discovery: CourseDiscovery): string {
  const current = discovery.courses.filter(/** 只考虑当前学期。 */ function isCurrent(course) { return course.termId === discovery.currentTermId; });
  return current.length === 1 ? current[0].courseId : '';
}

/** 显式课程号或已发现简称优先于下拉框；多课程、多班组或历史学期歧义必须先明确选择。 */
export function resolveCourse(question: string, discovery: CourseDiscovery, selectedId: string, manuallySelected: boolean): Course {
  const prefixes = new Set(discovery.courses.map(/** 从真实目录获得简称，不把 pre、quiz 等普通词当作课程。 */ function prefix(course) { return normalizeCode(course.code).match(/^[A-Z]+/)?.[0]; }));
  const mentions = new Set<string>();
  for (const match of question.matchAll(/(?<![a-z0-9])([a-z]{2,})(?:[\s-]*(\d{3,}))?(?![a-z0-9])/gi)) {
    const prefix = match[1].toUpperCase();
    if (match[2]) mentions.add(prefix + match[2]);
    else if (prefixes.has(prefix)) mentions.add(prefix);
  }
  // 同时说「GEB，GEB2509」属于一次明确指代；不同课程仍然拒绝混查。
  for (const mention of mentions) if (/^[A-Z]+$/.test(mention) && [...mentions].some(/** 完整编号优先于同系简称。 */ function hasFull(code) { return code !== mention && code.startsWith(mention) && /^\d/.test(code.slice(mention.length)); })) mentions.delete(mention);
  if (mentions.size > 1) throw new Error('请一次查询一门课程，避免混用不同课程的公告。');
  const requested = [...mentions][0];
  const selected = discovery.courses.find(/** 选择项按稳定课程 ID 匹配。 */ function isSelected(course) { return course.courseId === selectedId; });
  if (!requested) {
    if (selected) return selected;
    throw new Error('请在问题里写课程号（如 GEB2509），或先在顶部选择课程。');
  }
  const full = /\d/.test(requested);
  /** 完整课程号精确匹配，简称只匹配编号前缀，绝不进行 GEB/GED 模糊纠错。 */
  function matches(course: Course): boolean { const code = normalizeCode(course.code); return full ? code === requested : code.match(/^[A-Z]+/)?.[0] === requested; }
  const matching = discovery.courses.filter(matches);
  if (manuallySelected && selected && matches(selected)) return selected;
  const current = matching.filter(/** 优先当前学期，避免复用旧学期时间。 */ function isCurrent(course) { return course.termId === discovery.currentTermId; });
  if (matching.length && !current.length) throw new Error(`${requested} 仅发现历史学期课程，请先在顶部明确选择学期。`);
  if (current.length === 1) return current[0];
  if (!matching.length) throw new Error(`没有找到 ${requested}，请刷新课程列表或检查课程号。`);
  throw new Error(`${requested} 对应多门课程或教学班，请在顶部选择后再发送；不会使用其他课程的公告。`);
}
