/** 文件用途：构成 AskBlackboard 侧栏工作区，展示课程、会话和原文来源并提供设置入口。 */
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Icon } from './icons';
import { SettingsDialog } from './settings-dialog';
import { Sources } from './sources';
import { useAssistant } from './use-assistant';
import type { Turn } from './use-assistant';
import { isAssignmentDeadlineQuestion } from '../blackboard/deadlines';
import { reloadExtension } from '../shared/browser-client';

/** 展示单次问题的进行状态或有出处回答；模型失败时依然提供已经读取的资料。 */
function ConversationTurn({ turn, busy, onRetry }: { turn: Turn; busy: boolean; onRetry: (turn: Turn) => void }) {
  const working = turn.stage === 'reading' || turn.stage === 'answering';
  const answerLabels = { found: 'AI · 根据课程公告', not_found: '未找到明确说明', conflict: '公告存在冲突' };
  return <article className="conversation-turn">
    <div className="question-message"><p>{turn.question}</p></div>
    <div className="assistant-message">
      <p className="answer-label"><span className="mini-brand"><Icon name="book" /></span><span>{turn.course.code}{turn.course.section ? ` · ${turn.course.section}` : ''}</span><span className="answer-term">{turn.course.termLabel}</span></p>
      {working && <div className="progress-message" role="status"><span className="activity-dot" />{turn.stage === 'reading' ? (isAssignmentDeadlineQuestion(turn.question) ? '正在读取作业列表和截止信息…' : '正在读取最新课程公告…') : turn.progress || '正在核对问题与公告原文…'}</div>}
      <div className="answer-content" role="status" aria-atomic="true">{turn.answer && <><p className="answer-status">{turn.answer.mode === 'extracted' ? '课程页面 · 直接读取，不依赖 AI' : answerLabels[turn.answer.status]}</p><p className="answer-text">{turn.answer.answer}</p></>}</div>
      {turn.error && <div className="turn-error" role="alert"><p>{turn.error}</p><button className="text-button" type="button" disabled={busy} onClick={/** 使用现有证据重试本条问题。 */ function handleRetry() { onRetry(turn); }}><Icon name="refresh" /><span>重试{turn.snapshot ? '回答' : '读取'}</span></button></div>}
      {turn.stage === 'cancelled' && <div className="turn-error" role="status"><p>已停止。{turn.snapshot ? '已读取的资料保留在下面。' : '尚未完成资料读取。'}</p><button className="text-button" type="button" disabled={busy} onClick={/** 停止后仍允许继续该问题。 */ function handleResume() { onRetry(turn); }}>重新尝试</button></div>}
      {turn.snapshot && <Sources snapshot={turn.snapshot} citations={turn.answer?.citations} />}
    </div>
  </article>;
}

/** 构成可缩放的窄侧栏：课程导航、可滚动问答区和常驻输入，不展示虚构课程或结果。 */
export function App() {
  const assistant = useAssistant();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const textarea = useRef<HTMLTextAreaElement>(null);
  const settingsButton = useRef<HTMLButtonElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const currentCourse = assistant.discovery?.courses.find(/** 课程 ID 唯一对应顶部选择。 */ function findSelected(course) { return course.courseId === assistant.selectedId; });
  const hasTurns = assistant.turns.length > 0;

  /** 将外观选择应用到根节点，系统模式由 CSS 跟随操作系统。 */
  useEffect(function applyTheme() { document.documentElement.dataset.theme = assistant.settings.theme; }, [assistant.settings.theme]);

  /** 新问题或新状态到达时保持最近进展可见，减少动画用户不使用平滑滚动。 */
  useEffect(function showLatest() { end.current?.scrollIntoView({ behavior: 'auto', block: 'end' }); }, [assistant.turns]);

  /** 仅根据草稿调整输入高度，上限交给 CSS，长输入仍可在框内滚动。 */
  useEffect(function resizeComposer() { if (textarea.current) { textarea.current.style.height = 'auto'; textarea.current.style.height = `${Math.min(textarea.current.scrollHeight, 160)}px`; } }, [draft]);

  /** 提交问题前打开缺失密钥的设置；接受成功后才清空输入。 */
  function submitQuestion() {
    if (!draft.trim() || assistant.busy) return;
    if (!assistant.settings.apiKey && !isAssignmentDeadlineQuestion(draft)) { setSettingsOpen(true); return; }
    if (assistant.ask(draft)) setDraft('');
  }

  /** Enter 发送、Shift+Enter 换行；中文输入法确认字符时不触发发送。 */
  function handleComposerKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) { event.preventDefault(); submitQuestion(); }
  }

  /** 示例只填充输入，由用户发送后读取真实公告并产生回答。 */
  function useExample(question: string) { setDraft(question); textarea.current?.focus(); }

  /** 对话框卸载后恢复到设置按钮，避免 Escape 或保存后键盘焦点丢到页面根节点。 */
  function closeSettings() {
    setSettingsOpen(false);
    /** 等待 React 移除模态节点，再把焦点交还给仍存在的触发按钮。 */
    function restoreSettingsFocus() { settingsButton.current?.focus(); }
    requestAnimationFrame(restoreSettingsFocus);
  }

  return <div className="app-shell">
    <header className="app-header"><div className="brand"><span className="brand-mark"><Icon name="book" /></span><h1>AskBlackboard</h1></div><button ref={settingsButton} type="button" className="icon-button" aria-label="打开设置" title="设置" onClick={/** 点击设置按钮打开个人配置。 */ function showSettings() { setSettingsOpen(true); }}><Icon name="settings" /></button></header>
    <section className="course-context" aria-label="课程和连接状态">
      <div className="course-controls"><label className="sr-only" htmlFor="course-select">选择课程和教学班</label><div className="course-picker"><select id="course-select" value={assistant.selectedId} disabled={assistant.discovering || assistant.busy || !assistant.discovery} onChange={/** 选择课程同时明确歧义课程的班组。 */ function changeCourse(event) { assistant.selectCourse(event.target.value); }}><option value="">{assistant.discovering ? '正在读取课程…' : assistant.discovery ? '选择一门课程' : '等待连接课程'}</option>{assistant.discovery?.courses.map(/** 每项包含学期与班组，避免同编号课程难以区分。 */ function renderCourse(course) { return <option key={course.courseId} value={course.courseId}>{course.code}{course.section ? ` · ${course.section}` : ''}{course.termLabel ? ` · ${course.termLabel}` : ''}</option>; })}</select><Icon name="chevron" /></div><button type="button" className="icon-button refresh-courses" aria-label="刷新课程" title="刷新课程" disabled={assistant.discovering || assistant.busy || !assistant.extensionAvailable} onClick={assistant.refreshCourses}><Icon name="refresh" /></button></div>
      <div className="connection-line"><span className={`connection-dot ${assistant.discovery && !assistant.connectionError ? 'connected' : ''}`} /><span>{assistant.discovering ? '正在连接 Blackboard' : assistant.connectionError ? '连接需要恢复' : assistant.discovery ? '已连接 Blackboard' : assistant.extensionAvailable ? '请登录 Blackboard' : '在浏览器扩展中使用'}</span><span className="term-label">公告与作业</span></div>
      {assistant.connectionError && <p className="context-error" role="alert">{assistant.connectionError}</p>}
      {assistant.needsReload && <div><button type="button" className="text-button" onClick={reloadExtension}><Icon name="refresh" /><span>重新加载插件</span></button><p className="composer-caption">会关闭侧栏，请重新打开；已保存的密钥会保留。</p></div>}
    </section>
    <main className="workspace" aria-label="课程问答">
      {!hasTurns && <div className="empty-state"><span className="empty-book"><Icon name="book" width="24" height="24" /></span><h2>课程里的事，直接问。</h2><p>写上课程号或简称，<br />查课程公告和作业截止。</p><div className="example-list">{['GEB 的 presentation 是什么时候？', 'ECE4016 最新的作业什么时候截止？'].map(/** 示例只填入草稿，用户确认后才读取公告。 */ function renderExample(question) { return <button key={question} type="button" className="example-question" onClick={/** 将对应示例放入草稿并聚焦输入。 */ function fillExample() { useExample(question); }}><span>{question}</span><Icon name="arrow" /></button>; })}</div>{!assistant.settings.apiKey && <button type="button" className="text-button setup-link" onClick={/** 首次使用提供直达密钥设置的入口。 */ function setupConnection() { setSettingsOpen(true); }}>设置 DeepSeek 连接</button>}</div>}
      {assistant.turns.map(/** 会话按提问顺序显示，不隐藏采集失败的条目。 */ function renderTurn(turn) { return <ConversationTurn key={turn.id} turn={turn} busy={assistant.busy} onRetry={assistant.retry} />; })}
      <div ref={end} />
    </main>
    <footer className="composer-region">
      {assistant.notice && <p className="composer-notice" role="alert">{assistant.notice}</p>}
      <form className="composer" onSubmit={/** 表单提交覆盖辅助技术和触摸键盘发送。 */ function handleSubmit(event) { event.preventDefault(); submitQuestion(); }}>
        <label className="sr-only" htmlFor="question">输入课程问题</label><textarea ref={textarea} id="question" rows={1} placeholder="问课程里的事…" value={draft} disabled={assistant.busy} onChange={/** 草稿停留在侧栏内，发送成功后清空。 */ function changeDraft(event) { setDraft(event.target.value); }} onKeyDown={handleComposerKey} />
        {assistant.busy ? <button type="button" className="send-button stop-button" aria-label="停止回答" title="停止" onClick={assistant.cancel}><Icon name="stop" /></button> : <button type="submit" className="send-button" disabled={!draft.trim()} aria-label="发送问题" title="发送"><Icon name="arrow" /></button>}
      </form><p className="composer-caption">{assistant.busy ? '正在查询 · 可随时停止' : currentCourse ? `未指定课程时查询 ${currentCourse.code} · Enter 发送` : '写课程号或简称 · Enter 发送'}</p>
    </footer>
    {settingsOpen && <SettingsDialog settings={assistant.settings} onSave={assistant.updateSettings} onClose={closeSettings} extensionAvailable={assistant.extensionAvailable} />}
  </div>;
}
