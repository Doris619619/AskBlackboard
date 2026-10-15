/** 文件用途：以时间、班组、原话和来源按钮呈现截止答案，避免将抓取实现说明混入正文。 */
import { useState } from 'react';
import type { AnnouncementSnapshot, ModelAnswer } from '../shared/types';
import { openSource } from '../shared/browser-client';
import { friendlyError } from '../shared/errors';
import { Icon } from './icons';

/** 单项时间只链接自己的原始证据；打开失败局部显示，不丢失答案。 */
function DeadlineItem({ fact, snapshot }: { fact: NonNullable<ModelAnswer['deadlines']>[number]; snapshot: AnnouncementSnapshot }) {
  const [error, setError] = useState(''); const [opening, setOpening] = useState(false);
  const source = snapshot.sources.find(/** 只用本轮真实来源生成回跳。 */ function find(item) { return item.sourceId === fact.sourceId; });
  /** 用户点击时在只读来源页定位引用，学校登录和凭据由浏览器管理。 */
  async function showSource() { if (!source) return; setOpening(true); setError(''); try { await openSource(source, fact.quote); } catch (caught) { setError(friendlyError(caught)); } finally { setOpening(false); } }
  return <section className="deadline-item">
    <p className="deadline-heading">{fact.section ? `${fact.section} · ` : ''}{fact.tentative ? '相关任务' : '截止时间'}</p>
    <p className="deadline-time">{fact.time}</p>
    <blockquote className="deadline-quote">{fact.quote}</blockquote>
    <button type="button" className="text-button deadline-source" onClick={showSource} disabled={!source || opening}><Icon name="external" /><span>{opening ? '正在打开…' : `来源：${fact.title}`}</span></button>
    {error && <p role="alert" className="inline-error">{error}</p>}
  </section>;
}

/** 先给可直接核对的结果，必要的不确定性保持短句，班组不同的时间分别展示。 */
export function DeadlineAnswer({ answer, snapshot }: { answer: ModelAnswer; snapshot: AnnouncementSnapshot }) {
  return <div className="deadline-answer">
    {answer.notices?.map(/** 范围不完整和候选关系不能藏在折叠区。 */ function notice(text) { return <p className="deadline-notice" key={text}>{text}</p>; })}
    {answer.deadlines?.map(/** 每个班组和来源独立呈现，不合并冲突日期。 */ function item(fact, index) { return <DeadlineItem key={`${fact.sourceId}:${index}`} fact={fact} snapshot={snapshot} />; })}
  </div>;
}
