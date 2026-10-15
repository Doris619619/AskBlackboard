/** 文件用途：使用虚构课程验证只读作业遍历、截止字段、覆盖范围与不依赖模型的直接回答。 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assignmentEntry, assignmentReadUrl } from '../src/blackboard/assignment-policy';
import { parseAssignmentPage, readCourseAssignments } from '../src/blackboard/assignments';
import { answerAssignmentDeadlines, isAssignmentDeadlineQuestion } from '../src/blackboard/deadlines';
import { parseHtml } from '../src/blackboard/dom';
import type { Course } from '../src/shared/types';

const course: Course = { courseId: '_700_1', code: 'ECE4016', title: 'Example', termId: '2610UG', termLabel: '2610UG', section: 'L01', announcementUrl: 'https://bb.cuhk.edu.cn/webapps/blackboard/execute/announcement?searchSelect=_700_1' };
const folder = 'https://bb.cuhk.edu.cn/webapps/blackboard/content/listContent.jsp?course_id=_700_1&content_id=_800_1';
const body = 'The deadline is 21:30, 22 Nov 2026. Late submissions are not accepted.';
/** 构造代表性的列表作业，提交链接存在但绝不跟随；不是用户学校资料。 */
function item(id = '_801_1', text = body, title = 'Assignment1'): string { return `<li id="contentListItem:${id}"><img class="item_icon" alt="Assignment"><div class="item" id="${id}"><h3><a href="/webapps/assignment/uploadAssignment?course_id=_700_1&content_id=${id}">${title}</a></h3></div><div class="details"><div class="vtbegenerated">${text}</div></div></li>`; }
/** 包装内容列表及校验课程的面包屑。 */
function page(items: string) { return parseHtml(`<div id="breadcrumbs"><a href="/webapps/blackboard/execute/courseMain?course_id=_700_1">Example</a></div><h1 id="pageTitleHeader">Assignments</h1><ul id="content_listContainer">${items}</ul>`); }
/** 清理模拟网络，防止访问真实学校。 */
afterEach(() => vi.unstubAllGlobals());

describe('assignment metadata', () => {
  it('extracts visible instructions and links back to the folder instead of upload', () => {
    const parsed = parseAssignmentPage(page(item()), folder, course);
    expect(parsed.sources[0]).toMatchObject({ kind: 'assignment', sourceId: 'assignment:_801_1', body, url: folder, anchorId: '_801_1' });
    expect(parsed.nextUrls).toEqual([]);
    expect(parsed.warnings).toEqual([]);
  });
  it('reads Due Date fields and never follows assessment or attachment links', () => {
    const doc = page(item('_801_1', '') + '<li id="contentListItem:_802_1"><img class="item_icon" alt="Test"><h3><a href="/webapps/assessment/take?course_id=_700_1">Assignment test</a></h3></li>');
    doc.querySelector('.details')!.insertAdjacentHTML('beforeend', '<div class="contextItemDetailsHeaders"><div class="detailsLabel">Due Date:</div><div class="detailsValue">November 22, 2026 9:30 PM</div></div>');
    const parsed = parseAssignmentPage(doc, folder, course);
    expect(parsed.sources).toHaveLength(1);
    expect(parsed.sources[0].body).toContain('November 22');
    const answer = answerAssignmentDeadlines('作业截止时间', { course, sources: parsed.sources, fetchedAt: '', coverage: { status: 'complete', pagesRead: 1, warnings: [] } });
    expect(answer.citations[0].quote).toContain('November 22, 2026 9:30 PM');
    expect(parsed.nextUrls).toEqual([]);
  });
  it('treats Assignment folders as navigation, not phantom assignments', () => {
    const parsed = parseAssignmentPage(page(`<li id="contentListItem:_800_1"><img class="item_icon" alt="Content Folder"><h3><a href="${folder}">Assignment</a></h3></li>`), assignmentEntry(course.courseId), course);
    expect(parsed.sources).toEqual([]);
    expect(parsed.nextUrls).toEqual([folder]);
    expect(parsed.warnings).toEqual([]);
  });
  it('rejects login, wrong course and unrecognized pages', () => {
    expect(() => parseAssignmentPage(parseHtml('<form id="loginForm"><input type="password"></form>'), folder, course)).toThrow('登录');
    expect(() => parseAssignmentPage(page(item()), folder.replace('_700_1', '_999_1'), course)).toThrow('课程');
    expect(() => parseAssignmentPage(parseHtml('<p>Server error</p>'), folder, course)).toThrow('未识别');
    const doc = page(item()); doc.querySelector('#breadcrumbs a')!.setAttribute('href','/webapps/blackboard/execute/courseMain?course_id=_999_1');
    expect(() => parseAssignmentPage(doc, folder, course)).toThrow('课程');
  });
  it.each(['/webapps/assignment/uploadAssignment?course_id=_700_1', '/webapps/assessment/take?course_id=_700_1', '/bbcswebdav/a.pdf?course_id=_700_1', `${folder}&mode=edit`, `${folder}&course_id=_999_1`, `${folder}&action=delete`, folder.replace('bb.cuhk.edu.cn','example.org')])('rejects unsafe route %s', value => {
    expect(() => assignmentReadUrl(value, course.courseId)).toThrow();
  });
  it('traverses folders once without ever requesting upload links', async () => {
    const root = `<ul id="courseMenuPalette_contents"><li><a href="${folder}">Content</a></li></ul>`;
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(root, { headers: { 'content-type': 'text/html' } })).mockResolvedValueOnce(new Response(page(item()).documentElement.outerHTML, { headers: { 'content-type': 'text/html' } }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await readCourseAssignments(course);
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual([assignmentEntry(course.courseId), folder]);
    expect(result.coverage).toMatchObject({ status: 'complete', pagesRead: 2 });
    expect(result.sources).toHaveLength(1);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'GET', credentials: 'same-origin' });
  });
  it('reports failed folders as partial and does not convert them to no assignments', async () => {
    const root = `<ul id="courseMenuPalette_contents"><li><a href="${folder}">Content</a></li></ul>`;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(root, { headers: { 'content-type': 'text/html' } })).mockRejectedValue(new Error('offline')));
    const result = await readCourseAssignments(course);
    expect(result.coverage).toMatchObject({ status: 'partial', pagesRead: 1 });
    expect(answerAssignmentDeadlines('作业截止时间', result).answer).toContain('未读全');
  });
  it('answers a specific deadline without guessing latest publication or another assignment', async () => {
    const parsed = parseAssignmentPage(page(item() + item('_802_1', 'Deadline: November 25, 2026.', 'Assignment2')), folder, course);
    const data = { course, scope: 'assignments' as const, sources: parsed.sources, fetchedAt: '', coverage: { status: 'complete' as const, pagesRead: 1, warnings: [] } };
    const result = answerAssignmentDeadlines('ECE4016最新作业啥时候截止', data);
    expect(result.mode).toBe('extracted'); expect(result.answer).toContain('无法确认'); expect(result.citations).toHaveLength(2);
    expect(answerAssignmentDeadlines('Assignment1 due date', data).answer).not.toContain('November 25');
    expect(answerAssignmentDeadlines('Assignment3 deadline', data).status).toBe('not_found');
  });
  it('routes deadline intent only and reports missing fields without inventing time', () => {
    expect(isAssignmentDeadlineQuestion('ece4016最新的作业在啥时候截止')).toBe(true);
    expect(isAssignmentDeadlineQuestion('when is homework due')).toBe(true);
    expect(isAssignmentDeadlineQuestion('GEB pre啥时候')).toBe(false);
    expect(isAssignmentDeadlineQuestion('作业怎么做')).toBe(false);
    const parsed = parseAssignmentPage(page(item('_801_1','Read the attached PDF.')), folder, course);
    const result = answerAssignmentDeadlines('作业截止时间', { course, sources: parsed.sources, fetchedAt: '', coverage: { status: 'complete', pagesRead: 1, warnings: [] } });
    expect(result.status).toBe('not_found'); expect(result.answer).toContain('未识别到明确');
  });
});
