/** 文件用途：并行读取同课程公告与作业说明，保留单路失败范围，不让空结果冒充完整检索。 */
import { collectAnnouncements, collectAssignments } from './browser-client';
import { AppError } from './errors';
import type { AnnouncementSnapshot, Course } from './types';

/** 合并两条只读路线；身份/课程/协议错误阻止回答，普通单路失败保留成功证据并标记不完整。 */
export async function collectDeadlineSources(course: Course, readers = [collectAnnouncements, collectAssignments]): Promise<AnnouncementSnapshot> {
  const results = await Promise.allSettled(readers.map(/** 两路读取互不依赖，均要求后台重新验证课程。 */ function read(reader) { return reader(course); }));
  const sources: AnnouncementSnapshot['sources'] = [];
  const warnings: string[] = [];
  let pagesRead = 0;
  let succeeded = 0;
  for (const [index, result] of results.entries()) {
    if (result.status === 'rejected') {
      const error = result.reason;
      if (error instanceof AppError && ['login_required', 'consent_required', 'course_changed', 'course_mismatch', 'unsafe_url', 'extension_reload_required'].includes(error.code)) throw error;
      warnings.push(`${index === 0 ? '课程公告' : '作业列表'}未读取成功，结果可能不完整。`);
      continue;
    }
    const snapshot = result.value;
    if (snapshot.course.courseId !== course.courseId || snapshot.sources.some(/** 所有证据都必须属于本轮课程。 */ function wrongCourse(source) { return source.courseId !== course.courseId; })) throw new AppError('course_mismatch', '读取资料与所选课程不一致。');
    succeeded += 1; pagesRead += snapshot.coverage.pagesRead;
    sources.push(...snapshot.sources); warnings.push(...snapshot.coverage.warnings);
    if (snapshot.coverage.status === 'partial' && !snapshot.coverage.warnings.length) warnings.push('部分资料没有读取完整。');
  }
  if (!succeeded) throw new AppError('read_failed', '公告和作业列表均未读取成功，不能判断截止安排。');
  return { course, scope: 'deadlines', sources, fetchedAt: new Date().toISOString(), coverage: { status: warnings.length ? 'partial' : 'complete', pagesRead, warnings } };
}
