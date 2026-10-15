/** 文件用途：在隔离Edge中模拟旧后台配新侧栏，验证提示、一键重载、配置保留和新作业查询。 */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import path from 'node:path';
import { portalUrl, portal, assignmentRoot, assignmentListing } from '../tests/browser/fixtures.mjs';

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
try {
  /** 学校请求只返回虚构的安全页面，其余路径一律拒绝。 */
  await context.route('https://bb.cuhk.edu.cn/**', async function school(route) {
    const url = new URL(route.request().url());
    const body = url.pathname.includes('/portal/') ? portal : url.pathname.endsWith('/courseMain') ? assignmentRoot(url.searchParams.get('course_id')) : url.pathname.endsWith('/listContent.jsp') ? assignmentListing(url.searchParams.get('course_id')) : null;
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
  await panel.getByText('插件界面与后台版本不一致', { exact: false }).waitFor();
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
  const fresh = await context.newPage(); await fresh.goto(`chrome-extension://${id}/sidepanel.html`);
  await school.reload();
  await fresh.getByText('已连接 Blackboard', { exact: true }).waitFor();
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
