/** 文件用途：联合公告与作业证据，按任务和班组显示简短截止时间及原话，不依赖模型。 */
import type { AnnouncementSnapshot, ModelAnswer, SourceEvidence } from '../shared/types';
import { matchTask, requestedTask, taskReferences } from './deadline-task';
import { conciseDeadline } from './deadline-time';

/** 支持口语中英混写的报告、实验、项目和作业截止问题。 */
export function isAssignmentDeadlineQuestion(question: string): boolean {
  return /作业|assignment|homework|\bhw\d*|report|报告|lab|实验|project|项目|代码|\bcode/i.test(question) && /截止|最迟|什么时候|啥时候|哪天|几点|ddl|deadline|\bdue\b|\bwhen\b/i.test(question);
}

/** 保留整行原话与班组，避免拆散关联的任务名称；发布时间、上课时长不作为截止时间。 */
export function deadlineQuotes(source: SourceEvidence): string[] {
  return source.body.split(/\n+/u).map(/** 只去除行边缘空白。 */ function trim(line) { return line.trim(); }).filter(/** 只接受带截止语义的句子。 */ function hasDeadline(line) { return /\bdeadline\b|\bdue\b(?!\s+to\b)|\bsubmit(?:ted)?\b.*\b(?:by|before|on)\b|截止|最迟|提交时间/iu.test(line); });
}

/** 依据行内任务或最近明确标题绑定截止信息；编号冲突不能继承另一任务的日期。 */
export function answerAssignmentDeadlines(question: string, snapshot: AnnouncementSnapshot): ModelAnswer {
  const task = requestedTask(question);
  const facts: NonNullable<ModelAnswer['deadlines']> = [];
  const selectedSection = question.match(/\bL0?([1-9])\b/i)?.[1];
  let related = false;
  for (const source of snapshot.sources) {
    if (source.courseId !== snapshot.course.courseId) continue;
    const titleMatch = matchTask(source.title, task);
    let active = titleMatch;
    let section = source.title.match(/\bL0?([1-9])\b/i)?.[1];
    for (const line of source.body.split(/\n+/u).map(/** 规范行边缘空白，引用仍是原文子串。 */ function trim(value) { return value.trim(); })) {
      const refs = taskReferences(line);
      const lineMatch = matchTask(line, task);
      if (refs.length) active = lineMatch || (active && refs.every(/** 无截止信息的同实验报告/代码清单不抹掉当前实验范围。 */ function sameLab(ref) { return ref.kind === 'lab' && ref.number === task.number; }) ? active : undefined);
      const lineSections = [...line.matchAll(/\bL0?([1-9])\b/gi)];
      if (lineSections.length === 1) section = lineSections[0][1];
      if (selectedSection && section && selectedSection !== section) continue;
      const match = lineMatch || active || (!task.number && task.kind === 'assignment' && source.kind === 'assignment' ? 'exact' : undefined);
      if (!match || !deadlineQuotes({ ...source, body: line }).length) continue;
      if (task.kind === 'report' && /code|代码/i.test(line) && !/report|报告/i.test(line)) continue;
      if (task.kind === 'code' && /report|报告/i.test(line) && !/code|代码/i.test(line)) continue;
      const ambiguous = match === 'related' || refs.some(/** 同句涉及不同报告时不能只截取一个时间。 */ function other(ref) { return ref.kind === task.kind && task.number && ref.number !== task.number; });
      related ||= ambiguous;
      facts.push({ sourceId: source.sourceId, title: source.title, time: conciseDeadline(line), quote: line, section: section ? `L0${section}` : undefined, tentative: ambiguous });
    }
  }
  const notices: string[] = [];
  if (snapshot.coverage.status === 'partial') notices.push('部分资料未读全，结果可能不完整。');
  if (related) notices.push('找到相关实验报告，请核对下方任务名称。');
  if (/最新|latest|newest/i.test(question) && new Set(facts.map(/** 按来源数提醒无法认定最新。 */ function id(fact) { return fact.sourceId; })).size > 1) notices.push('无法确认哪项最新；各来源时间分别列出。');
  if (new Set(facts.map(/** 不根据合班课程名猜用户班组。 */ function group(fact) { return fact.section; }).filter(Boolean)).size > 1) notices.push('不同班组时间不同，请看自己的班组。');
  if (!facts.length) notices.push(task.number ? `在已读资料中未找到该任务 ${task.number} 的明确截止时间。` : '可见资料未识别到明确截止时间。');
  if (facts.length > 20) notices.push('这里只展示前20条，其余可展开已读资料。');
  return { status: facts.length ? 'found' : 'not_found', mode: 'extracted', answer: `${notices.join('\n')}${facts.length ? '\n' + facts.slice(0,20).map(/** 文本兼容输出同样先时间后原文。 */ function text(fact) { return `${fact.title}${fact.section ? ` · ${fact.section}` : ''}\n${fact.time}\n${fact.quote}`; }).join('\n\n') : ''}`.trim(), deadlines: facts.slice(0,20), notices, citations: facts.slice(0,20).map(/** 每个时间对应独立原话和来源。 */ function citation(fact) { return { sourceId: fact.sourceId, quote: fact.quote }; }) };
}
