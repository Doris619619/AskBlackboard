/** 文件用途：验证课程简称优先级、班组和学期歧义，防止 GEB 问题使用 GED 公告。 */
import { describe, expect, it } from 'vitest';
import { defaultCourse, resolveCourse } from '../src/blackboard/course-resolution';
import type { Course, CourseDiscovery } from '../src/shared/types';

/** 创建不含真实学生资料的目录条目，参数覆盖教学班和历史学期边界。 */
function course(code: string, id: string, termId = '2610UG', section = 'L01'): Course {
  return { code, courseId: id, termId, termLabel: termId, section, title: `${code} Example`, announcementUrl: `https://bb.cuhk.edu.cn/webapps/blackboard/execute/announcement?method=search&context=mybb&searchSelect=${id}` };
}
const ged = course('GED2005', '_700_1');
const geb = course('GEB2509', '_702_1');
const discovery: CourseDiscovery = { courses: [ged, geb], currentTermId: '2610UG', accountName: 'Example' };

/** 使用实际问题与易混淆输入覆盖采集之前的确定性课程选择。 */
describe('question course routing', () => {
  it.each(['geb好像要做一个pre是啥时候', 'GEB 的 pre', 'geb2509的展示', 'GEB 2509 pre', 'GEB-2509 pre', 'GEB，GEB2509 的展示'])('routes %s to GEB despite selected GED', (question) => {
    expect(resolveCourse(question, discovery, ged.courseId, true)).toEqual(geb);
  });
  it('never guesses a default for a multiple-course account', () => {
    expect(defaultCourse(discovery)).toBe('');
    expect(defaultCourse({ ...discovery, courses: [geb] })).toBe(geb.courseId);
    expect(() => resolveCourse('pre 啥时候', discovery, '', false)).toThrow('课程号');
  });
  it('uses the current selection only when no course is named', () => {
    expect(resolveCourse('pre 和 quiz 安排', discovery, ged.courseId, true)).toEqual(ged);
    expect(resolveCourse('debuggeb 和 myGED2005test', discovery, ged.courseId, true)).toEqual(ged);
  });
  it('rejects multiple courses and unknown full codes without falling back', () => {
    expect(() => resolveCourse('GEB 和 GED 的 pre', discovery, ged.courseId, true)).toThrow('一门课程');
    expect(() => resolveCourse('GEB2509 和 GEB2510', discovery, ged.courseId, true)).toThrow('一门课程');
    expect(() => resolveCourse('GEB9999 的展示', discovery, ged.courseId, true)).toThrow('没有找到');
  });
  it('requires explicit selection for ambiguous prefixes or sections', () => {
    const more = { ...discovery, courses: [...discovery.courses, course('GEB2510', '_703_1')] };
    expect(() => resolveCourse('geb pre', more, ged.courseId, true)).toThrow('多门课程');
    expect(resolveCourse('geb pre', more, geb.courseId, true)).toEqual(geb);
    const sections = { ...discovery, courses: [...discovery.courses, course('GEB2509', '_704_1', '2610UG', 'L02')] };
    expect(() => resolveCourse('GEB2509 pre', sections, geb.courseId, false)).toThrow('教学班');
    expect(resolveCourse('GEB2509 pre', sections, geb.courseId, true)).toEqual(geb);
  });
  it('does not silently select a historical course', () => {
    const old = course('GEB2509', '_705_1', '2510UG');
    const history = { ...discovery, courses: [ged, old] };
    expect(() => resolveCourse('geb pre', history, ged.courseId, true)).toThrow('历史学期');
    expect(resolveCourse('geb pre', history, old.courseId, true)).toEqual(old);
  });
});
