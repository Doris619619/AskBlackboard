/** 文件用途：按学期和教师目录浏览课件，并在同一课程的目录之间保留勾选。 */
import { useEffect, useRef, useState } from 'react';
import { coursewareFileExtension } from '../blackboard/courseware-policy';
import { collectCourseware, reloadExtension } from '../shared/browser-client';
import type { CoursewareFolder, CoursewareListing, CoursewareSelection } from '../shared/courseware-types';
import { AppError, friendlyError } from '../shared/errors';
import type { Course, CourseDiscovery } from '../shared/types';
import { Icon } from './icons';
import { coursewareSelectionKey, useCoursewareDownload } from './courseware-download-flow';
import { CoursewareDownloadResults, CoursewareDownloadStatus } from './courseware-download-page';
import { coursewareFileLabel, coursewareTitle } from './courseware-title';

interface PanelProps {
  hidden: boolean;
  discovery: CourseDiscovery | null;
  discovering: boolean;
  connectionError: string;
  needsReload: boolean;
  extensionAvailable: boolean;
  refreshCourses: () => void;
}

interface DirectoryPage {
  folder?: CoursewareFolder;
  listing?: CoursewareListing;
  error?: string;
  diagnostic?: string;
  needsReload?: boolean;
}

/** 按发现顺序组织课程，并将当前学期移到最前。 */
function groupCourses(discovery: CourseDiscovery | null) {
  if (!discovery) return [];
  const groups = new Map<string, Course[]>();
  for (const course of discovery.courses) {
    const group = groups.get(course.termId);
    if (group) group.push(course);
    else groups.set(course.termId, [course]);
  }
  const current = groups.get(discovery.currentTermId);
  groups.delete(discovery.currentTermId);
  return current ? [[discovery.currentTermId, current] as const, ...groups] : [...groups];
}

/** 使用问答已发现的可见课程，但以独立状态浏览课件及学期。 */
export function CoursewarePanel({ hidden, discovery, discovering, connectionError, needsReload, extensionAvailable, refreshCourses }: PanelProps) {
  const [courseId, setCourseId] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  const course = discovery?.courses.find(/** 课程 ID 区分不同学期或教学班。 */ function match(item) { return item.courseId === courseId; });

  /** 回到课程索引，把键盘焦点带回当前页面标题。 */
  function returnToCourses() {
    setCourseId('');
    requestAnimationFrame(/** 等课程索引重新渲染后聚焦。 */ function restoreFocus() { heading.current?.focus(); });
  }

  return <section className="courseware-shell" hidden={hidden} aria-label="课件工作区">
    {course ? <CoursewareCourse key={JSON.stringify([discovery?.accountName, course.courseId])} course={course} returnToCourses={returnToCourses} /> : <main className="workspace courseware-view" aria-label="课程课件">
      <div className="courseware-heading">
        <h2 ref={heading} tabIndex={-1} className="courseware-title">课程课件</h2>
        {extensionAvailable && <button type="button" className="icon-button refresh-courses" aria-label="刷新课程" title="刷新课程" disabled={discovering} onClick={refreshCourses}><Icon name="refresh" /></button>}
      </div>
      {discovering && <p role="status" className="muted">正在读取课程…</p>}
      {connectionError && <p role="alert" className="inline-error">{connectionError}</p>}
      {needsReload && <button type="button" className="text-button" onClick={reloadExtension}>重新加载插件</button>}
      {!discovery && !discovering && !connectionError && <p className="muted">{extensionAvailable ? '请先登录 Blackboard，再刷新课程。' : '加载浏览器扩展后即可查看课程课件。'}</p>}
      {discovery && !discovery.courses.length && <p className="muted">当前账号没有可见课程。</p>}
      {groupCourses(discovery).map(/** 每个学期保留所有已发现课程及其教学班。 */ function renderTerm([termId, courses]) {
        return <section className="courseware-term" key={termId}>
          <h3>{courses[0].termLabel || termId || '未标注学期'}</h3>
          <ul className="courseware-list">
            {courses.map(/** 课程行进入课件目录，不更改问答的课程。 */ function renderCourse(item) {
              return <li key={item.courseId}><button type="button" className="courseware-entry" onClick={/** 选择此课件课程。 */ function openCourse() { setCourseId(item.courseId); }}>
                <strong>{coursewareTitle(item)}</strong><Icon name="chevron" />
              </button></li>;
            })}
          </ul>
        </section>;
      })}
    </main>}
  </section>;
}

/** 仅展示本轮失败附带的诊断文本，并在用户点击时写入剪贴板。 */
function CoursewareDiagnostic({ diagnostic }: { diagnostic: string }) {
  const log = useRef<HTMLPreElement>(null);
  const [copyStatus, setCopyStatus] = useState('');

  /** 剪贴板不可用时选中日志，便于通过键盘手动复制。 */
  async function copyDiagnostic(): Promise<void> {
    try {
      await navigator.clipboard.writeText(diagnostic);
      setCopyStatus('已复制诊断日志');
    } catch {
      const selection = window.getSelection();
      const element = log.current;
      if (!selection || !element) {
        setCopyStatus('复制失败，请手动选择并复制日志。');
        return;
      }
      element.focus();
      const range = document.createRange();
      range.selectNodeContents(element);
      selection.removeAllRanges();
      selection.addRange(range);
      setCopyStatus('已选中诊断日志，请手动复制。');
    }
  }

  return <details className="courseware-results courseware-diagnostic">
    <summary>诊断详情<Icon name="chevron" /></summary>
    <pre ref={log} tabIndex={-1}>{diagnostic}</pre>
    <button type="button" className="text-button" onClick={copyDiagnostic}>复制诊断日志</button>
    <p className="courseware-diagnostic-status" role="status">{copyStatus}</p>
  </details>;
}

/** 在教师栏目内逐层读取目录，管理同一课程的勾选和保存结果。 */
function CoursewareCourse({ course, returnToCourses }: { course: Course; returnToCourses: () => void }) {
  const [pages, setPages] = useState<DirectoryPage[]>([{}]);
  const [selection, setSelection] = useState<Map<string, CoursewareSelection>>(new Map());
  const [savedExtensions, setSavedExtensions] = useState<Map<string, string>>(new Map());
  const heading = useRef<HTMLHeadingElement>(null);
  const selectAll = useRef<HTMLInputElement>(null);
  const download = useCoursewareDownload(true, removeSelections, rememberSavedExtension);
  const page = pages.at(-1)!;
  const { folder, listing } = page;
  const folders = pages.flatMap(/** 使用当前路径上的教师栏目构建选择。 */ function directory(item) { return item.folder ? [item.folder] : []; });
  const entries = listing?.items ?? [];
  const files = entries.flatMap(/** 当前页的全选仅包含已列出文件。 */ function fileSelection(item) { return item.kind === 'file' ? [{ file: item, folders }] : []; });
  const selectedHere = files.filter(/** 只用当前目录的已勾选文件确定全选状态。 */ function isSelected(item) { return selection.has(coursewareSelectionKey(item)); }).length;
  const allSelected = files.length > 0 && selectedHere === files.length;
  const busy = download.stage !== 'idle';

  /** 打开或刷新目录时读取，返回上一级则直接恢复当时的列表。 */
  useEffect(function loadFolder() {
    if (page.listing || page.error) return;
    let current = true;
    /** 将结果应用于同一次打开。登录或课程校验失败时丢弃先前显示的上级列表。 */
    function finish(result: DirectoryPage, invalidateParents = false) {
      if (!current) return;
      setPages(/** 对比请求对应的页面，防止覆盖随后切换的路径。 */ function replace(previous) {
        if (previous.at(-1) !== page) return previous;
        const parents = previous.slice(0, -1);
        return [...(invalidateParents ? parents.map(/** 保留栏目路径，返回时重新读取。 */ function withoutListing(parent) { return { folder: parent.folder }; }) : parents), result];
      });
    }
    /** 完成读取时仍处于本次打开的目录才显示结果。 */
    async function load() {
      try {
        finish({ folder, listing: await collectCourseware(course, folder) });
      } catch (error) {
        const appError = error instanceof AppError ? error : undefined;
        finish({
          folder,
          error: friendlyError(error),
          diagnostic: appError?.diagnostic,
          needsReload: appError?.code === 'extension_reload_required',
        }, Boolean(appError && ['login_required', 'consent_required', 'course_changed', 'course_mismatch', 'account_unknown', 'extension_reload_required'].includes(appError.code)));
      }
    }
    void load();
    /** 读取完成前离开目录时放弃该次结果。 */
    return function ignoreLateResult() { current = false; };
  }, [course, folder, page]);

  /** 路径改变后把焦点放在新目录标题，避免键盘焦点留在被替换的条目上。 */
  useEffect(function focusDirectory() { heading.current?.focus(); }, [folder]);

  /** 部分文件已勾选时使用复选框原生的半选状态。 */
  useEffect(function setPartialSelection() {
    if (selectAll.current) selectAll.current.indeterminate = selectedHere > 0 && !allSelected;
  }, [allSelected, selectedHere]);

  /** 根据已提交保存或已交接的条目更新勾选，避免连续点击生成副本。 */
  function removeSelections(items: CoursewareSelection[]) { updateSelection(items, false); }

  /** 成功保存后，在当前课程内补上实际落盘的文件格式。 */
  function rememberSavedExtension(item: CoursewareSelection, path: string) {
    const extension = coursewareFileExtension(path);
    if (!extension) return;
    setSavedExtensions(/** 保留本次浏览中其他已确认的格式。 */ function remember(previous) {
      return previous.get(item.file.id) === extension ? previous : new Map(previous).set(item.file.id, extension);
    });
  }

  /** 只改变指定项目的勾选，保留其他已浏览目录中的选择。 */
  function updateSelection(items: CoursewareSelection[], checked: boolean) {
    setSelection(/** 根据最新勾选合并增量，下载回调不会覆盖刚发生的其他更新。 */ function apply(previous) {
      const next = new Map(previous);
      for (const item of items) {
        const key = coursewareSelectionKey(item);
        if (checked) next.set(key, item);
        else next.delete(key);
      }
      return next;
    });
  }

  /** 重新读取当前目录，保留路径和已勾选的文件。 */
  function refreshListing() {
    heading.current?.focus();
    setPages([...pages.slice(0, -1), { folder }]);
  }

  /** 从下载按钮的直接点击进入目录选择器，冻结本批勾选。 */
  function downloadSelected() { void download.start({ course, files: [...selection.values()] }); }

  return <>
    <main className="workspace courseware-view" aria-label="课程课件">
      <div className="courseware-back">
        {folder && <button type="button" className="text-button" disabled={busy} onClick={/** 恢复上一层此前显示的列表。 */ function goBack() { setPages(pages.slice(0, -1)); }}><Icon name="chevron" />返回上一层</button>}
        <button type="button" className="text-button" disabled={busy} onClick={returnToCourses}>{folder ? '返回课程列表' : <><Icon name="chevron" />返回课程列表</>}</button>
        {listing && <button type="button" className="text-button" disabled={busy} onClick={refreshListing}>刷新目录</button>}
      </div>
      <h2 ref={heading} tabIndex={-1} className="courseware-title">{folder?.name ?? coursewareTitle(course)}</h2>
      <p className="courseware-path">{folder ? [course.code, ...folders.map(/** 使用老师的原始目录名。 */ function name(item) { return item.name; })].join(' / ') : course.termLabel}</p>
      <CoursewareDownloadResults report={download.report} />
      {!listing && !page.error && <p role="status" className="muted">正在读取{folder ? '目录' : '课件栏目'}…</p>}
      {page.error && <div>
        <p role="alert" className="inline-error">{page.error}</p>
        <button type="button" className="text-button" disabled={busy} onClick={page.needsReload ? reloadExtension : refreshListing}>{page.needsReload ? '重新加载插件' : '重试读取'}</button>
        {page.diagnostic && <CoursewareDiagnostic diagnostic={page.diagnostic} />}
      </div>}
      {listing && !entries.length && <p className="muted">{folder ? '当前目录没有可下载的课件。' : '这门课程没有可浏览的课件栏目。'}</p>}
      {files.length > 0 && <label className="courseware-file courseware-select-all">
        <input ref={selectAll} type="checkbox" checked={allSelected} disabled={busy} onChange={/** 只全选或取消当前目录中列出的文件。 */ function toggleAll(event) { updateSelection(files, event.target.checked); }} />全选当前目录
      </label>}
      {entries.length > 0 && <ul className="courseware-list">
        {entries.map(/** 保留目录页面的项目顺序，目录打开与文件勾选使用各自的原生控件。 */ function renderEntry(item) {
          if (item.kind === 'folder') return <li key={item.id}><button type="button" className="courseware-entry" disabled={busy || folders.some(/** 避免重复进入祖先链接。 */ function isAncestor(ancestor) { return ancestor.id === item.id; })} onClick={/** 保留父目录并进入所选子目录。 */ function openFolder() { setPages([...pages, { folder: item }]); }}><span>{item.name}</span><Icon name="chevron" /></button></li>;
          const choice = { file: item, folders };
          const label = coursewareFileLabel(item, savedExtensions.get(item.id));
          return <li key={item.id}><label className="courseware-file">
            <input type="checkbox" aria-label={label} checked={selection.has(coursewareSelectionKey(choice))} disabled={busy} onChange={/** 只修改当前文件的选择。 */ function toggleFile(event) { updateSelection([choice], event.target.checked); }} />
            <span>{label}</span>
          </label></li>;
        })}
      </ul>}
    </main>
    {(selection.size > 0 || download.report || download.notice || busy) && <footer className="courseware-actions">
      <CoursewareDownloadStatus download={download} />
      {selection.size > 0 && <button type="button" className="courseware-save" disabled={busy} onClick={downloadSelected}>下载 {selection.size} 个文件</button>}
    </footer>}
  </>;
}
