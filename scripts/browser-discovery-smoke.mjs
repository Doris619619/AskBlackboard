/** 文件用途：在隔离 Edge 验证课件首页不被 My Blackboard 发起的慢速课程请求阻塞。 */
import assert from 'node:assert/strict';
import { coursewarePortal, portalUrl } from '../tests/browser/fixtures.mjs';

const myBlackboardUrl = new URL('/webapps/bb-social-learning-BBLEARN/execute/mybb?cmd=display', portalUrl).href;
const portalImageUrl = new URL('/fixture-discovery-pending-image.svg', portalUrl).href;

/** 使用实际扩展，首次打开课件时挂起常规门户请求及备用门户的图片，及时返回目录 HTML。 */
export async function runCourseDiscoverySmoke(context, worker, school, panelUrl, passed) {
  const panel = await context.newPage();
  let releasePortal;
  const stalled = new Promise(/** 门户请求只有在验收结束后才会继续。 */ function hold(resolve) { releasePortal = resolve; });
  let portalFetches = 0;
  let portalNavigations = 0;
  let portalImages = 0;

  /** 当前标签只有 My Blackboard 外壳，没有可直接读取的课程目录。 */
  function renderMyBlackboard(route) {
    return route.fulfill({ contentType: 'text/html', body: '<!DOCTYPE html><html><body><button id="global-nav-link">Example Student</button><p>My Blackboard</p></body></html>' });
  }

  /** 挂起当前页的常规门户 GET，允许备用标签页完成同源门户导航。 */
  async function servePortal(route) {
    if (route.request().isNavigationRequest()) {
      portalNavigations += 1;
      return route.fulfill({ contentType: 'text/html', body: coursewarePortal.replace('</body>', `<img src="${portalImageUrl}" alt=""></body>`) });
    }
    portalFetches += 1;
    await holdRequest(route);
  }

  /** 记录备用门户的非关键图片请求，模拟 HTML 已就绪但加载事件未触发。 */
  async function holdPortalImage(route) {
    portalImages += 1;
    await holdRequest(route);
  }

  /** 在断言完成前保留慢请求，并在浏览器取消时安静退出。 */
  async function holdRequest(route) {
    await stalled;
    await route.abort().catch(/** 读取提前切换时浏览器可能已取消该请求。 */ function ignoreAbort() {});
  }

  /** 让 Playwright 接管临时页，再导航到离线路由中的门户。 */
  await worker.evaluate(function preparePortalFixture(url) {
    const original = chrome.tabs.create;
    let attached = false;
    let resume;
    /** 接收临时标签页已纳入虚构网络路由的通知。 */
    globalThis.attachDiscoveryFixture = function attachedPage() { attached = true; resume?.(); };
    /** 仅改写测试中的备用门户页创建，保留真实标签页与消息传输。 */
    chrome.tabs.create = async function createRoutedTab(options) {
      if (options.url !== url || options.active !== false) return original.call(chrome.tabs, options);
      const tab = await original.call(chrome.tabs, { ...options, url: 'about:blank' });
      if (!attached) await new Promise(/** 等待空白页被测试接管。 */ function waitForAttachment(resolve) { resume = resolve; });
      attached = false;
      resume = undefined;
      return chrome.tabs.update(tab.id, { url });
    };
    /** 还原浏览器 API，使后续用例按原样运行。 */
    globalThis.restoreDiscoveryFixture = function restore() { chrome.tabs.create = original; delete globalThis.attachDiscoveryFixture; delete globalThis.restoreDiscoveryFixture; };
  }, portalUrl);

  /** 通知后台临时门户已被浏览器测试接管。 */
  function attachPortalFixture(page) {
    if (page.url() === 'about:blank') void worker.evaluate(/** 让临时标签页开始导航。 */ function attach() { globalThis.attachDiscoveryFixture(); });
  }

  await context.route(myBlackboardUrl, renderMyBlackboard);
  await context.route(portalUrl, servePortal);
  await context.route(portalImageUrl, holdPortalImage);
  context.on('page', attachPortalFixture);
  try {
    await school.goto(myBlackboardUrl);
    await panel.goto(panelUrl);
    await panel.getByRole('button', { name: '课件', exact: true }).click();
    await panel.getByRole('button', { name: 'ECE3060: Introduction to Robotics', exact: true }).waitFor({ timeout: 7000 });
    assert.ok(portalFetches <= 1);
    assert.equal(portalNavigations, 1);
    assert.equal(portalImages, 1);
    assert.equal(school.url(), myBlackboardUrl);
    passed('coursework startup lists courses from My Blackboard while the primary fetch and a portal image are stalled');
  } finally {
    releasePortal();
    context.off('page', attachPortalFixture);
    await worker.evaluate(/** 移除本用例的标签创建接管。 */ function restore() { globalThis.restoreDiscoveryFixture(); });
    await panel.close();
    await context.unroute(portalImageUrl, holdPortalImage);
    await context.unroute(portalUrl, servePortal);
    await context.unroute(myBlackboardUrl, renderMyBlackboard);
  }
}
