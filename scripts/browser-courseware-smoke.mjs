/** 文件用途：用实际扩展、虚构课件和浏览器私有文件系统验证课件选取与原字节保存。 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { lectureBytes, lectureFilePath, tutorialBytes, tutorialFilePath } from '../tests/browser/fixtures.mjs';

/** 仅替换系统选择器，保存仍经过浏览器真实目录句柄及可写文件流。 */
async function installPicker(panel) {
  await panel.evaluate(async function setupFixtureDirectory() {
    const root = await navigator.storage.getDirectory();
    const course = await root.getDirectoryHandle('ECE4016', { create: true });
    const content = await course.getDirectoryHandle('Content', { create: true });
    const lecture = await content.getDirectoryHandle('Lecture', { create: true });
    const original = await lecture.getFileHandle('Week 01.pdf', { create: true });
    const writable = await original.createWritable();
    await writable.write('pre-existing file');
    await writable.close();
    window.coursewarePickerCalls = 0;
    window.showDirectoryPicker = async function pickFixtureDirectory(options) {
      if (options.mode !== 'readwrite') throw new Error('Expected readwrite mode');
      window.coursewarePickerCalls += 1;
      if (window.coursewarePickerCalls === 1) throw new DOMException('Fixture cancelled picker', 'AbortError');
      return root;
    };
  });
}

/** 验证按原目录保存、重复文件保留，且两个二进制文件内容没有改写。 */
async function assertSavedFiles(panel) {
  const files = await panel.evaluate(async function readSavedFixtureFiles() {
    const root = await navigator.storage.getDirectory();
    const course = await root.getDirectoryHandle('ECE4016');
    const content = await course.getDirectoryHandle('Content');
    const lecture = await content.getDirectoryHandle('Lecture');
    const tutorial = await course.getDirectoryHandle('Tutorial');
    /** 从虚构验收目录读取已写文件的字节以便和网络响应比较。 */
    async function read(directory, name) {
      const handle = await directory.getFileHandle(name);
      return [...new Uint8Array(await (await handle.getFile()).arrayBuffer())];
    }
    return {
      original: await read(lecture, 'Week 01.pdf'),
      lecture: await read(lecture, 'Week 01 (1).pdf'),
      tutorial: await read(tutorial, 'Tutorial 01.ppt'),
    };
  });
  assert.deepEqual(Buffer.from(files.original), Buffer.from('pre-existing file'));
  assert.deepEqual(Buffer.from(files.lecture), lectureBytes);
  assert.deepEqual(Buffer.from(files.tutorial), tutorialBytes);
}

/** 操作真实课件页，逐项断言目录、取消、失效、重试、保存以及问答状态隔离。 */
export async function runCoursewareSmoke(panel, state, output, passed) {
  const question = panel.getByRole('textbox', { name: '输入课程问题' });
  const draft = await question.inputValue();
  const selectedCourse = await panel.getByLabel('选择课程和教学班').inputValue();
  const turns = await panel.locator('.conversation-turn').count();
  await panel.getByRole('button', { name: '课件', exact: true }).click();
  await panel.getByRole('button', { name: /ECE4016.*L02/ }).waitFor();
  await panel.getByRole('button', { name: /ECE4016.*L01/ }).click();
  const content = panel.getByRole('button', { name: 'Content', exact: true });
  const tutorial = panel.getByRole('button', { name: 'Tutorial', exact: true });
  await tutorial.waitFor();
  assert.equal(await panel.getByRole('button', { name: 'Tests', exact: true }).count(), 0);
  assert.equal(await content.evaluate(function teacherOrder(element) { return element.parentElement.nextElementSibling?.textContent.includes('Tutorial'); }), true);
  await content.click();
  await panel.getByRole('button', { name: 'Lecture', exact: true }).click();
  await panel.getByRole('checkbox', { name: 'Week 01.pdf', exact: true }).check();
  assert.equal(await panel.getByText('Assignment.pdf', { exact: true }).count(), 0);
  await panel.getByRole('button', { name: '返回上一层', exact: true }).click();
  await panel.getByRole('button', { name: '返回上一层', exact: true }).click();
  await tutorial.click();
  const retryDirectory = panel.getByRole('button', { name: '重试读取', exact: true });
  await retryDirectory.waitFor();
  assert.deepEqual(state.files, []);
  state.failDirectory = false;
  await retryDirectory.click();
  await panel.getByRole('checkbox', { name: '全选当前目录', exact: true }).check();
  assert.deepEqual(state.files, []);
  passed('courseware browses historical courses and retries teacher folders without requesting file bytes');

  await panel.setViewportSize({ width: 320, height: 680 });
  await panel.emulateMedia({ colorScheme: 'dark' });
  assert.equal(await panel.evaluate(function fitsCourseware() { return document.documentElement.scrollWidth <= innerWidth; }), true);
  await panel.screenshot({ path: path.join(output, 'courseware-narrow.png') });
  await panel.setViewportSize({ width: 390, height: 844 });
  await panel.emulateMedia({ colorScheme: 'light' });

  await installPicker(panel);
  const download = panel.getByRole('button', { name: '下载 2 个文件', exact: true });
  await download.click();
  await panel.waitForFunction(function pickerOpened() { return window.coursewarePickerCalls === 1; });
  assert.deepEqual(state.files, []);
  state.loginExpired = true;
  await download.click();
  const retry = panel.getByRole('button', { name: '重试失败项', exact: true });
  const results = panel.locator('.courseware-results');
  await retry.waitFor();
  await results.getByText(/登录/).first().waitFor();
  assert.deepEqual(state.files, []);
  state.loginExpired = false;
  passed('cancelled directory picker and expired login send no courseware requests');

  await retry.click();
  await panel.getByRole('status').filter({ hasText: '已保存 1 个文件 · 失败 1 个' }).waitFor();
  assert.deepEqual(state.files, [lectureFilePath, tutorialFilePath]);
  await results.getByText('Week 01 (1).pdf', { exact: false }).waitFor();
  state.failTutorial = false;
  await retry.click();
  await panel.getByRole('status').filter({ hasText: '已保存 2 个文件' }).waitFor();
  await assertSavedFiles(panel);
  assert.deepEqual(state.files, [lectureFilePath, tutorialFilePath, tutorialFilePath]);
  assert.equal(await panel.evaluate(function pickerCallCount() { return window.coursewarePickerCalls; }), 2);
  await panel.screenshot({ path: path.join(output, 'courseware-saved.png') });
  passed('courseware batch saves original bytes in teacher folders, preserves existing file and retries only failed file');

  await verifyDownloadHandoff(panel, state, passed);

  await panel.getByRole('button', { name: '问答', exact: true }).click();
  assert.equal(await question.inputValue(), draft);
  assert.equal(await panel.getByLabel('选择课程和教学班').inputValue(), selectedCourse);
  assert.equal(await panel.locator('.conversation-turn').count(), turns);
  passed('switching courseware views preserves question draft, selected course and conversation');
}

/** 侧栏选择器受限时一次性交接；独立页必须重新点击确认，重复使用令牌失败。 */
async function verifyDownloadHandoff(panel, state, passed) {
  await panel.getByRole('checkbox', { name: 'Tutorial 01.ppt', exact: true }).check();
  await panel.evaluate(function blockSidebarPicker() {
    window.showDirectoryPicker = async function blocked() { throw new DOMException('Fixture blocked picker', 'SecurityError'); };
  });
  const context = panel.context();
  const handoffCreated = context.waitForEvent('page');
  const readsBeforeHandoff = state.files.length;
  await panel.getByRole('button', { name: '下载 1 个文件', exact: true }).click();
  const handoff = await handoffCreated;
  try {
    const save = handoff.getByRole('button', { name: '选择目录并保存', exact: true });
    await save.waitFor();
    assert.equal(state.files.length, readsBeforeHandoff);
    await handoff.evaluate(function installFullPagePicker() {
      window.showDirectoryPicker = async function pickFixtureRoot() { return navigator.storage.getDirectory(); };
    });
    await save.click();
    await handoff.getByRole('status').filter({ hasText: '已保存 1 个文件' }).waitFor();
    assert.deepEqual(state.files.slice(readsBeforeHandoff), [tutorialFilePath]);
    await handoff.reload();
    await handoff.getByRole('alert').filter({ hasText: '已过期或已使用' }).waitFor();
    assert.equal(state.files.length, readsBeforeHandoff + 1);
  } finally {
    await handoff.close();
  }
  passed('blocked side panel picker hands off once and waits for a fresh directory confirmation');
}
