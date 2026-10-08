/** 文件用途：验证模型引用和测验时间事实，阻止无依据的日期、班组混用和未说明的改期覆盖。 */
import { AppError } from '../shared/errors';
import type { AnnouncementSnapshot, Citation, ModelAnswer, SourceEvidence } from '../shared/types';

interface TemporalFact { kind: 'date' | 'time' | 'duration' | 'weekday' | 'relative'; value: string; quiz: number | null; section: string | null }
interface QuizMention { number: number; index: number }
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const STATUSES = new Set(['found', 'not_found', 'conflict']);

/** 将换行、不可断空格和连续空白统一；不删除标点，以便引用仍对应真实原文。 */
export function normalizeEvidence(text: string): string {
  return text.normalize('NFKC').replace(/\s+/gu, ' ').trim();
}

/** 从英文或中文测验编号提取位置；不把课程编号、时长或 Tutorial 编号当成 Quiz。 */
function quizMentions(text: string): QuizMention[] {
  const result: QuizMention[] = [];
  for (const match of text.matchAll(/(?:quiz|test|小测|测验)\s*(?:no\.?\s*|#\s*)?(\d+)\b/giu)) {
    result.push({ number: Number(match[1]), index: match.index });
  }
  for (const match of text.matchAll(/\b(first|second|third|fourth)(?:\s+in[- ]class)?\s+(?:quiz|test)\b/giu)) {
    result.push({ number: ['first', 'second', 'third', 'fourth'].indexOf(match[1].toLowerCase()) + 1, index: match.index });
  }
  for (const match of text.matchAll(/第\s*([一二三四五六七八九十\d]+)\s*(?:次|个|场)?\s*(?:quiz|test|测验|小测)/giu)) {
    const value = Number(match[1]) || '一二三四五六七八九十'.indexOf(match[1]) + 1;
    result.push({ number: value, index: match.index });
  }
  return result.sort(compareMentionPosition);
}

/** 按原文顺序比较编号位置，便于把时间绑定到紧邻的测验名称。 */
function compareMentionPosition(left: QuizMention, right: QuizMention): number { return left.index - right.index; }

/** 将数字测验编号去重，供特定 Quiz 查询和多个测验歧义判断使用。 */
function uniqueQuizzes(text: string): number[] {
  return [...new Set(quizMentions(text).map(mentionNumber))];
}

/** 取提取结果中的测验编号，不携带其位置。 */
function mentionNumber(mention: QuizMention): number { return mention.number; }

/** 原文没有年份时仅使用该公告发布时间/抓取时间的年份；不会按本机时区猜日期。 */
function sourceYear(source?: SourceEvidence): string {
  return source?.publishedAt.match(/\b(20\d{2})\b/u)?.[1] ?? source?.fetchedAt.match(/^(20\d{2})-/u)?.[1] ?? '';
}

/** 校验月日并生成可比较值；缺少年份保留空年份，不补开始时刻。 */
function dateValue(year: string, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const validationYear = year ? Number(year) : 2000;
  const date = new Date(Date.UTC(validationYear, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${month}-${day}`;
}

/** 将句子内的时间绑定至最近的测验编号；其它教学活动会阻断跨句继承。 */
function associatedQuiz(clause: string, index: number, fallback: number | null): number | null {
  const mentions = quizMentions(clause);
  const preceding = mentions.filter(isBeforeFact);
  /** 仅使用时间表达之前的编号，防止把前一测验日期绑定到后一编号。 */
  function isBeforeFact(mention: QuizMention): boolean { return mention.index <= index; }
  if (preceding.length) {
    const nearest = preceding[preceding.length - 1];
    if (/tutorial|office\s*hours|lecture|辅导|答疑/iu.test(clause.slice(nearest.index, index))) return null;
    return nearest.number;
  }
  if (mentions.length === 1) return mentions[0].number;
  if (/tutorial|office\s*hours|lecture|辅导|答疑/iu.test(clause)) return null;
  return fallback;
}

/** 将事实绑定到同句最近的显式教学班；整条公告只有一个班时可以使用其上下文。 */
function associatedSection(clause: string, index: number, source?: SourceEvidence): string | null {
  const mentions = [...clause.matchAll(/\bL\d{2}\b/giu)];
  const preceding = mentions.filter(isBeforeSectionFact);
  /** 教学班与时间按位置对应，不能跨过下一班的名称。 */
  function isBeforeSectionFact(match: RegExpMatchArray): boolean { return (match.index ?? 0) <= index; }
  if (preceding.length) return preceding[preceding.length - 1][0].toUpperCase();
  if (mentions.length === 1) return mentions[0][0].toUpperCase();
  const sourceSections = source ? [...new Set(`${source.title} ${source.body}`.match(/\bL\d{2}\b/giu) ?? [])] : [];
  return sourceSections.length === 1 ? sourceSections[0].toUpperCase() : null;
}

/** 提取支持的绝对日期、钟点与分钟时长；日期与时长使用不同类型，禁止互相替代。 */
function temporalFacts(text: string, source?: SourceEvidence, questionQuiz: number | null = null, requireQuizContext = false): TemporalFact[] {
  const facts: TemporalFact[] = [];
  const sourceQuizzes = source ? uniqueQuizzes(`${source.title} ${source.body}`) : [];
  const fallback = sourceQuizzes.length === 1 ? sourceQuizzes[0] : questionQuiz;
  const year = sourceYear(source);
  for (const clause of text.normalize('NFKC').split(/(?<=[.!?])\s+|[。！？;；\n]+/u)) {
    /** 添加已经规范化的事实；原始位置决定该事实属于哪次测验。 */
    function add(kind: TemporalFact['kind'], value: string | null, index: number): void {
      if (value) {
        const explicitQuizContext = /\bquiz\b|\btest\b|测验|小测|reschedul|postpon|改期|延期|改到/iu.test(clause);
        // 全公告冲突扫描不能把标题中的Quiz身份传给其它段落的课程/Topic日期。
        const quiz = requireQuizContext && !explicitQuizContext ? null : associatedQuiz(clause, index, fallback);
        const section = associatedSection(clause, index, source);
        facts.push({ kind, value, quiz, section });
        if (kind === 'date' && /^20\d{2}-/u.test(value)) {
          const [dateYear, month, day] = value.split('-').map(Number);
          facts.push({ kind: 'weekday', value: String(new Date(Date.UTC(dateYear, month - 1, day)).getUTCDay()), quiz, section });
        }
      }
    }
    for (const match of clause.matchAll(/(?:(20\d{2})\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/gu)) {
      add('date', dateValue(match[1] ?? year, Number(match[2]), Number(match[3])), match.index);
    }
    for (const match of clause.matchAll(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/gu)) {
      add('date', dateValue(match[1], Number(match[2]), Number(match[3])), match.index);
    }
    for (const match of clause.matchAll(/([一二三四五六七八九十两]+)月([一二三四五六七八九十两]+)[日号]/gu)) {
      add('date', dateValue(year, chineseNumber(match[1]), chineseNumber(match[2])), match.index);
    }
    for (const match of clause.matchAll(/(?<![\d/])(\d{1,2})\/(\d{1,2})(?![\d/])/gu)) {
      // 无年份的斜杠日期不推断月日顺序；只接受来源相同写法。
      add('date', `raw:${match[1]}/${match[2]}`, match.index);
    }
    for (const match of clause.matchAll(/\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan\.?|Feb\.?|Mar\.?|Apr\.?|Jun\.?|Jul\.?|Aug\.?|Sep\.?|Sept\.?|Oct\.?|Nov\.?|Dec\.?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(20\d{2}))?\b/giu)) {
      const monthName = match[1].toLowerCase().replace('.', '');
      const month = MONTHS.findIndex(matchesMonth) + 1;
      /** 英文三字缩写和完整月份归一化为同一月份。 */
      function matchesMonth(candidate: string): boolean { return candidate.startsWith(monthName); }
      add('date', dateValue(match[3] ?? year, month, Number(match[2])), match.index);
    }
    for (const match of clause.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(January|February|March|April|May|June|July|August|September|October|November|December)(?:,?\s+(20\d{2}))?\b/giu)) {
      add('date', dateValue(match[3] ?? year, MONTHS.indexOf(match[2].toLowerCase()) + 1, Number(match[1])), match.index);
    }
    for (const match of clause.matchAll(/\b(\d{1,2}):(\d{2})\s*(am|pm|a\.m\.|p\.m\.)?/giu)) {
      let hour = Number(match[1]);
      const minute = Number(match[2]);
      const suffix = match[3]?.toLowerCase().replaceAll('.', '');
      if (suffix && (hour < 1 || hour > 12)) continue;
      if (suffix) hour = hour % 12 + (suffix === 'pm' ? 12 : 0);
      if (!suffix && /下午|晚上/u.test(clause.slice(Math.max(0, match.index - 3), match.index)) && hour < 12) hour += 12;
      if (hour < 24 && minute < 60) add('time', `${hour}:${minute}`, match.index);
    }
    for (const match of clause.matchAll(/\b(\d{1,2})\s*(am|pm|a\.m\.|p\.m\.)/giu)) {
      const hour = Number(match[1]);
      if (hour >= 1 && hour <= 12) add('time', `${hour % 12 + (match[2].toLowerCase().startsWith('p') ? 12 : 0)}:0`, match.index);
    }
    for (const match of clause.matchAll(/(?:上午|下午|晚上|中午)?\s*(\d{1,2})\s*(?:点|時|时)(?:(\d{1,2})\s*分|整|半)?/gu)) {
      let hour = Number(match[1]);
      if (/下午|晚上/u.test(match[0]) && hour < 12) hour += 12;
      const minute = match[0].includes('半') ? 30 : Number(match[2] ?? 0);
      if (hour < 24 && minute < 60) add('time', `${hour}:${minute}`, match.index);
    }
    for (const match of clause.matchAll(/(?:上午|下午|晚上|中午)?\s*([一二三四五六七八九十两]+)\s*点(?:整|半)?/gu)) {
      let hour = chineseNumber(match[1]);
      if (/下午|晚上/u.test(match[0]) && hour < 12) hour += 12;
      if (hour >= 0 && hour < 24) add('time', `${hour}:${match[0].includes('半') ? 30 : 0}`, match.index);
    }
    for (const match of clause.matchAll(/\b(\d+)\s*(?:-\s*)?(?:minutes?|mins?)\b|(\d+)\s*分钟/giu)) {
      add('duration', `${Number(match[1] ?? match[2])}`, match.index);
    }
    for (const match of clause.matchAll(/\b(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\b|(?:星期|周)([日天一二三四五六])/giu)) {
      const weekday = match[1] ? ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].indexOf(match[1].toLowerCase()) : '日一二三四五六'.indexOf(match[2] === '天' ? '日' : match[2]);
      add('weekday', String(weekday), match.index);
    }
    for (const match of clause.matchAll(/(?:下|本|这|上)周[一二三四五六日天]?|明天|后天|今天|\b(?:next|this|last)\s+(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|week)\b/giu)) {
      add('relative', match[0].toLowerCase(), match.index);
    }
  }
  return facts;
}

/** 解析一至三十一的中文月日数字；超出支持范围保留无效值而非猜测。 */
function chineseNumber(text: string): number {
  const digits = '零一二三四五六七八九';
  const normalized = text.replaceAll('两', '二');
  if (normalized === '十') return 10;
  if (normalized.includes('十')) {
    const [tens, units] = normalized.split('十');
    return (tens ? digits.indexOf(tens) : 1) * 10 + (units ? digits.indexOf(units) : 0);
  }
  return digits.indexOf(normalized);
}

/** 比较时间事实；无明确年份的答案可以引用有年份的原文，反向必须有来源年份支持。 */
function sameFact(answer: TemporalFact, evidence: TemporalFact): boolean {
  if (answer.kind !== evidence.kind || (answer.quiz !== null && answer.quiz !== evidence.quiz) || (answer.section !== null && evidence.section !== null && answer.section !== evidence.section)) return false;
  if (answer.value === evidence.value) return true;
  return answer.kind === 'date' && answer.value.startsWith('-') && answer.value === evidence.value.replace(/^20\d{2}/u, '');
}

/** 判断 JSON 对象，拒绝 null、数组和没有固定字段的模型响应。 */
function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }

/** 所有证据校验失败统一转换为不含模型原文、问题或凭据的界面错误。 */
function invalidAnswer(reason = 'schema'): never {
  const error = new AppError('invalid_answer', 'AI 回答与公告依据不一致。请重试，或直接查看已读取的公告来源。');
  error.cause = reason;
  throw error;
}

/** 校验时间事实和课程引用，再返回固定 UI 契约；不会把模型产生的 URL 作为来源。 */
export function validateModelAnswer(value: unknown, snapshot: AnnouncementSnapshot, question: string): ModelAnswer {
  if (!isRecord(value) || typeof value.status !== 'string' || !STATUSES.has(value.status) || typeof value.answer !== 'string' || !value.answer.trim() || value.answer.length > 6000 || !Array.isArray(value.citations) || value.citations.length > 20) invalidAnswer();
  const citations: Citation[] = [];
  const citedFacts: TemporalFact[] = [];
  const questionQuizzes = uniqueQuizzes(question);
  const questionQuiz = questionQuizzes.length === 1 ? questionQuizzes[0] : null;
  for (const raw of value.citations) {
    if (!isRecord(raw) || typeof raw.sourceId !== 'string' || typeof raw.quote !== 'string' || !raw.quote.trim() || raw.quote.length > 4000) invalidAnswer();
    const source = snapshot.sources.find(matchesSource);
    /** 来源 ID 必须属于本次选定课程；模型不能引用另一课程或虚构来源。 */
    function matchesSource(candidate: SourceEvidence): boolean { return candidate.sourceId === raw.sourceId && candidate.courseId === snapshot.course.courseId; }
    if (!source || !normalizeEvidence(source.body).includes(normalizeEvidence(raw.quote))) invalidAnswer('citation');
    citations.push({ sourceId: source.sourceId, quote: raw.quote.trim() });
    const facts = temporalFacts(raw.quote, source);
    if (value.status === 'found' && snapshot.course.section && facts.some(isOtherSection)) invalidAnswer();
    /** 已确认答案只允许当前选定教学班的时间；其它班组证据仍可用于展示冲突。 */
    function isOtherSection(fact: TemporalFact): boolean { return fact.section !== null && fact.section.toUpperCase() !== snapshot.course.section.toUpperCase(); }
    citedFacts.push(...facts);
  }
  if (value.status !== 'not_found' && !citations.length) invalidAnswer();
  const answerFacts = temporalFacts(value.answer, undefined, questionQuiz);
  if (value.status === 'found' && questionQuiz !== null && answerFacts.some(isOtherQuizFact)) invalidAnswer('quiz_scope');
  /** 只限制另一测验的时间事实；“Quiz 2未发布”这样的无日期否定说明不串用日期。 */
  function isOtherQuizFact(fact: TemporalFact): boolean { return fact.quiz !== null && fact.quiz !== questionQuiz; }
  if (value.status === 'found' && /(?:什么时候|啥时候|哪天|日期|\bwhen\b)/iu.test(question) && !answerFacts.some(isScheduleFact)) invalidAnswer();
  /** 日期类肯定答案必须含可校验时间表达，防止未识别写法绕过事实检查。 */
  function isScheduleFact(fact: TemporalFact): boolean { return fact.kind === 'date' || fact.kind === 'time' || fact.kind === 'weekday' || fact.kind === 'relative'; }
  if (value.status === 'found' && /几点|开始时间|\bwhat\s+time\b|\bstart\s+time\b/iu.test(question) && !answerFacts.some(isClockFact) && !/没有|未(?:写|说明|提供)|不明确|未知|不确定|not\s+(?:specified|stated)/iu.test(value.answer)) invalidAnswer();
  /** 开始时刻的肯定回答必须含钟点，时长或仅日期不能替代。 */
  function isClockFact(fact: TemporalFact): boolean { return fact.kind === 'time'; }
  for (const fact of answerFacts) {
    if (!citedFacts.some(supportsFact)) invalidAnswer('time_fact');
    /** 检查每个日期、开始时刻与时长是否都可在引用原文中找到对应事实。 */
    function supportsFact(candidate: TemporalFact): boolean { return sameFact(fact, candidate); }
  }
  if (value.status === 'not_found' && answerFacts.length > 0 && citations.length === 0) invalidAnswer();
  validateConflicts(value.status, answerFacts, snapshot, questionQuiz);
  return { status: value.status as ModelAnswer['status'], answer: value.answer.trim(), citations };
}

/** 检查可识别的不同日期；只有最新公告明确改期时才允许肯定回答覆盖旧安排。 */
function validateConflicts(status: string, answerFacts: TemporalFact[], snapshot: AnnouncementSnapshot, questionQuiz: number | null): void {
  if (status !== 'found') return;
  const relevantQuizzes = new Set(answerFacts.filter(isDate).map(factQuiz));
  if (questionQuiz !== null) relevantQuizzes.add(questionQuiz);
  /** 仅日期需要做安排冲突检查；时长与钟点不代表不同测验日期。 */
  function isDate(fact: TemporalFact): boolean { return fact.kind === 'date'; }
  /** 保留时间事实的测验身份，用于隔离不同 Quiz。 */
  function factQuiz(fact: TemporalFact): number | null { return fact.quiz; }
  for (const quiz of relevantQuizzes) {
    if (quiz === null) continue;
    const records: { fact: TemporalFact; source: SourceEvidence }[] = [];
    for (const source of snapshot.sources) {
      for (const fact of temporalFacts(source.body, source, null, true)) {
        if (fact.kind === 'date' && fact.quiz === quiz && (fact.section === null || !snapshot.course.section || fact.section === snapshot.course.section.toUpperCase())) records.push({ fact, source });
      }
    }
    if (new Set(records.map(recordValue)).size <= 1) continue;
    const latest = [...snapshot.sources].sort(compareSourceTime).find(hasRelevantDate);
    /** 从记录取日期值，不把 URL、身份等无关资料带入比较。 */
    function recordValue(record: { fact: TemporalFact }): string { return record.fact.value; }
    /** 仅选择确实含该测验日期的公告作为最新修改候选。 */
    function hasRelevantDate(source: SourceEvidence): boolean {
      return records.some(isRecordFromSource);
      /** 按来源身份匹配事实，避免同标题公告混用。 */
      function isRecordFromSource(record: { source: SourceEvidence }): boolean { return record.source === source; }
    }
    if (!latest || !/reschedul|postpon|moved\s+(?:to|from)|changed\s+(?:to|from)|new\s+date|revised\s+date|改期|延期|改到|调整为|更改/iu.test(`${latest.title} ${latest.body}`)) invalidAnswer('unresolved_dates');
    const revisedDate = revisedQuizDate(latest, quiz) ?? invalidAnswer();
    if (!answerFacts.some(isRevisedDate)) invalidAnswer();
    /** 肯定回答必须使用已核对的改期日期，不能仍返回旧日期。 */
    function isRevisedDate(fact: TemporalFact): boolean { return fact.kind === 'date' && fact.quiz === quiz && fact.value.replace(/^20\d{2}/u, '') === revisedDate.replace(/^20\d{2}/u, ''); }
  }
}

/** 根据明确的改到/to方向识别新日期；括号里提旧日期不会改变方向，无法判断则不确认。 */
function revisedQuizDate(source: SourceEvidence, quiz: number): string | null {
  const sourceQuizzes = uniqueQuizzes(`${source.title} ${source.body}`);
  const fallback = sourceQuizzes.length === 1 ? sourceQuizzes[0] : null;
  const dates: string[] = [];
  for (const clause of source.body.normalize('NFKC').split(/(?<=[.!?])\s+|[。！？;；\n]+/u)) {
    if (!/reschedul|postpon|moved|changed|new\s+date|revised\s+date|改期|延期|改到|调整为|更改|改为|推迟/iu.test(clause)) continue;
    for (const cue of clause.matchAll(/\b(?:to|until)\s+|\b(?:new|revised)\s+date\s*(?:is|:)?\s*|改到|改为|调整为|更改为|延期至|推迟到|推迟至|改期(?:至|为)/giu)) {
      if (associatedQuiz(clause, cue.index, fallback) !== quiz) continue;
      const after = clause.slice(cue.index + cue[0].length);
      const fact = temporalFacts(`Quiz ${quiz} ${after}`, source).find(isDate);
      /** 明确改期方向之后的第一个日期是候选新日期。 */
      function isDate(candidate: TemporalFact): boolean { return candidate.kind === 'date'; }
      if (fact) dates.push(fact.value);
    }
  }
  return new Set(dates).size === 1 ? dates[0] : null;
}

/** 按公告时间排序；未识别的时间不被假定比可识别发布时间更晚。 */
function compareSourceTime(left: SourceEvidence, right: SourceEvidence): number {
  const leftTime = Date.parse(left.publishedAt) || 0;
  const rightTime = Date.parse(right.publishedAt) || 0;
  return rightTime - leftTime;
}
