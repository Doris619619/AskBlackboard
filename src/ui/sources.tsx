/** 文件用途：以可展开原文列表展示模型引用和已读取公告，并提供受约束的出处回跳。 */
import { useState } from 'react';
import { openSource } from '../shared/browser-client';
import { friendlyError } from '../shared/errors';
import type { AnnouncementSnapshot, Citation, SourceEvidence } from '../shared/types';
import { Icon } from './icons';

/** 按学校时区显示抓取时间；发布日期保留 Blackboard 的原始文字。 */
export function formatFetchedTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}

/** 呈现一条来源及引用；回跳失败在本条目展示可恢复提示。 */
function SourceRow({ source, quotes = [] }: { source: SourceEvidence; quotes?: string[] }) {
  const [error, setError] = useState('');
  const [opening, setOpening] = useState(false);
  /** 由后台在正常 Blackboard 标签页打开并高亮，不使用模型生成链接。 */
  async function handleOpen() {
    setOpening(true); setError('');
    try { await openSource(source, quotes[0]); } catch (caught) { setError(friendlyError(caught)); }
    finally { setOpening(false); }
  }
  return <details className="source-row" open={quotes.length > 0 ? true : undefined}>
    <summary><span className="source-title">{source.title}</span><Icon name="chevron" /></summary>
    <div className="source-detail">
      {source.publishedAt && <p className="source-date">发布于 {source.publishedAt}</p>}
      {quotes.map(/** 同一公告的多段引用保留原文，避免重复来源标题。 */ function renderQuote(quote) { return <blockquote key={quote}>{quote}</blockquote>; })}
      <p className="source-path">{source.breadcrumb.join(' › ')}</p>
      <button type="button" className="text-button source-open" onClick={handleOpen} disabled={opening}><span>{opening ? '正在打开…' : source.kind === 'assignment' ? '打开作业所在列表' : '打开公告原文'}</span><Icon name="external" /></button>
      {error && <p className="inline-error" role="alert">{error}</p>}
      <details className="full-text"><summary>完整来源正文</summary><p>{source.body}</p></details>
    </div>
  </details>;
}

/** 先展示被校验的引用，再让用户展开本次读取的全部公告。 */
export function Sources({ snapshot, citations = [] }: { snapshot: AnnouncementSnapshot; citations?: Citation[] }) {
  const grouped = new Map<string, { source: SourceEvidence; quotes: string[] }>();
  for (const citation of citations) {
    const source = snapshot.sources.find(/** 根据已采集 ID 连接来源，不使用模型生成的路径。 */ function findSource(item) { return item.sourceId === citation.sourceId; });
    if (!source) continue;
    const group = grouped.get(source.sourceId) ?? { source, quotes: [] };
    if (!group.quotes.includes(citation.quote)) group.quotes.push(citation.quote);
    grouped.set(source.sourceId, group);
  }
  const cited = [...grouped.values()];
  return <div className="sources">
    {cited.length > 0 && <div className="cited-sources"><p className="section-caption">引用来源 · {cited.length}</p>{cited.map(/** 直接展示引用原话，同一公告只显示一个条目。 */ function renderCitation(item) { return <SourceRow key={item.source.sourceId} source={item.source} quotes={item.quotes} />; })}</div>}
    <details className="all-sources"><summary><span>{snapshot.scope === 'deadlines' ? '已查公告与作业说明' : snapshot.scope === 'assignments' ? '已查作业说明' : '已查课程公告'} · {snapshot.sources.length} 条</span><Icon name="chevron" /></summary><div className="all-sources-list">{snapshot.scope === 'deadlines' && <p className="muted">读取范围：课程公告、内容列表中的作业说明；不读取附件或提交页。</p>}{snapshot.sources.length === 0 ? <p className="muted">已读范围没有可见条目。</p> : snapshot.sources.map(/** 展开全部公告时不筛掉可能被模型遗漏的条目。 */ function renderSource(source) { return <SourceRow key={source.sourceId} source={source} />; })}</div></details>
    <p className="retrieval-time">检索于 {formatFetchedTime(snapshot.fetchedAt)}（北京时间）{snapshot.coverage.status === 'partial' ? ' · 读取不完整' : ''}</p>
    {snapshot.coverage.warnings.length > 0 && <p className="inline-error">{snapshot.coverage.warnings.join('；')}</p>}
  </div>;
}
