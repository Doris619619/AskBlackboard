/** 文件用途：生成课件界面的课程和文件标题，保留读取与保存所需的原始数据。 */
import { coursewareFileExtension } from '../blackboard/courseware-policy';
import { normalizeCourseCode } from '../blackboard/policy';
import type { CoursewareFile } from '../shared/courseware-types';
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

/** 用已知后缀补全标题。实际保存的后缀优先，已有的同格式后缀保留原大小写。 */
export function coursewareFileLabel(file: CoursewareFile, savedExtension?: string): string {
  const extension = savedExtension ?? file.extension;
  if (!extension) return file.name;
  const original = coursewareFileExtension(file.name);
  if (original === extension) return file.name;
  const name = file.name.trimEnd();
  return `${original ? name.slice(0, -original.length - 1) : name}.${extension}`;
}
