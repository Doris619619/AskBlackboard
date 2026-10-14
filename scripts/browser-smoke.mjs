/** 文件用途：在隔离浏览器加载实际 dist 扩展，使用虚构网络验证采集、问答、回跳与恢复；不代表真实学校/模型验收。 */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { portalUrl, announcementUrl, portal, announcements, found, completion } from '../tests/browser/fixtures.mjs';

const output = path.resolve('artifacts/browser-smoke');
await mkdir(output, { recursive: true });
await writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'running', kind: 'real-extension-synthetic-network' }));
await mkdir('.local', { recursive: true });
const profile = await mkdtemp(path.resolve('.local/browser-smoke-'));
const extension = path.resolve('dist');
const context = await chromium.launchPersistentContext(profile, {
  headless: true,
  ...(process.env.BB_BROWSER_EXECUTABLE ? { executablePath: process.env.BB_BROWSER_EXECUTABLE } : { channel: 'chromium' }),
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  viewport: { width: 390, height: 844 },
});
context.setDefaultTimeout(15000);
context.setDefaultNavigationTimeout(20000);
let loggedIn = true;
let modelMode = 'ok';
let announcementReads = 0;
let modelCalls = 0;
let releasePending;
const checks = [];
const pageErrors = [];
let panel;

/** 记录已完成且有断言支持的用例，失败立即中止，避免生成假的全绿报告。 */
function passed(name) { checks.push(name); console.log(`PASS ${name}`); }

/** 所有学校请求只返回虚构门户/公告，不连接学校，也不读取个人登录状态。 */
async function schoolRoute(route) {
  const url = new URL(route.request().url());
  if (!loggedIn) return route.fulfill({ status: 200, contentType: 'text/html', body: '<html><head><title>Login</title></head><body><form id="loginForm"><input type="password"></form></body></html>' });
  if (url.pathname.includes('/portal/')) return route.fulfill({ contentType: 'text/html', body: portal });
  if (url.pathname.endsWith('/announcement')) {
    announcementReads += 1;
    return route.fulfill({ contentType: 'text/html', body: announcements });
  }
  return route.abort();
}

/** 用受控响应覆盖模型接口；不会将测试占位密钥或虚构资料发送给提供商。 */
async function modelRoute(route) {
  modelCalls += 1;
  const payload = route.request().postDataJSON();
  const data = JSON.parse(payload.messages[1].content).DATA;
  assert.equal(data.sources.length, 1);
  assert.equal(data.sources[0].sourceId, '_901_1');
  assert.equal(data.course.code, 'GED2005');
  if (modelMode === 'pending') await new Promise(function waitForRelease(resolve) { releasePending = resolve; });
  if (modelMode === 'auth') return route.fulfill({ status: 401, json: { error: 'test-only' } });
  const answer = modelMode === 'invalid' ? { ...found, citations: [{ sourceId: '_missing_1', quote: 'Invented' }] }
    : data.question.includes('Quiz 2') ? { status: 'not_found', answer: '当前已读取公告没有明确说明 Quiz 2 的安排。', citations: [] }
      : data.question.includes('几点') ? { status: 'not_found', answer: '公告没有注明 Quiz 1 的具体开始时刻。', citations: found.citations } : found;
  await route.fulfill({ json: completion(answer) });
}

/** 使用真实输入控件提交问题，等待对应状态由扩展自行更新。 */
async function ask(question) {
  await panel.getByRole('textbox', { name: '输入课程问题' }).fill(question);
  await panel.getByRole('button', { name: '发送问题', exact: true }).click();
}

/** 等待可见文字，不通过读取 React 内部状态替代实际页面输出。 */
async function visible(text) { await panel.getByText(text, { exact: false }).last().waitFor({ timeout: 15000 }); }

try {
  await context.route('https://bb.cuhk.edu.cn/**', schoolRoute);
  await context.route('https://api.deepseek.com/**', modelRoute);
  // 路由返回虚构资料；未被接管的 chrome.tabs.create 首次导航也不能访问真实学校。
  await context.setOffline(true);
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).hostname;
  const school = context.pages()[0];
  await school.goto(portalUrl);
  panel = await context.newPage();
  /** 捕获页面运行错误，只保留消息，不记录请求头、存储或表单值。 */
  panel.on('pageerror', function collectError(error) { pageErrors.push(error.message); });
  await panel.goto(`chrome-extension://${id}/sidepanel.html`);
  await visible('已连接 Blackboard');
  assert.equal(await panel.getByLabel('选择课程和教学班').inputValue(), '_700_1');
  passed('actual extension worker + content script discover course');

  await panel.getByRole('button', { name: '打开设置', exact: true }).click();
  await panel.getByLabel('API 密钥', { exact: true }).fill('sk-browser-fixture-placeholder');
  await panel.getByRole('button', { name: '保存设置', exact: true }).click();
  await panel.getByRole('dialog').waitFor({ state: 'hidden' });
  await panel.reload();
  await visible('已连接 Blackboard');
  assert.equal(await panel.getByRole('button', { name: '设置 DeepSeek 连接' }).count(), 0);
  passed('settings persist in real extension storage');
  await panel.getByRole('button', { name: '打开设置', exact: true }).click();
  await panel.getByRole('dialog').waitFor();
  await panel.keyboard.press('Escape');
  await panel.getByRole('dialog').waitFor({ state: 'hidden' });
  await panel.waitForFunction(function focusRestored() { return document.activeElement?.getAttribute('aria-label') === '打开设置'; });
  passed('Escape closes settings and restores keyboard focus');

  const input = panel.getByRole('textbox', { name: '输入课程问题' });
  await input.fill('GED2005 Quiz 1 是什么时候？');
  await input.press('Shift+Enter');
  assert.match(await input.inputValue(), /\n$/);
  assert.equal(await panel.locator('.conversation-turn').count(), 0);
  await input.press('Enter');
  await visible(found.answer);
  assert.ok(announcementReads > 0);
  passed('keyboard + actual collection + model contract + visible answer');

  const sourcePromise = context.waitForEvent('page');
  await panel.locator('.cited-sources').getByRole('button', { name: '打开公告原文' }).first().click();
  const source = await sourcePromise;
  await source.waitForURL(`${announcementUrl}#_901_1`);
  passed('source click opens expected course URL and announcement anchor');
  // chrome.tabs.create 的首次导航早于 Playwright 的路由接管；重新导航后独立验证真实内容脚本定位。
  // 该检查不能代替真实学校页面上的一次点击回跳验收。
  await source.reload();
  await source.locator('#_901_1').waitFor();
  const highlightResult = await worker.evaluate(async function highlightTestSource(url) {
    const tabs = await chrome.tabs.query({ url: 'https://bb.cuhk.edu.cn/*' });
    const tab = tabs.find(candidate => candidate.url === url);
    return chrome.tabs.sendMessage(tab.id, { type: 'highlight_source', sourceId: '_901_1', quote: 'Quiz 1 will take place on Monday, October 12.' });
  }, `${announcementUrl}#_901_1`);
  assert.equal(highlightResult.ok, true);
  try {
    await source.waitForFunction(function hasHighlight() { return [...document.querySelectorAll('[style]')].some(e => e.style.outline.includes('3px')); });
  } catch (error) {
    console.error('Source diagnostics:', JSON.stringify({ url: source.url(), title: await source.title(), itemCount: await source.locator('#announcementList > li').count(), errors: await panel.locator('.inline-error').allTextContents() }));
    await source.screenshot({ path: path.join(output, 'source-failure.png') });
    throw error;
  }
  passed('content script highlights fixture after controlled navigation');
  await source.close();

  await ask('Quiz 1 几点开始？');
  await visible('公告没有注明 Quiz 1 的具体开始时刻。');
  await ask('Quiz 2 是什么时候？');
  await visible('当前已读取公告没有明确说明 Quiz 2 的安排。');
  passed('missing time and missing quiz render not_found');

  modelMode = 'auth';
  await ask('Quiz 1 是什么时候？');
  await visible('DeepSeek 密钥未通过验证');
  assert.ok(await panel.locator('.conversation-turn').last().getByText('已查课程公告 · 1 条').isVisible());
  const readsBeforeRetry = announcementReads;
  modelMode = 'ok';
  await panel.getByRole('button', { name: '重试回答', exact: true }).click();
  await panel.locator('.conversation-turn').last().getByText(found.answer, { exact: true }).waitFor();
  assert.equal(announcementReads, readsBeforeRetry);
  passed('provider failure preserves sources; retry reuses same snapshot');

  modelMode = 'invalid';
  await ask('Quiz 1 是什么时候？');
  await visible('AI 回答与公告依据不一致');
  assert.equal(await panel.locator('.conversation-turn').last().locator('.answer-text').count(), 0);
  passed('invented citation never displayed as accepted answer');

  modelMode = 'pending';
  await ask('Quiz 1 是什么时候？');
  await visible('正在核对问题与公告原文');
  await panel.getByRole('button', { name: '停止回答' }).click();
  await visible('已停止。');
  modelMode = 'ok';
  releasePending?.();
  assert.equal(await panel.getByRole('button', { name: '发送问题' }).count(), 1);
  passed('cancel restores composer without accepting late answer');

  for (const theme of ['dark', 'light']) {
    await panel.getByRole('button', { name: '打开设置', exact: true }).click();
    await panel.getByLabel('外观', { exact: true }).selectOption(theme);
    await panel.getByRole('button', { name: '保存设置', exact: true }).click();
    await panel.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.equal(await panel.locator('html').getAttribute('data-theme'), theme);
    await panel.screenshot({ path: path.join(output, `${theme}.png`) });
  }
  await panel.setViewportSize({ width: 320, height: 640 });
  assert.ok(await panel.evaluate(function fitsWidth() { return document.documentElement.scrollWidth <= innerWidth; }));
  await panel.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await panel.locator('.conversation-turn').first().evaluate(function animation(element) { return getComputedStyle(element).animationName; }), 'none');
  await panel.screenshot({ path: path.join(output, 'narrow.png') });
  passed('light/dark + 320px layout + reduced motion');

  await panel.evaluate(async function zoomIn() { const tab = await chrome.tabs.getCurrent(); await chrome.tabs.setZoom(tab.id, 2); });
  await panel.waitForFunction(function zoomApplied() { return innerWidth <= 160; });
  assert.ok(await panel.evaluate(function readableZoom() {
    return document.documentElement.scrollWidth <= innerWidth && getComputedStyle(document.querySelector('.workspace')).overflowY === 'visible' && document.querySelector('.workspace').clientHeight > 200;
  }));
  await panel.locator('.answer-text').last().scrollIntoViewIfNeeded();
  await panel.screenshot({ path: path.join(output, 'zoom-200.png') });
  await panel.evaluate(async function resetZoom() { const tab = await chrome.tabs.getCurrent(); await chrome.tabs.setZoom(tab.id, 1); });
  passed('actual 200 percent browser zoom keeps answer readable with page scrolling');

  loggedIn = false;
  const callsBeforeLoginFailure = modelCalls;
  await ask('Quiz 1 是什么时候？');
  await visible('登录');
  assert.equal(modelCalls, callsBeforeLoginFailure);
  loggedIn = true;
  await panel.locator('.conversation-turn').last().getByRole('button', { name: '重试读取' }).click();
  await panel.locator('.conversation-turn').last().getByText(found.answer, { exact: true }).waitFor();
  passed('expired login does not call model and recovers after retry');
  assert.deepEqual(pageErrors, []);
  await writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'passed', kind: 'real-extension-synthetic-network', browser: context.browser()?.version(), checks, announcementReads, modelCalls }, null, 2));
} catch (error) {
  await panel?.screenshot({ path: path.join(output, 'failure.png') }).catch(function ignoreScreenshotFailure() {});
  await writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'failed', kind: 'real-extension-synthetic-network', checks, errorType: error.name }, null, 2));
  throw error;
} finally {
  releasePending?.();
  await context.close();
  // 删除前校验真实绝对路径，仅清理本次 mkdtemp 创建的虚构测试配置，绝不涉及真实验收账号配置。
  const resolvedProfile = await realpath(profile);
  const localRoot = await realpath('.local');
  assert.equal(path.dirname(resolvedProfile), localRoot);
  assert.ok(path.basename(resolvedProfile).startsWith('browser-smoke-'));
  await rm(resolvedProfile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
