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
function SourceRow({ source, quote, cited = false }: { source: SourceEvidence; quote?: string; cited?: boolean }) {
  const [error, setError] = useState('');
  const [opening, setOpening] = useState(false);
  /** 由后台在正常 Blackboard 标签页打开并高亮，不使用模型生成链接。 */
  async function handleOpen() {
    setOpening(true); setError('');
    try { await openSource(source, quote); } catch (caught) { setError(friendlyError(caught)); }
    finally { setOpening(false); }
  }
  return <details className="source-row" open={cited || undefined}>
    <summary><span className="source-title">{source.title}</span><Icon name="chevron" /></summary>
    <div className="source-detail">
      {source.publishedAt && <p className="source-date">发布于 {source.publishedAt}</p>}
      {quote && <blockquote>{quote}</blockquote>}
      <p className="source-path">{source.breadcrumb.join(' › ')}</p>
      <button type="button" className="text-button source-open" onClick={handleOpen} disabled={opening}><span>{opening ? '正在打开…' : '打开公告原文'}</span><Icon name="external" /></button>
      {error && <p className="inline-error" role="alert">{error}</p>}
      <details className="full-text"><summary>完整公告正文</summary><p>{source.body}</p></details>
    </div>
  </details>;
}

/** 先展示被校验的引用，再让用户展开本次读取的全部公告。 */
export function Sources({ snapshot, citations = [] }: { snapshot: AnnouncementSnapshot; citations?: Citation[] }) {
  const cited = citations.map(/** 根据 ID 连接真实来源；模型无法通过此映射生成新路径。 */ function mapCitation(citation) { const source = snapshot.sources.find(/** 查找已读取公告。 */ function findSource(item) { return item.sourceId === citation.sourceId; }); return source ? { source, quote: citation.quote } : null; }).filter(/** 忽略缺失来源，契约校验通常已拒绝这种回答。 */ function hasSource(item): item is { source: SourceEvidence; quote: string } { return item !== null; });
  return <div className="sources">
    {cited.length > 0 && <div className="cited-sources"><p className="section-caption">信息来源 · {cited.length}</p>{cited.map(/** 每条引用显示原文和路径；不同引用允许来自同一公告。 */ function renderCitation(item, index) { return <SourceRow key={`${item.source.sourceId}-${index}`} source={item.source} quote={item.quote} cited />; })}</div>}
    <details className="all-sources"><summary><span>已查课程公告 · {snapshot.sources.length} 条</span><Icon name="chevron" /></summary><div className="all-sources-list">{snapshot.sources.length === 0 ? <p className="muted">该课程当前没有可见公告。</p> : snapshot.sources.map(/** 展开全部公告时不筛掉可能被模型遗漏的条目。 */ function renderSource(source) { return <SourceRow key={source.sourceId} source={source} />; })}</div></details>
    <p className="retrieval-time">检索于 {formatFetchedTime(snapshot.fetchedAt)}（北京时间）{snapshot.coverage.status === 'partial' ? ' · 读取不完整' : ''}</p>
    {snapshot.coverage.warnings.length > 0 && <p className="inline-error">{snapshot.coverage.warnings.join('；')}</p>}
  </div>;
}
