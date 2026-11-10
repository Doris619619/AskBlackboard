/** 文件用途：在隔离 Edge 中验证旧后台提示、一键重载、配置保留和课件及作业读取恢复。 */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import path from 'node:path';
import { portalUrl, coursewarePortal, coursewareCourseId, coursewareLanding, coursewarePage, assignmentRoot, assignmentListing } from '../tests/browser/fixtures.mjs';

await mkdir('.local', { recursive: true });
const root = await mkdtemp(path.resolve('.local/runtime-upgrade-'));
const extension = path.join(root, 'extension');
await cp('dist', extension, { recursive: true });
const currentWorker = await readFile(path.join(extension, 'background.js'));
// 旧版ping契约与未知操作错误来自历史实现；不使用真实学校、密钥或浏览器配置。
await writeFile(path.join(extension, 'background.js'), `chrome.runtime.onMessage.addListener(function legacy(message,sender,respond) { respond(message.type === 'ping' ? {ok:true,data:true} : {ok:false,error:{code:'invalid_message',message:'该操作不属于侧栏支持的只读查询。'}}); });`);
const context = await chromium.launchPersistentContext(path.join(root, 'profile'), {
  headless: true,
  ...(process.env.BB_BROWSER_EXECUTABLE ? { executablePath: process.env.BB_BROWSER_EXECUTABLE } : { channel: 'chromium' }),
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
context.setDefaultTimeout(15000);
let modelCalls = 0;
const portalNavigations = [];
const coursewareReadPages = [];
try {
  /** 学校请求只返回虚构的安全页面，其余路径一律拒绝。 */
  await context.route('https://bb.cuhk.edu.cn/**', async function school(route) {
    const request = route.request();
    const url = new URL(request.url());
    if (url.href === portalUrl && request.isNavigationRequest()) portalNavigations.push(request.frame().page());
    if (url.pathname.endsWith('/courseMain') && url.searchParams.get('course_id') === coursewareCourseId) {
      return route.fulfill({ status: 302, headers: { location: coursewareLanding } });
    }
    const courseware = coursewarePage(url);
    if (courseware !== undefined) coursewareReadPages.push(request.frame().page());
    const body = courseware ?? (url.pathname.includes('/portal/') ? coursewarePortal : url.pathname.endsWith('/courseMain') ? assignmentRoot(url.searchParams.get('course_id')) : url.pathname.endsWith('/listContent.jsp') ? assignmentListing(url.searchParams.get('course_id')) : null);
    if (!body) return route.abort();
    return route.fulfill({ contentType: 'text/html', body });
  });
  /** 任何模型请求都失败并计数，验证截止查询确实不依赖AI。 */
  await context.route('https://api.deepseek.com/**', async function denyModel(route) { modelCalls += 1; await route.abort(); });
  await context.setOffline(true);
  const oldWorker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(oldWorker.url()).hostname;
  /** 配置仅使用虚构占位值，用于核对重载没有清除设置。 */
  await oldWorker.evaluate(async function seed() { await chrome.storage.local.set({ upgradeFixture: 'preserved' }); });
  const school = context.pages()[0]; await school.goto(portalUrl);
  const panel = await context.newPage(); await panel.goto(`chrome-extension://${id}/sidepanel.html`);
  await panel.getByRole('region', { name: '课程和连接状态' }).getByRole('alert').filter({ hasText: '插件界面与后台版本不一致' }).waitFor();
  const reload = panel.getByRole('button', { name: '重新加载插件', exact: true });
  await reload.waitFor();
  assert.equal(await panel.getByText('该操作不属于侧栏支持的只读查询。', { exact: true }).count(), 0);
  await mkdir('artifacts/browser-smoke', { recursive: true });
  await panel.screenshot({ path: 'artifacts/browser-smoke/runtime-mismatch.png' });
  await writeFile(path.join(extension, 'background.js'), currentWorker);
  const restarted = context.waitForEvent('serviceworker');
  await reload.click();
  const worker = await restarted;
  /** 只核对虚构标志位，不提取真实凭据。 */
  assert.equal(await worker.evaluate(async function preserved() { return (await chrome.storage.local.get('upgradeFixture')).upgradeFixture; }), 'preserved');
  const fresh = await context.newPage();
  // 先让 Playwright 接管临时页，再导航至离线夹具，防止新页首个请求早于路由注册。
  /** 只对隔离浏览器中的后台门户页延迟导航，保留真实标签页 ID、内容脚本和关闭操作。 */
  await worker.evaluate(function routeRecoveryPortal(url) {
    const create = chrome.tabs.create.bind(chrome.tabs);
    const pending = [];
    let attached = 0;
    /** 接收 Playwright 新页事件，兼容事件与浏览器 create 返回的先后顺序。 */
    globalThis.attachRecoveryFixture = function attachedPage() {
      const resume = pending.shift();
      if (resume) resume();
      else attached += 1;
    };
    /** 对备用门户先开空白页，其余标签页使用原始浏览器 API。 */
    chrome.tabs.create = async function createRoutedTab(options) {
      if (options.url !== url || options.active !== false) return create(options);
      const tab = await create({ ...options, url: 'about:blank' });
      if (attached > 0) attached -= 1;
      else await new Promise(/** 等待空白页已被浏览器测试接管。 */ function waitForAttachment(resolve) { pending.push(resolve); });
      return chrome.tabs.update(tab.id, { url });
    };
  }, portalUrl);
  /** 给备用门户的空白页发送路由已就绪信号。 */
  function attachRecoveryPage(page) {
    if (page.url() !== 'about:blank') return;
    void worker.evaluate(/** 通知后台可导航至夹具。 */ function signal() { globalThis.attachRecoveryFixture(); });
  }
  context.on('page', attachRecoveryPage);
  await fresh.goto(`chrome-extension://${id}/sidepanel.html`);
  await fresh.getByText('已连接 Blackboard', { exact: true }).waitFor();
  await fresh.getByRole('button', { name: '课件', exact: true }).click();
  await fresh.getByRole('button', { name: 'ECE4016: Example Course', exact: true }).click();
  const content = fresh.getByRole('button', { name: 'Content', exact: true });
  const coursewareError = fresh.getByRole('main', { name: '课程课件' }).getByRole('alert');
  await content.or(coursewareError).waitFor();
  assert.ok(await content.isVisible(), `重载后读取课件失败：${(await coursewareError.allTextContents()).join(' ')}`);
  await content.click();
  const lecture = fresh.getByRole('button', { name: 'Lecture', exact: true });
  await lecture.or(coursewareError).waitFor();
  assert.ok(await lecture.isVisible(), `重载后读取课件子目录失败：${(await coursewareError.allTextContents()).join(' ')}`);
  assert.equal(portalNavigations.filter(page => page === school).length, 1);
  assert.equal(coursewareReadPages.length, 2);
  for (const recoveryPage of coursewareReadPages) {
    assert.ok(portalNavigations.includes(recoveryPage) && recoveryPage !== school && recoveryPage.isClosed());
  }
  context.off('page', attachRecoveryPage);
  console.log('PASS courseware and its subfolder use a connected fallback portal without reloading the original school tab');

  await school.reload();
  await fresh.getByRole('button', { name: '问答', exact: true }).click();
  await fresh.getByRole('textbox', { name: '输入课程问题' }).fill('GED2005作业什么时候截止');
  await fresh.getByRole('button', { name: '发送问题', exact: true }).click();
  await fresh.locator('.deadline-quote').filter({ hasText: 'The deadline is 21:30, 22 Nov 2026.' }).waitFor();
  assert.equal(modelCalls, 0);
  await fresh.screenshot({ path: 'artifacts/browser-smoke/runtime-recovered.png' });
  console.log('PASS old background detected, user-triggered reload, settings retained, assignment query recovered without AI');
} finally {
  await context.close();
  const resolved = await realpath(root);
  const allowed = await realpath('.local');
  assert.ok(resolved.startsWith(allowed + path.sep));
  await rm(resolved, { recursive: true, force: true });
}
