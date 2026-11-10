/** 文件用途：用隔离浏览器和虚构课程验证课件缓存速度、刷新和登录边界。 */
import assert from 'node:assert/strict';
import { alternateCoursewareLanding, lectureBytes, portalUrl } from '../tests/browser/fixtures.mjs';

const origin = new URL(portalUrl).origin;
const schoolUrl = new URL('/webapps/bb-social-learning-BBLEARN/execute/mybb?cmd=display', origin).href;
const logoutUrl = new URL('/webapps/login/?action=logout', origin).href;
const menuUrl = new URL(alternateCoursewareLanding, origin).href;
const folderPath = '/webapps/blackboard/content/listContent.jsp?course_id=_706_1&content_id=_963_1';
const folderUrl = new URL(folderPath, origin).href;
const originalCourse = 'ECE3060: Cache Original Course';
const refreshedCourse = 'ECE3060: Cache Updated Course';
const manualCourse = 'ECE3060: Cache Manual Course';
const secondAccountCourse = 'ECE3060: Cache Other Account Course';
const originalFile = 'Original Lesson';
const confirmedFile = `${originalFile}.pdf`;
const refreshedFile = 'Updated Lesson.pdf';
const manualFile = 'Manual Refresh Lesson.pdf';
const lateFile = 'Late Previous Account Lesson.pdf';
const secondAccountFile = 'Other Account Lesson';
const loginPage = '<html><head><title>Login</title></head><body><form id="loginForm"><input type="password"></form></body></html>';
const accountHeader = '<button id="global-nav-link">Example Student</button><a id="topframe.logout.label" href="/webapps/login/?action=logout">Logout</a>';

/** 同名账号和同一课程编号仍可能显示不同课程，不能仅靠姓名或课程编号复用。 */
function portalPage(title) {
  return `<html><body>${accountHeader}<div id="My_Courses_Tools"><h3>2610UG</h3><div><ul class="courseListing"><li><a href="/webapps/blackboard/execute/launcher?type=Course&amp;id=_706_1">${title}_L01</a><a href="/webapps/blackboard/execute/announcement?method=search&amp;context=mybb&amp;searchSelect=_706_1">Announcements</a></li></ul></div></div></body></html>`;
}

/** 让请求抵达后等待测试主动释放，用因果顺序验证界面没有等网络。 */
function requestGate() {
  const entered = Promise.withResolvers();
  const released = Promise.withResolvers();
  return { entered: entered.promise, enter: entered.resolve, pending: released.promise, release: released.resolve };
}

/** 等待指定请求进入挂起状态，回归失败时及时退出并释放离线路由。 */
async function waitForHeldRequest(gate, description) {
  const timedOut = Promise.withResolvers();
  const timer = setTimeout(/** 标明预期出现却没有发送的请求。 */ function fail() {
    timedOut.reject(new Error(description));
  }, 8000);
  try { await Promise.race([gate.entered, timedOut.promise]); }
  finally { clearTimeout(timer); }
}

/** 使用真实扩展页面验证同一学校标签页内的缓存，以及重新登录后的隔离。 */
export async function runCourseCacheSmoke(context, school, panelUrl, passed) {
  let panel;
  let title = originalCourse;
  let file = originalFile;
  let signedIn = true;
  let portalGate;
  let folderGate;
  const fileRequests = [];
  const gates = [];

  /** 由当前场景决定侧栏直读和临时门户读到的结果。 */
  async function servePortal(route) {
    const body = signedIn ? portalPage(title) : loginPage;
    const held = portalGate;
    if (held) { held.enter(); await held.pending; }
    await route.fulfill({ contentType: 'text/html', body }).catch(/** 登录导航可能已中止旧文档的请求。 */ function ignoreClosedRequest() {});
  }

  /** 首页只给出账号导航，课程及文件仍需从获准的页面读取。 */
  function serveSchool(route) {
    return route.fulfill({ contentType: 'text/html', body: signedIn ? `<html><body>${accountHeader}<p>My Blackboard</p></body></html>` : loginPage });
  }

  /** 退出使用与学校导航一致的路由，避免靠不同姓名证明账号隔离。 */
  function serveLogout(route) { return route.fulfill({ contentType: 'text/html', body: loginPage }); }

  /** 提供该课程唯一的课件栏目。 */
  function serveMenu(route) {
    return route.fulfill({ contentType: 'text/html', body: `<div id="breadcrumbs"><a href="/webapps/blackboard/execute/courseMain?course_id=_706_1">Cache Course</a></div><ul id="courseMenuPalette_contents"><li><a href="${folderPath.replace('&', '&amp;')}">Content</a></li></ul>` });
  }

  /** 对已进入的请求保留当时快照，刷新可以验证服务端确实返回了新版。 */
  async function serveFolder(route) {
    const body = `<div id="breadcrumbs"><a href="/webapps/blackboard/execute/courseMain?course_id=_706_1">Cache Course</a></div><ul id="content_listContainer"><li><h3><a href="/bbcswebdav/xid-9910_1">${file}</a></h3></li></ul>`;
    const held = folderGate;
    if (held) { held.enter(); await held.pending; }
    await route.fulfill({ contentType: 'text/html', body }).catch(/** 允许切换账号时关闭旧请求。 */ function ignoreClosedRequest() {});
  }

  /** 只给已选课件的 GET 返回虚构 PDF，并记录浏览缓存时是否发出了额外请求。 */
  function serveSelectedFile(route) {
    const method = route.request().method();
    fileRequests.push(method);
    if (method !== 'GET') return route.abort();
    return route.fulfill({ contentType: 'application/pdf', headers: { 'Content-Disposition': `attachment; filename="${confirmedFile}"` }, body: lectureBytes });
  }

  /** 记录本轮挂起请求，失败也能释放，避免浏览器遗留离线请求。 */
  function hold() { const gate = requestGate(); gates.push(gate); return gate; }

  /** 以新侧栏文档重新运行真实扩展的启动流程。 */
  async function reopen() {
    await panel?.close();
    panel = await context.newPage();
    /** 记录已渲染的课件文字，能发现账号切换时短暂闪现的旧数据。 */
    await panel.addInitScript(function watchCourseware() {
      const shown = new Set();
      window.cacheFixtureShown = shown;
      const observer = new MutationObserver(/** 仅记录侧栏课件区域实际渲染的文字。 */ function captureCourseware() {
        const text = document.querySelector('[aria-label="课件工作区"]')?.textContent;
        if (text) shown.add(text);
      });
      observer.observe(document, { childList: true, subtree: true, characterData: true });
    });
    await school.bringToFront();
    await panel.goto(panelUrl);
    await panel.getByRole('button', { name: '课件', exact: true }).click();
  }

  /** 根据课程名获取课程列表项，避免把目录标题当成列表出现。 */
  function course(name) { return panel.getByRole('button', { name, exact: true }); }

  /** 用可见的文件复选框验证目录内容，而非检查扩展存储内部实现。 */
  function material(name) { return panel.getByRole('checkbox', { name, exact: true }); }

  /** 核对账号边界期间，即便只显示一个渲染周期也算旧内容外泄。 */
  function displayed(markers) {
    return panel.evaluate(/** 查询本轮侧栏记录的渲染内容。 */ function sawOldAccount(labels) {
      return [...window.cacheFixtureShown].some(/** 搜索旧账号标记。 */ function match(text) { return labels.some(/** 核对每个曾出现的片段。 */ function has(label) { return text.includes(label); }); });
    }, markers);
  }

  /** 从课件索引进入当前课程的 Content 栏目。 */
  async function openFolder(name) {
    await course(name).click();
    await panel.getByRole('button', { name: 'Content', exact: true }).click();
  }

  const routes = [[portalUrl, servePortal], [schoolUrl, serveSchool], [logoutUrl, serveLogout], [menuUrl, serveMenu], [folderUrl, serveFolder], ['**/bbcswebdav/xid-9910_1', serveSelectedFile]];
  for (const [url, handler] of routes) await context.route(url, handler);
  try {
    await school.goto(schoolUrl);
    await reopen();
    await openFolder(originalCourse);
    await material(originalFile).waitFor();
    assert.deepEqual(fileRequests, []);
    await panel.evaluate(/** 选择浏览器私有目录，走实际扩展下载流程而不写入个人文件夹。 */ function usePrivateDirectory() {
      window.showDirectoryPicker = navigator.storage.getDirectory.bind(navigator.storage);
    });
    await material(originalFile).check();
    await panel.getByRole('button', { name: '下载 1 个文件', exact: true }).click();
    await panel.getByRole('status').filter({ hasText: '已保存 1 个文件' }).waitFor();
    await material(confirmedFile).waitFor();
    assert.deepEqual(fileRequests, ['GET']);

    title = refreshedCourse;
    portalGate = hold();
    await reopen();
    await course(originalCourse).waitFor({ timeout: 5000 });
    assert.equal(await course(refreshedCourse).isVisible(), false);
    portalGate.release();
    portalGate = undefined;
    await course(refreshedCourse).waitFor();
    passed('reopening the sidebar shows cached courses before the portal request can complete');

    title = manualCourse;
    portalGate = hold();
    await panel.getByRole('button', { name: '刷新课程', exact: true }).click();
    await waitForHeldRequest(portalGate, 'the manual course refresh did not read the portal');
    assert.equal(await course(refreshedCourse).isVisible(), true);
    portalGate.release();
    portalGate = undefined;
    await course(manualCourse).waitFor();
    assert.equal(await course(refreshedCourse).isVisible(), false);

    file = refreshedFile;
    folderGate = hold();
    await openFolder(manualCourse);
    await material(confirmedFile).waitFor({ timeout: 5000 });
    assert.equal(await material(refreshedFile).isVisible(), false);
    assert.equal(await material(confirmedFile).isEnabled(), false);
    assert.deepEqual(fileRequests, ['GET']);
    folderGate.release();
    folderGate = undefined;
    await material(refreshedFile).waitFor();
    passed('revisiting a course folder shows its cached files while fresh directory data is held');
    passed('the confirmed file suffix survives reopening without another file request');

    file = manualFile;
    folderGate = hold();
    await panel.getByRole('button', { name: '刷新目录', exact: true }).click();
    await waitForHeldRequest(folderGate, 'the manual folder refresh did not read the teacher directory');
    assert.equal(await material(refreshedFile).isVisible(), true);
    folderGate.release();
    folderGate = undefined;
    await material(manualFile).waitFor();
    assert.equal(await material(refreshedFile).isVisible(), false);
    assert.deepEqual(fileRequests, ['GET']);
    passed('explicit course and folder refresh use updated directory data without fetching files');

    file = lateFile;
    folderGate = hold();
    await panel.getByRole('button', { name: '刷新目录', exact: true }).click();
    await waitForHeldRequest(folderGate, 'directory refresh did not start before the simulated logout');
    signedIn = false;
    await school.evaluate(/** 从原标签页模拟学校退出请求，旧文档及延迟响应保持存在。 */ async function requestLogout(url) { await fetch(url); }, logoutUrl);
    await material(manualFile).waitFor({ state: 'hidden', timeout: 5000 });
    folderGate.release();
    folderGate = undefined;
    await reopen();
    await panel.getByRole('alert').filter({ hasText: '登录' }).waitFor();
    assert.equal(await displayed([manualCourse, lateFile]), false);

    signedIn = true;
    title = secondAccountCourse;
    file = secondAccountFile;
    await school.goto(schoolUrl);
    const newSessionGate = hold();
    portalGate = newSessionGate;
    await reopen();
    await waitForHeldRequest(newSessionGate, 'a new login session did not fetch fresh courses');
    assert.equal(await course(manualCourse).isVisible(), false);
    newSessionGate.release();
    portalGate = undefined;
    await openFolder(secondAccountCourse);
    await material(secondAccountFile).waitFor();
    assert.equal(await material(`${secondAccountFile}.pdf`).isVisible(), false);
    assert.equal(await material(manualFile).isVisible(), false);
    assert.equal(await material(lateFile).isVisible(), false);
    assert.equal(await displayed([manualCourse, manualFile, lateFile]), false);
    assert.deepEqual(fileRequests, ['GET']);
    passed('logout and same-name re-login do not reuse the previous session course or file data');
  } finally {
    for (const gate of gates) gate.release();
    await panel?.close();
    for (const [url, handler] of routes) await context.unroute(url, handler);
  }
}
