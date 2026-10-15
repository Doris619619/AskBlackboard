/** 文件用途：根据作业列表原文直接回答截止时间，模型不可用时仍可使用，不推断最新发布或绝对日期。 */
import type { AnnouncementSnapshot, ModelAnswer, SourceEvidence } from '../shared/types';

/** 识别作业截止时间意图；普通公告问题仍走原有公告与AI问答路径。 */
export function isAssignmentDeadlineQuestion(question: string): boolean {
  return /作业|assignment|homework|\bhw\b/i.test(question) && /截止|最迟|什么时候|啥时候|哪天|几点|ddl|deadline|\bdue\b|\bwhen\b/i.test(question);
}

/** 提取带明确截止标签的原文段落，保留改期、宽限与否定表达，不猜测未写出的钟点。 */
export function deadlineQuotes(source: SourceEvidence): string[] {
  return source.body.split(/\n+|(?<=[。!?；;])\s*|(?<=\.)\s+(?=[A-Z])/u).map(/** 去除展示无关空白。 */ function trim(line) { return line.trim(); }).filter(/** 只保留带截止语义的原文，发布时间不作为截止时间。 */ function isDeadline(line) { return /\bdeadline\b|\bdue\s*(?:date|on\b|at\b|by\b|:|\d)|\bsubmit\b.*\bby\b|截止|最迟|提交时间/iu.test(line); });
}

/** 从标题或问题识别明确作业编号；不能将课程号、截止日期或“最新”当作编号。 */
function assignmentNumber(text: string): string | undefined { return text.match(/(?:assignment|homework|作业|\bhw)\s*(?:no\.?\s*|#\s*)?(\d+)\b/iu)?.[1]?.replace(/^0+(?=\d)/u, ''); }

/** 直接显示经过课程隔离的原文截止信息；多项作业全部列出，不用最近截止时间冒充最新发布。 */
export function answerAssignmentDeadlines(question: string, snapshot: AnnouncementSnapshot): ModelAnswer {
  const requested = assignmentNumber(question);
  const sources = snapshot.sources.filter(/** 来源必须是本轮所选课程的作业；指定编号时不能借其他作业的日期。 */ function relevant(source) { return source.kind === 'assignment' && source.courseId === snapshot.course.courseId && (!requested || assignmentNumber(source.title) === requested); });
  const citations: ModelAnswer['citations'] = [];
  const rows: string[] = [];
  for (const source of sources.slice(0, 20)) {
    const quotes = deadlineQuotes(source);
    rows.push(`${source.title}\n${quotes.length ? `截止信息原文：\n${quotes.join('\n')}` : '可见说明未识别到明确的截止字段，请展开原文核对。'}`);
    for (const quote of quotes) citations.push({ sourceId: source.sourceId, quote });
  }
  const scope = '读取范围：课程内容列表和作业说明，未进入提交页或读取附件。';
  const partial = snapshot.coverage.status === 'partial' ? '部分文件夹未读全，以下结果可能遗漏作业。\n\n' : '';
  const latest = /最新|latest|newest/i.test(question) && sources.length > 1 ? '页面没有可靠的发布时间，无法确认哪项是最新发布；列出已读作业供核对。\n\n' : '';
  const empty = requested ? `在已读取范围内未找到作业 ${requested}。` : '在已读取的课程内容列表中未发现可识别作业。';
  return { status: citations.length ? 'found' : 'not_found', mode: 'extracted', answer: `${partial}${latest}${rows.join('\n\n') || empty}${sources.length > 20 ? '\n\n这里只列前20项，其余请展开全部作业。' : ''}\n\n${scope}`, citations };
}
