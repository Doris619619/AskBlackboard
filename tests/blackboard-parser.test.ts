/** 文件用途：用无个人信息的代表性 DOM 验证学期目录、完整公告正文、课程范围与安全分页。 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Course } from '../src/shared/types';
import { parseAnnouncementPage } from '../src/blackboard/announcements';
import { parseCourseDiscovery } from '../src/blackboard/discovery';
import { parseHtml, plainText } from '../src/blackboard/dom';
import { announcementUrl, normalizeCourseCode, PORTAL_URL } from '../src/blackboard/policy';
import { isTrustedExtensionSender } from '../src/blackboard/messages';

const course: Course = { courseId: '_700_1', code: 'GED2005', title: 'GED2005 L01 Test Course', termId: '2610UG', termLabel: '2610UG', section: 'L01', announcementUrl: 'https://bb.cuhk.edu.cn/webapps/blackboard/execute/announcement?method=search&context=mybb&searchSelect=_700_1' };

/** 构建代表性公告条目，使用虚构 ID 和时间避免保存真实学生资料。 */
function item(id: string, title: string, body: string): string { return `<li id="${id}"><h3 class="item">${title}</h3><div class="details"><p><span>Posted on: Friday, October 2, 2026 8:00:00 AM CST</span></p><div class="vtbegenerated">${body}</div></div><div class="announcementInfo">Posted by: Example Instructor<br>Posted to: Example Course</div></li>`; }
/** 包装公告列表和选课筛选，用于验证服务器是否真的限定了课程。 */
function page(items: string, extra = ''): Document { return parseHtml(`<select id="searchSelectId"><option value="_700_1" selected>GED2005 L01</option></select><ul id="announcementList">${items}</ul>${extra}`); }

/** 恢复发送者验证所需的虚构 Chrome runtime，保证其他测试不受影响。 */
afterEach(() => { vi.unstubAllGlobals(); });

/** 定义课程目录和公告解析的输入输出契约，避免静默误读其他班组或截断正文。 */
describe('Blackboard DOM parsing', () => {
  /** 验证现实门户 h3 + 兄弟分组结构、前置空格 href、过去学期及两个班组被分别保留。 */
  it('discovers latest term, account display name and distinct sections from real-shaped course groups', () => {
    const document = parseHtml(`<a id="global-nav-link">Example Student<span class="hideoff"> Activity Updates</span><span class="badge">3</span></a><div id="My_Courses_Tools"><h3 class="termHeading-coursefakeclass"><a><span class="hideoff">Collapse </span>2510UG</a></h3><div><ul class="courseListing"><li><a href=" /webapps/blackboard/execute/launcher?type=Course&id=_600_1">GED2005 L01 Old Course</a></li></ul></div><h3 class="termHeading-coursefakeclass"><a id="afor_3_1termCourses__426_1"><span class="hideoff">Collapse </span>2610UG</a></h3><div id="_3_1termCourses__426_1"><h4>Student</h4><ul class="courseListing"><li><a href=" /webapps/blackboard/execute/launcher?type=Course&id=_700_1">GED2005 L01 Test Course</a><div class="courseDataBlock"><a href="/webapps/blackboard/execute/announcement?method=search&amp;context=mybb&amp;searchSelect=_700_1">Announcements</a></div></li><li><a href=" /webapps/blackboard/execute/launcher?type=Course&id=_701_1">GED 2005 L02 Other Section</a></li></ul></div></div>`);
    const result = parseCourseDiscovery(document, PORTAL_URL);
    expect(result.accountName).toBe('Example Student');
    expect(result.currentTermId).toBe('2610UG');
    expect(result.courses).toHaveLength(3);
    expect(result.courses[1]).toMatchObject({ code: 'GED2005', section: 'L01', termId: '2610UG', courseId: '_700_1' });
    expect(result.courses[2]).toMatchObject({ code: 'GED2005', section: 'L02', courseId: '_701_1' });
    expect(new URL(result.courses[2].announcementUrl).searchParams.get('searchSelect')).toBe('_701_1');
  });
  /** 防止课程代码归一化把空格和大小写当成不同课程编号。 */
  it('normalizes typed course codes', () => { expect(normalizeCourseCode('ged 2005')).toBe('GED2005'); });
  /** 无学期课程仍可选；无学期标题或没有有效课程的较新分组都不能覆盖真实当前学期。 */
  it('prefers the latest numbered term with readable courses over unassigned and empty terms', () => {
    const document = parseHtml(`<a id="global-nav-link">Example Student</a><a href="${course.announcementUrl}">Announcements</a><div id="My_Courses_Tools"><h3>No Term Assigned</h3><div><ul class="courseListing"><li><a href="/webapps/blackboard/execute/launcher?type=Course&id=_701_1">MAT1001 Unassigned</a></li></ul></div><h3>2710UG</h3><div><ul class="courseListing"></ul></div><h3>2610UG</h3><div><ul class="courseListing"><li><a href="/webapps/blackboard/execute/launcher?type=Course&id=_700_1">GED2005 L01 Test Course</a></li></ul></div></div>`);
    const result = parseCourseDiscovery(document, PORTAL_URL);
    expect(result.currentTermId).toBe('2610UG');
    expect(result.courses).toHaveLength(2);
    expect(result.courses[0].termId).toBe('No Term Assigned');
  });
  /** 学校导航姓名实际是 button；读取其显示文字，但不扩大通用正文读取对按钮/表单的权限。 */
  it('discovers the account label from a navigation button without reading form values', () => {
    const document = parseHtml(`<button id="global-nav-link"><img alt="avatar">Example Student<span class="hideoff">Activity Updates</span><span class="badge">16</span><input value="private"><script>private</script></button><div id="My_Courses_Tools"><h3>2610UG</h3><div><ul class="courseListing"><li><a href="/webapps/blackboard/execute/launcher?type=Course&id=_700_1">GED2005 L01 Test Course</a><a href="${course.announcementUrl}">Announcements</a></li></ul></div></div>`);
    expect(parseCourseDiscovery(document, PORTAL_URL).accountName).toBe('Example Student');
    expect(plainText(document.querySelector('#global-nav-link'))).toBe('');
  });
  /** Welcome 正文可能位于 MessageUniqueBody 外面，必须保留完整容器并排除发布人元信息。 */
  it('keeps text before MessageUniqueBody and nested paragraph boundaries', () => {
    const document = page(item('_901_1', 'Welcome and quiz schedule', '<p>Welcome to this course.</p><div id="Item.MessageUniqueBody"><p>Quiz 1 is on October 12.</p><div><p>The duration is 20 minutes.</p><ul><li>Bring a pencil.</li></ul></div></div>'));
    const result = parseAnnouncementPage(document, course.announcementUrl, course, '2026-10-08T10:00:00Z');
    expect(result.sources[0].body).toBe('Welcome to this course.\nQuiz 1 is on October 12.\nThe duration is 20 minutes.\nBring a pencil.');
    expect(result.sources[0].body).not.toContain('Example Instructor');
    expect(result.sources[0].publishedAt).toBe('Friday, October 2, 2026 8:00:00 AM CST');
    expect(result.sources[0].url.endsWith('#_901_1')).toBe(true);
    expect(result.sources[0].breadcrumb).toEqual(['Blackboard 首页', 'Announcements', 'GED2005 L01', 'Welcome and quiz schedule']);
  });
  /** 对真正显示另一门课的筛选页立即失败，不能混合正文作为所选课程证据。 */
  it('rejects a rendered filter belonging to another course', () => {
    const document = parseHtml('<select id="searchSelectId"><option value="_701_1" selected>L02</option></select><ul id="announcementList"></ul>');
    expect(() => parseAnnouncementPage(document, course.announcementUrl, course)).toThrow(/筛选/);
  });
  /** 只跟随已确认课程范围的 GET 公告分页，拒绝测验或其他教学班链接。 */
  it('discovers safe pagination and reports unsupported or wrong-course controls', () => {
    const next = `${course.announcementUrl}&startIndex=10`;
    const document = page(item('_901_1', 'Quiz', '<p>A quiz date.</p>'), `<div class="pagination"><a href="${next.replace(/&/g, '&amp;')}">2</a><a href="/webapps/assessment/take/launch.jsp?course_id=_700_1">Next</a><a href="javascript:void(0)">Next</a><a href="${course.announcementUrl.replace('_700_1', '_701_1')}">3</a></div>`);
    const result = parseAnnouncementPage(document, course.announcementUrl, course);
    expect(result.nextUrls).toEqual([next]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
  /** 空壳 200 响应、登录页面及不认识的结构均不能当作“没有公告”。 */
  it('distinguishes valid empty lists from login or unrecognized responses', () => {
    expect(parseAnnouncementPage(page(''), course.announcementUrl, course).sources).toEqual([]);
    expect(() => parseAnnouncementPage(parseHtml('<form id="loginForm"><input type="password"></form>'), course.announcementUrl, course)).toThrow(/登录/);
    expect(() => parseAnnouncementPage(parseHtml('<h1>Temporarily unavailable</h1>'), course.announcementUrl, course)).toThrow(/筛选|结构/);
    expect(() => parseHtml(' ')).toThrow(/空页面/);
  });
  /** 覆盖实际公告正文缺失时保留缺口，防止向 UI 宣称全部公告读完。 */
  it('reports a missing body instead of accepting an incomplete announcement', () => {
    const result = parseAnnouncementPage(page('<li id="_901_1"><h3>Quiz notice</h3></li>'), course.announcementUrl, course);
    expect(result.sources).toHaveLength(0);
    expect(result.warnings[0]).toContain('正文');
  });
  /** 拒绝同站写操作、任意参数与跨来源地址，即使它们使用 GET。 */
  it('rejects write actions, assignment endpoints and cross-origin sources', () => {
    for (const url of ['https://bb.cuhk.edu.cn/webapps/blackboard/execute/announcement?method=delete&searchSelect=_700_1', 'https://bb.cuhk.edu.cn/webapps/assignment/uploadAssignment?course_id=_700_1', 'https://bb.cuhk.edu.cn/webapps/blackboard/execute/announcement?method=search&searchSelect=_700_1&action=delete', 'https://example.org/webapps/blackboard/execute/announcement?searchSelect=_700_1']) expect(() => announcementUrl(url, '_700_1')).toThrow();
  });
  /** 保留英文段落及中文文本，读取过程中不能收集输入框或运行脚本。 */
  it('never reads form values or script contents into evidence', () => { expect(plainText(parseHtml('<p>Hello</p><p>中文</p><input value="private"><script>private</script>').body)).toBe('Hello\n中文'); });
  /** 缺少课程筛选状态的全局列表不能悄悄归到用户选择的课程。 */
  it('rejects global lists whose course filter cannot be verified', () => { expect(() => parseAnnouncementPage(parseHtml(`<ul id="announcementList">${item('_901_1', 'Quiz', '<p>Date.</p>')}</ul>`), course.announcementUrl, course)).toThrow(/筛选/); });
  /** 学校条款弹窗没有处理时不宣称公告读取已完成，也不代替学生点击同意。 */
  it('detects an active terms dialog even when announcements exist beneath it', () => { expect(() => parseAnnouncementPage(page(item('_901_1', 'Quiz', '<p>Date.</p>'), '<div role="dialog">Accept Privacy Terms and Agreement</div>'), course.announcementUrl, course)).toThrow(/条款/); });
  /** 具有同一扩展 ID 的页面内容脚本仍属于非受信输入，不能扩大扩展权限。 */
  it('accepts only trusted extension contexts, not content-script or foreign senders', () => {
    vi.stubGlobal('chrome', { runtime: { id: 'example-extension' } });
    expect(isTrustedExtensionSender({ id: 'example-extension', url: 'chrome-extension://example-extension/sidepanel.html' })).toBe(true);
    expect(isTrustedExtensionSender({ id: 'example-extension', url: 'chrome-extension://example-extension/sidepanel.html', tab: { id: 1 } as chrome.tabs.Tab })).toBe(true);
    expect(isTrustedExtensionSender({ id: 'example-extension' })).toBe(true);
    expect(isTrustedExtensionSender({ id: 'example-extension', url: course.announcementUrl, tab: { id: 1 } as chrome.tabs.Tab })).toBe(false);
    expect(isTrustedExtensionSender({ id: 'other-extension', url: 'chrome-extension://other-extension/sidepanel.html' })).toBe(false);
  });
});
