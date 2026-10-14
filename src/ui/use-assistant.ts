/** 文件用途：协调课程发现、按需公告刷新和有出处的模型回答；凭据只在侧栏调用模型时使用。 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { defaultCourse, resolveCourse } from '../blackboard/course-resolution';
import { askDeepSeek } from '../ai/deepseek';
import { collectAnnouncements, discoverCourses } from '../shared/browser-client';
import { friendlyError } from '../shared/errors';
import { loadSettings, saveSettings } from '../shared/settings';
import type { AnnouncementSnapshot, Course, CourseDiscovery, ModelAnswer, Settings } from '../shared/types';

export interface Turn {
  id: number;
  question: string;
  course: Course;
  snapshot?: AnnouncementSnapshot;
  answer?: ModelAnswer;
  error?: string;
  stage: 'reading' | 'answering' | 'done' | 'error' | 'cancelled';
}
const initialSettings: Settings = { apiKey: '', model: 'deepseek-flash', theme: 'system' };

/** 管理侧栏会话；取消只中断模型并忽略晚到的采集结果，不修改 Blackboard。 */
export function useAssistant() {
  const [settings, setSettings] = useState<Settings>(initialSettings);
  const [discovery, setDiscovery] = useState<CourseDiscovery | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [discovering, setDiscovering] = useState(false);
  const [connectionError, setConnectionError] = useState('');
  const [notice, setNotice] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const sequence = useRef(0);
  const mounted = useRef(true);
  const discoverySequence = useRef(0);
  const discoveryRequest = useRef<Promise<CourseDiscovery> | null>(null);
  const settingsRevision = useRef(0);
  const running = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const manuallySelected = useRef(false);
  const extensionAvailable = Boolean(globalThis.chrome?.runtime?.id);

  /** 重新从登录页面发现课程；连接失败保留已发现课程，允许恢复后重试。 */
  const refreshCourses = useCallback(async function refreshCourses() {
    if (!extensionAvailable) return;
    const token = ++discoverySequence.current;
    setDiscovering(true); setConnectionError('');
    try {
      if (!discoveryRequest.current) {
        const request = discoverCourses();
        discoveryRequest.current = request;
        /** 结束后释放共用请求；StrictMode 二次挂载在请求期间复用同一采集任务。 */
        function releaseRequest() { if (discoveryRequest.current === request) discoveryRequest.current = null; }
        void request.then(releaseRequest, releaseRequest);
      }
      const found = await discoveryRequest.current;
      if (!mounted.current || token !== discoverySequence.current) return;
      setDiscovery(found);
      setSelectedId(/** 保留仍有效的明确选择；新学期回退默认值时取消之前班组选择的标记。 */ function preserveSelection(previous) { if (found.courses.some(/** 检查之前课程是否仍可见。 */ function hasPrevious(course) { return course.courseId === previous; })) return previous; manuallySelected.current = false; return defaultCourse(found); });
    } catch (error) { if (mounted.current && token === discoverySequence.current) setConnectionError(friendlyError(error)); }
    finally { if (mounted.current && token === discoverySequence.current) setDiscovering(false); }
  }, [extensionAvailable]);

  /** 初次打开读取受信设置并连接课程；普通开发网页只显示安装后的入口。 */
  useEffect(function initialize() {
    mounted.current = true;
    let alive = true;
    const revision = settingsRevision.current;
    /** 读取凭据时只更新当前挂载侧栏，不向后台或页面发送。 */
    async function readSettings() { try { const loaded = await loadSettings(); if (alive && revision === settingsRevision.current) setSettings(loaded); } catch { if (alive) setNotice('设置暂时无法读取，请重新打开侧栏。'); } }
    void readSettings(); void refreshCourses();
    /** 卸载侧栏时终止模型请求，阻止晚到的回答改变会话。 */
    return function cleanup() { alive = false; mounted.current = false; running.current = false; discoverySequence.current += 1; sequence.current += 1; controller.current?.abort(); };
  }, [refreshCourses]);

  /** 切换用户明确选择的课程，后续歧义课程以该选择为准。 */
  function selectCourse(courseId: string) { manuallySelected.current = true; setSelectedId(courseId); setNotice(''); }

  /** 设置变更只持久化到扩展受信本地存储；成功后立即更新主题和模型配置。 */
  async function updateSettings(next: Settings) { settingsRevision.current += 1; await saveSettings(next); if (mounted.current) { setSettings(next); setNotice(''); } }

  /** 只替换正在执行的会话条目，保留之前提问的证据与结果。 */
  function updateTurn(id: number, changes: Partial<Turn>) {
    setTurns(/** 按稳定会话 ID 合并异步阶段，避免替换其他问题。 */ function merge(previous) { return previous.map(/** 仅更新目标条目。 */ function change(turn) { return turn.id === id ? { ...turn, ...changes } : turn; }); });
  }

  /** 运行一轮问答；默认实时刷新公告，模型重试则复用明确显示检索时间的证据。 */
  async function run(question: string, course: Course, previousSnapshot?: AnnouncementSnapshot, retryId?: number) {
    if (running.current) return;
    running.current = true;
    const token = ++sequence.current;
    const id = retryId ?? Date.now();
    const abort = new AbortController(); controller.current = abort;
    if (course.courseId !== selectedId) manuallySelected.current = false;
    setBusy(true); setNotice(''); setSelectedId(course.courseId);
    if (retryId) updateTurn(id, { error: undefined, answer: undefined, stage: previousSnapshot ? 'answering' : 'reading' });
    else setTurns(/** 添加问题到本侧栏会话，不持久化问题内容。 */ function append(previous) { return [...previous, { id, question, course, stage: 'reading' }]; });
    let snapshot = previousSnapshot;
    try {
      if (!snapshot) snapshot = await collectAnnouncements(course);
      if (token !== sequence.current) return;
      updateTurn(id, { snapshot, stage: 'answering' }); setConnectionError('');
      const answer = await askDeepSeek({ question, snapshot, apiKey: settings.apiKey, model: settings.model, signal: abort.signal });
      if (token !== sequence.current) return;
      updateTurn(id, { answer, stage: 'done' });
    } catch (error) {
      if (token !== sequence.current) return;
      updateTurn(id, { error: friendlyError(error), snapshot, stage: 'error' });
    } finally { if (token === sequence.current) { running.current = false; setBusy(false); controller.current = null; } }
  }

  /** 校验课程与密钥后接受问题；返回 false 时输入应保留以便用户修正。 */
  function ask(question: string): boolean {
    const text = question.trim();
    if (running.current || !text) return false;
    if (!settings.apiKey) { setNotice('请先在设置中添加 DeepSeek API 密钥。'); return false; }
    if (!discovery) { setNotice(extensionAvailable ? '请先连接 Blackboard 并读取课程。' : '请在 Edge 或 Chrome 加载扩展后使用。'); return false; }
    try { const course = resolveCourse(text, discovery, selectedId, manuallySelected.current); void run(text, course); return true; }
    catch (error) { setNotice(error instanceof Error ? error.message : '请先选择课程。'); return false; }
  }

  /** 取消请求后保留已读公告，便于用户查看来源或重试。 */
  function cancel() {
    sequence.current += 1; controller.current?.abort(); controller.current = null; running.current = false; setBusy(false);
    setTurns(/** 仅将运行中的会话标记为取消，保留其已读资料。 */ function cancelActive(previous) { return previous.map(/** 结束尚未完成的条目。 */ function finish(turn) { return turn.stage === 'reading' || turn.stage === 'answering' ? { ...turn, stage: 'cancelled' } : turn; }); });
  }

  /** 重试已有问题；采集成功时只重新请求模型，避免丢弃现成的原文。 */
  function retry(turn: Turn) { if (running.current) return; if (!settings.apiKey) { setNotice('请先在设置中添加 DeepSeek API 密钥，再重试。'); return; } void run(turn.question, turn.course, turn.snapshot, turn.id); }

  return { settings, updateSettings, discovery, selectedId, selectCourse, discovering, refreshCourses, connectionError, notice, turns, busy, ask, cancel, retry, extensionAvailable };
}
