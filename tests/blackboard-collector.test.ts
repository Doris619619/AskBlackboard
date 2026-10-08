/** 文件用途：验证同源凭据传输、公告分页合并和 HTTP 200 登录/空白响应失败，不发送真实网络请求。 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Course } from '../src/shared/types';
import { fetchSchoolDocument, readCourseAnnouncements } from '../src/blackboard/collector';

const course: Course = { courseId: '_700_1', code: 'GED2005', title: 'Example Course', termId: '2610UG', termLabel: '2610UG', section: 'L01', announcementUrl: 'https://bb.cuhk.edu.cn/webapps/blackboard/execute/announcement?method=search&context=mybb&searchSelect=_700_1' };

/** 建立有明确课程筛选的模拟学校 HTML 响应；不包含密钥或真实个人资料。 */
function htmlResponse(body: string): Response { return new Response(`<select id="searchSelectId"><option value="_700_1" selected>Example</option></select>${body}`, { headers: { 'content-type': 'text/html' } }); }
/** 为模拟公告赋予稳定不同 ID，供分页去重验证。 */
function announcement(id: string): string { return `<li id="${id}"><h3>Example notice</h3><div class="vtbegenerated"><p>Quiz information.</p></div></li>`; }

/** 恢复模拟网络，保证测试不会污染其他模块或使用真实学校连接。 */
afterEach(() => { vi.unstubAllGlobals(); });

/** 验证采集器不把网络成功与数据完整性混为一谈。 */
describe('Blackboard same-origin collection', () => {
  /** 浏览器以同源模式自动携带会话，代码不读取 Cookie 或添加学校认证头。 */
  it('uses controlled GET and same-origin browser credentials without explicit cookies', async () => {
    const fetchMock = vi.fn().mockResolvedValue(htmlResponse('<ul id="announcementList"></ul>'));
    vi.stubGlobal('fetch', fetchMock);
    await fetchSchoolDocument(course.announcementUrl, course.courseId);
    const options = fetchMock.mock.calls[0][1];
    expect(options).toMatchObject({ method: 'GET', credentials: 'same-origin', cache: 'no-store' });
    expect(options.headers).toBeUndefined();
    expect(fetchMock.mock.calls[0][0]).toBe(course.announcementUrl);
  });
  /** 两页公告出现同一 ID 时只保留一份；覆盖统计反映实际成功页面数。 */
  it('reads safe pagination and deduplicates the same announcement', async () => {
    const next = `${course.announcementUrl}&startIndex=10`;
    const first = htmlResponse(`<ul id="announcementList">${announcement('_901_1')}</ul><a rel="next" href="${next.replace(/&/g, '&amp;')}">Next</a>`);
    const second = htmlResponse(`<ul id="announcementList">${announcement('_901_1')}${announcement('_902_1')}</ul>`);
    const fetchMock = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    vi.stubGlobal('fetch', fetchMock);
    const snapshot = await readCourseAnnouncements(course);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(snapshot.sources).toHaveLength(2);
    expect(snapshot.coverage).toEqual({ status: 'complete', pagesRead: 2, warnings: [] });
  });
  /** 第二页网络失败仍返回已成功公告，但覆盖状态必须为 partial。 */
  it('marks a failed subsequent page as partial', async () => {
    const next = `${course.announcementUrl}&startIndex=10`;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(htmlResponse(`<ul id="announcementList">${announcement('_901_1')}</ul><a rel="next" href="${next.replace(/&/g, '&amp;')}">Next</a>`)).mockRejectedValueOnce(new Error('offline')));
    const snapshot = await readCourseAnnouncements(course);
    expect(snapshot.sources).toHaveLength(1);
    expect(snapshot.coverage.status).toBe('partial');
    expect(snapshot.coverage.pagesRead).toBe(1);
  });
  /** 学校以 200 返回登录表单不能成为“没有公告”的模型证据。 */
  it('rejects a 200 login response and does not return a stale partial result', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<form id="loginForm"><input type="password"></form>', { status: 200, headers: { 'content-type': 'text/html' } })));
    await expect(readCourseAnnouncements(course)).rejects.toMatchObject({ code: 'login_required' });
  });
  /** 网络返回空白 HTML 时拒绝报完整读取。 */
  it('rejects empty 200 pages', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 200, headers: { 'content-type': 'text/html' } })));
    await expect(readCourseAnnouncements(course)).rejects.toMatchObject({ code: 'unsupported_page' });
  });
  /** 认证跳转的响应不能被解析为课程资料，也不能要求读取跨站 Cookie。 */
  it('reports authentication redirect as login required', async () => {
    const response = htmlResponse('<p>Sign in</p>');
    Object.defineProperty(response, 'url', { value: 'https://login.example.edu/sso' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    await expect(readCourseAnnouncements(course)).rejects.toMatchObject({ code: 'login_required' });
  });
});
