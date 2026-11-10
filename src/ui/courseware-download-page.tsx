/** 文件用途：展示课件批次的保存结果，以及在扩展独立页接续一次性下载。 */
import { useEffect, useState } from 'react';
import { reloadExtension } from '../shared/browser-client';
import type { CoursewareSelection } from '../shared/courseware-types';
import { Icon } from './icons';
import { coursewareSelectionKey, takeCoursewareBatch, useCoursewareDownload, type CoursewareBatch, type CoursewareReport } from './courseware-download-flow';
import { coursewareFileLabel } from './courseware-title';

/** 计算本批已保存与失败的数量；尚未处理的文件不算失败。 */
function summarize(report: CoursewareReport) {
  const saved = report.results.filter(/** 只有已提交到目录的文件才计入成功。 */ function wasSaved(result) { return result.path !== undefined; }).length;
  return { saved, failed: report.results.length - saved };
}

/** 保留可见目录名，使不同目录中的同名文件能在下载结果里区分。 */
function visiblePath(selection: CoursewareSelection): string {
  return [...selection.folders.map(/** 保留老师设置的目录名称。 */ function folderName(folder) { return folder.name; }), coursewareFileLabel(selection.file)].join(' / ');
}

/** 在文件列表上方保留每项的落盘路径或安全的失败说明。 */
export function CoursewareDownloadResults({ report }: { report: CoursewareReport | null }) {
  if (!report?.results.length) return null;
  return <CoursewareResultDetails report={report} />;
}

/** 批量保存时更新摘要，详情展开后才绘制逐文件结果。 */
function CoursewareResultDetails({ report }: { report: CoursewareReport }) {
  const [expanded, setExpanded] = useState(false);
  const { saved, failed } = summarize(report);
  return <details className="courseware-results" open={failed > 0} onToggle={/** 与用户展开和失败项自动展开同步。 */ function toggle(event) { setExpanded(event.currentTarget.open); }}>
    <summary>下载结果 · 已保存 {saved} 个{failed ? ` · 失败 ${failed} 个` : ''}<Icon name="chevron" /></summary>
    {expanded && <ul>
      {report.results.map(/** 同名课件用来源目录区分，成功项直接显示实际落盘路径。 */ function renderResult(result) {
        return <li key={coursewareSelectionKey(result.selection)}>
          <span>{result.path ?? visiblePath(result.selection)}</span>
          {result.error && <p className="inline-error">{result.error}</p>}
        </li>;
      })}
    </ul>}
  </details>;
}

/** 在操作区公布批次进度并提供失败重试，供侧栏和独立页共用。 */
export function CoursewareDownloadStatus({ download }: { download: ReturnType<typeof useCoursewareDownload> }) {
  const { stage, report, notice, needsReload, retry } = download;
  const counts = report ? summarize(report) : null;
  return <>
    {stage === 'picking' && <p role="status" className="muted">正在选择保存目录…</p>}
    {stage === 'saving' && report && <p role="status" className="muted">正在保存 · {report.results.length} / {report.batch.files.length}</p>}
    {stage === 'idle' && counts && <p role="status" className="muted">已保存 {counts.saved} 个文件{counts.failed ? ` · 失败 ${counts.failed} 个` : ''}</p>}
    {notice && <p role={notice.error ? 'alert' : 'status'} className={notice.error ? 'inline-error' : 'muted'}>{notice.message}</p>}
    {needsReload && <button type="button" className="text-button" onClick={reloadExtension}>重新加载插件</button>}
    {stage === 'idle' && Boolean(counts?.failed) && <button type="button" className="text-button" onClick={retry}>重试失败项</button>}
  </>;
}

/** 在顶层扩展标签页接续已选课件，仍需独立点击并选定本地目录才请求文件。 */
export function CoursewareDownloadPage({ token }: { token: string }) {
  const [batch, setBatch] = useState<CoursewareBatch | null>();
  const download = useCoursewareDownload(false);

  /** 从受信会话取出并删除短期交接，加载失败或过期时请用户重新选择。 */
  useEffect(function loadHandoff() {
    let alive = true;
    /** 忽略已关闭页面的晚到交接。 */
    async function consume() {
      try {
        const result = await takeCoursewareBatch(token);
        if (alive) setBatch(result ?? null);
      } catch { if (alive) setBatch(null); }
    }
    void consume();
    /** 防止关闭页面后更新状态。 */
    return function dispose() { alive = false; };
  }, [token]);

  /** 在这次可信点击内打开顶层目录选择器。 */
  function chooseDirectory() { if (batch) void download.start(batch); }

  return <div className="app-shell">
    <header className="app-header"><div className="brand"><span className="brand-mark"><Icon name="book" /></span><h1>AskBlackboard</h1></div></header>
    <main className="workspace courseware-view" aria-label="课件下载">
      <h2 className="courseware-title">课件下载</h2>
      {batch === undefined && <p role="status" className="muted">正在读取勾选的课件…</p>}
      {batch === null && <p role="alert" className="inline-error">这批课件的下载链接已过期或已使用，请回到侧栏重新勾选。</p>}
      {batch && <>
        <p className="muted">{batch.course.code} · 已选 {batch.files.length} 个文件</p>
        <ul className="courseware-handoff-list">
          {batch.files.map(/** 显示来自侧栏的相对路径，便于在选择目录前核对。 */ function renderSelection(selection) {
            return <li key={coursewareSelectionKey(selection)}>{visiblePath(selection)}</li>;
          })}
        </ul>
        <CoursewareDownloadResults report={download.report} />
      </>}
    </main>
    {batch && <footer className="courseware-actions">
      <CoursewareDownloadStatus download={download} />
      {!download.report && <button type="button" className="courseware-save" disabled={download.stage !== 'idle'} onClick={chooseDirectory}>选择目录并保存</button>}
    </footer>}
  </div>;
}
