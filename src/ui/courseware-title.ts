/** 文件用途：生成课件侧栏的课程标题，保留选课与权限校验所需的原始数据。 */
import { normalizeCourseCode } from '../blackboard/policy';
import type { Course } from '../shared/types';

const coursePrefix = /^([A-Z]{2,8}[\s_-]*\d{3,5}[A-Z]?)(?=$|[\s:：_\-–—])/i;
const sectionSuffix = /_(?:(?:LAB|[LTPGD])\d{1,3}[A-Z]?_?)+$/i;

/** 只去掉开头重复的同一课程号和末尾的下划线教学班标签，保留其余原始课名。 */
export function coursewareTitle(course: Pick<Course, 'code' | 'title'>): string {
  const code = normalizeCourseCode(course.code);
  const title = course.title.trim().replace(sectionSuffix, '').trim();
  const prefix = coursePrefix.exec(title);
  const name = prefix && normalizeCourseCode(prefix[1]) === code
    ? title.slice(prefix[0].length).trim().replace(/^[:：_\-–—]\s*/, '')
    : title;
  return code && name ? `${code}: ${name}` : code || name;
}
