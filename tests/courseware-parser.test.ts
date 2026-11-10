/** 文件用途：用虚构页面验证课件菜单、文件元信息和只读地址范围。 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseCoursewareListing, readCoursewareListing } from '../src/blackboard/courseware';
import { coursewareFileUrl, coursewarePageUrl } from '../src/blackboard/courseware-policy';
import { parseHtml } from '../src/blackboard/dom';
import type { Course } from '../src/shared/types';

const origin = 'https://bb.cuhk.edu.cn';
const course: Course = { courseId: '_700_1', code: 'ECE4016', title: 'Example', termId: '2610UG', termLabel: '2610UG', section: 'L01', announcementUrl: '' };
const rootUrl = coursewarePageUrl(course.courseId).href;
const folderUrl = `${origin}/webapps/blackboard/content/listContent.jsp?course_id=_700_1&content_id=_800_1`;
const childUrl = folderUrl.replace('_800_1', '_801_1');
const pdf = '/bbcswebdav/pid-810-dt-content-rid-910_1/xid-910_1';
const slides = '/bbcswebdav/courses/ECE4016/Week%2001.pptx';
const menu = `<ul id="courseMenuPalette_contents">
  <li><a href="${folderUrl}&amp;mode=reset">资料<span class="hideoff"> menu link</span></a></li>
  <li><a href="/webapps/blackboard/execute/announcement?course_id=_700_1">Announcements</a></li>
  <li><a href="${childUrl}">Tutorial 2</a></li>
  <li hidden><a href="${childUrl.replace('_801_1', '_802_1')}">Hidden</a></li>
  <li><a href="${folderUrl.replace('_700_1', '_799_1')}">Other course</a></li>
</ul>`;
const listing = `<div id="breadcrumbs"><a href="${rootUrl}">Example</a></div><ul id="content_listContainer">
  <li><div class="item"><h3><a href="${childUrl}">Lecture 讲座</a></h3></div></li>
  <li><h3><a href="${pdf}">Week 01.pdf</a></h3><ul class="attachments"><li><a href="${pdf}">Duplicate</a></li></ul></li>
  <li><h3>Slide handouts</h3><div class="details"><div class="vtbegenerated"><a href="${slides}">Week 01.pptx</a></div></div></li>
  <li><h3><a href="${origin}/webapps/assignment/uploadAssignment?course_id=_700_1">Assignment 1</a></h3><ul class="attachments"><li><a href="/bbcswebdav/xid-911_1">Assignment brief.pdf</a></li></ul></li>
  <li><img class="item_icon" alt="Test"><h3>Quiz</h3><div class="attachments"><a href="/bbcswebdav/xid-912_1">Quiz.pdf</a></div></li>
  <li><h3><a href="https://elsewhere.example/Week%2002.pdf">External PDF</a></h3></li>
  <li><h3><a href="/bbcswebdav/xid-913_1" aria-hidden="true">Hidden.pdf</a></h3></li>
</ul><a href="/bbcswebdav/xid-999_1">Unrelated file outside the course list</a>`;

/** 构造虚拟学校 HTML 响应，避免回归测试访问 Blackboard。 */
function htmlResponse(text: string): Response { return new Response(text, { headers: { 'content-type': 'text/html; charset=utf-8' } }); }

/** 恢复测试前的网络函数，避免各个虚构请求串在一起。 */
afterEach(() => vi.unstubAllGlobals());

describe('courseware metadata', () => {
  it('keeps the teacher menu labels and order and rejects hidden, unrelated, and foreign entries', () => {
    const result = parseCoursewareListing(parseHtml(menu), rootUrl, course);
    expect(result.items).toMatchObject([
      { kind: 'folder', name: '资料', url: folderUrl },
      { kind: 'folder', name: 'Tutorial 2', url: childUrl },
    ]);
    const fallbackMenu = menu.replace('id="courseMenuPalette_contents"', 'class="courseMenuPalette"');
    expect(parseCoursewareListing(parseHtml(fallbackMenu), rootUrl, course)).toEqual(result);
  });

  it('keeps nested folders and courseware in order and never lists files from assignments or tests', () => {
    expect(parseCoursewareListing(parseHtml(listing), folderUrl, course, folderUrl).items).toMatchObject([
      { kind: 'folder', name: 'Lecture 讲座', url: childUrl },
      { kind: 'file', name: 'Week 01.pdf', url: origin + pdf },
      { kind: 'file', name: 'Week 01.pptx', url: origin + slides },
    ]);
  });

  it('distinguishes an empty folder from unreadable, wrong-course, and wrong-folder pages', () => {
    expect(parseCoursewareListing(parseHtml('<ul id="content_listContainer"></ul>'), childUrl, course, childUrl)).toEqual({ items: [] });
    expect(() => parseCoursewareListing(parseHtml('<p>Unexpected page</p>'), folderUrl, course, folderUrl)).toThrow('未识别');
    expect(() => parseCoursewareListing(parseHtml(listing), childUrl, course, folderUrl)).toThrow('其他课件目录');
    expect(() => parseCoursewareListing(parseHtml(listing.replace(rootUrl, rootUrl.replace('_700_1', '_799_1'))), folderUrl, course, folderUrl)).toThrow('课程');
    expect(() => parseCoursewareListing(parseHtml('<form id="loginForm"><input type="password"></form>'), folderUrl, course, folderUrl)).toThrow('登录');
  });

  it('makes a single metadata request per level and does not fetch any visible files', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(htmlResponse(menu)).mockResolvedValueOnce(htmlResponse(listing));
    vi.stubGlobal('fetch', fetchMock);
    await readCoursewareListing(course);
    await readCoursewareListing(course, folderUrl);
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual([rootUrl, folderUrl]);
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: 'GET', credentials: 'same-origin', redirect: 'manual' });
  });

  it('rejects a redirect and never requests the destination', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: '/webapps/assessment/take' } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(readCoursewareListing(course, folderUrl)).rejects.toMatchObject({ code: 'courseware_redirect' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([pdf, slides, '/bbcswebdav/xid-912_1', '/bbcswebdav/pid-810-dt-content-rid-910_1/Lecture.ppt'])('allows the courseware file route %s', value => {
    expect(coursewareFileUrl(value).href).toBe(origin + value);
  });

  it.each([
    '/webapps/assignment/attachment.pdf', '/webapps/assessment/Test.pdf',
    'https://example.org/bbcswebdav/Slides.pdf', '/bbcswebdav/courses/ECE4016/',
    '/bbcswebdav/xid-912_1?action=delete', '/bbcswebdav/courses/ECE4016/a%2Fb.pdf',
    '/bbcswebdav/courses/ECE4016/a%252Fb.pdf', '/bbcswebdav/courses/ECE4016/Setup.exe',
  ])('rejects the unsafe or non-file route %s', value => {
    expect(() => coursewareFileUrl(value)).toThrow();
  });
});
