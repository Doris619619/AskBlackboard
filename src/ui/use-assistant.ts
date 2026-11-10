/** 文件用途：协调课程发现、公告问答和作业截止直读；凭据只在侧栏调用模型时使用。 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { defaultCourse, resolveCourse } from '../blackboard/course-resolution';
import { askDeepSeek } from '../ai/deepseek';
import { collectAnnouncements, discoverCourses, readCachedCourses } from '../shared/browser-client';
import { collectDeadlineSources } from '../shared/deadline-client';
import { isAssignmentDeadlineQuestion, answerAssignmentDeadlines } from '../blackboard/deadlines';
import { AppError, friendlyError } from '../shared/errors';
import { loadSettings, saveSettings } from '../shared/settings';
import { BROWSE_CACHE_KEY, type AnnouncementSnapshot, type Course, type CourseBrowseSnapshot, type ModelAnswer, type Settings } from '../shared/types';

export interface Turn {
  id: number;
  question: string;
  course: Course;
  snapshot?: AnnouncementSnapshot;
  answer?: ModelAnswer;
  error?: string;
  progress?: string;
  stage: 'reading' | 'answering' | 'done' | 'error' | 'cancelled';
}
const initialSettings: Settings = { apiKey: '', model: 'deepseek-flash', theme: 'system' };

/** 管理侧栏会话；取消只中断模型并忽略晚到的采集结果，不修改 Blackboard。 */
export function useAssistant() {
  const [settings, setSettings] = useState<Settings>(initialSettings);
  const [browse, setBrowse] = useState<CourseBrowseSnapshot | null>(null);
  const discovery = browse?.discovery ?? null;
  const [selectedId, setSelectedId] = useState('');
  const [discovering, setDiscovering] = useState(false);
  const [connectionError, setConnectionError] = useState('');
  const [needsReload, setNeedsReload] = useState(false);
  const [notice, setNotice] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const sequence = useRef(0);
  const mounted = useRef(true);
  const discoverySequence = useRef(0);
  const revokedScopes = useRef(new Set<string>());
  const discoveryRequest = useRef<{ cached: Promise<CourseBrowseSnapshot | null>; fresh: Promise<CourseBrowseSnapshot> } | null>(null);
  const settingsRevision = useRef(0);
  const running = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const manuallySelected = useRef(false);
  const extensionAvailable = Boolean(globalThis.chrome?.runtime?.id);

  /** 先显示仍可复用的课程，再读取 Blackboard 最新目录。 */
  const refreshCourses = useCallback(async function refreshCourses() {
    if (!extensionAvailable) return;
    const token = ++discoverySequence.current;
    setDiscovering(true); setConnectionError('');
    /** 只提交这次仍在运行的课程读取，保留仍有效的课程选择。 */
    function show(snapshot: CourseBrowseSnapshot) {
      if (!mounted.current || token !== discoverySequence.current) return;
      if (snapshot.cacheScope && revokedScopes.current.has(snapshot.cacheScope)) return;
      setBrowse(snapshot);
      setSelectedId(/** 课程仍可见时保留选择。 */ function preserveSelection(previous) {
        if (snapshot.discovery.courses.some(/** 检查先前选择。 */ function hasPrevious(course) { return course.courseId === previous; })) return previous;
        manuallySelected.current = false;
        return defaultCourse(snapshot.discovery);
      });
    }
    try {
      if (!discoveryRequest.current) {
        const cached = readCachedCourses().catch(/** 缓存不可用时仍执行实时读取。 */ function cacheMiss() { return null; });
        const fresh = cached.then(discoverCourses);
        const request = { cached, fresh };
        discoveryRequest.current = request;
        /** 结束后释放共用请求；StrictMode 二次挂载在请求期间复用同一采集任务。 */
        function releaseRequest() { if (discoveryRequest.current === request) discoveryRequest.current = null; }
        void fresh.then(releaseRequest, releaseRequest);
      }
      const { cached, fresh } = discoveryRequest.current;
      const snapshot = await cached;
      if (snapshot) show(snapshot);
      show(await fresh);
      if (mounted.current && token === discoverySequence.current) setNeedsReload(false);
    } catch (error) {
      if (!mounted.current || token !== discoverySequence.current) return;
      if (error instanceof AppError && ['login_required', 'consent_required', 'account_unknown', 'course_changed', 'browse_context_changed', 'extension_reload_required'].includes(error.code)) setBrowse(null);
      setConnectionError(friendlyError(error));
      setNeedsReload(error instanceof AppError && error.code === 'extension_reload_required');
    }
    finally { if (mounted.current && token === discoverySequence.current) setDiscovering(false); }
  }, [extensionAvailable]);

  /** 初次打开读取受信设置并连接课程；普通开发网页只显示安装后的入口。 */
  useEffect(function initialize() {
    mounted.current = true;
    let alive = true;
    const revision = settingsRevision.current;
    /** 读取凭据时只更新当前挂载侧栏，不向后台或页面发送。 */
    async function readSettings() { try { const loaded = await loadSettings(); if (alive && revision === settingsRevision.current) setSettings(loaded); } catch { if (alive) setNotice('设置暂时无法读取，请重新打开侧栏。'); } }
    /** 登录切换会撤下旧范围内已经显示的课程和目录。 */
    function cacheChanged(changes: Record<string, chrome.storage.StorageChange>, area: string) {
      if (area !== 'session') return;
      const change = changes[BROWSE_CACHE_KEY];
      const scope = (change?.oldValue as { scope?: unknown } | undefined)?.scope;
      const next = (change?.newValue as { scope?: unknown } | undefined)?.scope;
      if (typeof scope !== 'string' || scope === next) return;
      revokedScopes.current.add(scope);
      setBrowse(/** 较新的账号结果不受旧缓存失效影响。 */ function invalidate(previous) { return previous?.cacheScope === scope ? null : previous; });
    }
    if (extensionAvailable) chrome.storage.onChanged.addListener(cacheChanged);
    void readSettings(); void refreshCourses();
    /** 卸载侧栏时终止模型请求，阻止晚到的回答改变会话。 */
    return function cleanup() {
      if (extensionAvailable) chrome.storage.onChanged.removeListener(cacheChanged);
      alive = false; mounted.current = false; running.current = false; discoverySequence.current += 1; sequence.current += 1; controller.current?.abort();
    };
  }, [extensionAvailable, refreshCourses]);

  /** 切换用户明确选择的课程，后续歧义课程以该选择为准。 */
  function selectCourse(courseId: string) { manuallySelected.current = true; setSelectedId(courseId); setNotice(''); }

  /** 设置变更只持久化到扩展受信本地存储；成功后立即更新主题和模型配置。 */
  async function updateSettings(next: Settings) { settingsRevision.current += 1; await saveSettings(next); if (mounted.current) { setSettings(next); setNotice(''); } }

  /** 只替换正在执行的会话条目，保留之前提问的证据与结果。 */
  function updateTurn(id: number, changes: Partial<Turn>) {
    setTurns(/** 按稳定会话 ID 合并异步阶段，避免替换其他问题。 */ function merge(previous) { return previous.map(/** 仅更新目标条目。 */ function change(turn) { return turn.id === id ? { ...turn, ...changes } : turn; }); });
  }

  /** 运行一轮问答；默认实时刷新对应资料，模型重试则复用明确显示检索时间的证据。 */
  async function run(question: string, course: Course, previousSnapshot?: AnnouncementSnapshot, retryId?: number) {
    if (running.current) return;
    running.current = true;
    const token = ++sequence.current;
    const id = retryId ?? Date.now();
    const abort = new AbortController(); controller.current = abort;
    if (course.courseId !== selectedId) manuallySelected.current = false;
    setBusy(true); setNotice(''); setSelectedId(course.courseId);
    if (retryId) updateTurn(id, { error: undefined, answer: undefined, progress: undefined, stage: previousSnapshot ? 'answering' : 'reading' });
    else setTurns(/** 添加问题到本侧栏会话，不持久化问题内容。 */ function append(previous) { return [...previous, { id, question, course, stage: 'reading' }]; });
    let snapshot = previousSnapshot;
    try {
      const deadlineQuestion = isAssignmentDeadlineQuestion(question);
      if (!snapshot) snapshot = await (deadlineQuestion ? collectDeadlineSources(course) : collectAnnouncements(course));
      if (token !== sequence.current) return;
      updateTurn(id, { snapshot, stage: 'answering' }); setConnectionError('');
      const answer = deadlineQuestion ? answerAssignmentDeadlines(question, snapshot) : await askDeepSeek({ question, snapshot, apiKey: settings.apiKey, model: settings.model, signal: abort.signal,
        /** 只更新仍有效的同一轮状态，取消后忽略迟到提示。 */
        onProgress(progress) { if (token === sequence.current) updateTurn(id, { progress: progress.state === 'retrying' ? '连接暂时不稳定，正在自动重试（2/2）…' : progress.state === 'waiting' ? `模型仍在响应中（${progress.attempt}/2），无需手动重试，可随时停止。` : progress.attempt > 1 ? '正在重新连接模型（2/2）…' : undefined }); },
      });
      if (token !== sequence.current) return;
      updateTurn(id, { answer, stage: 'done' });
    } catch (error) {
      if (token !== sequence.current) return;
      if (error instanceof AppError && error.code === 'extension_reload_required') { setNeedsReload(true); setConnectionError(friendlyError(error)); }
      updateTurn(id, { error: friendlyError(error), snapshot, stage: 'error' });
    } finally { if (token === sequence.current) { running.current = false; setBusy(false); controller.current = null; } }
  }

  /** 校验课程与密钥后接受问题；返回 false 时输入应保留以便用户修正。 */
  function ask(question: string): boolean {
    const text = question.trim();
    if (running.current || !text) return false;
    if (!settings.apiKey && !isAssignmentDeadlineQuestion(text)) { setNotice('请先在设置中添加 DeepSeek API 密钥。'); return false; }
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
  function retry(turn: Turn) { if (running.current) return; if (!settings.apiKey && !isAssignmentDeadlineQuestion(turn.question)) { setNotice('请先在设置中添加 DeepSeek API 密钥，再重试。'); return; } void run(turn.question, turn.course, turn.snapshot, turn.id); }

  return { settings, updateSettings, discovery, cacheScope: browse?.cacheScope, selectedId, selectCourse, discovering, refreshCourses, connectionError, needsReload, notice, turns, busy, ask, cancel, retry, extensionAvailable };
}
