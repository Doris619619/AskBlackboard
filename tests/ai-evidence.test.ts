/** 文件用途：用不含个人信息的公告样本验证引用、测验身份、时间类型和改期冲突边界。 */
// @vitest-environment node
import { describe, expect, test } from 'vitest';
import { validateModelAnswer } from '../src/ai/evidence';
import type { AnnouncementSnapshot, ModelAnswer, SourceEvidence } from '../src/shared/types';

/** 建立虚构的同课程公告；测试资料不包含用户身份、Cookie 或 API 密钥。 */
function source(body: string, sourceId = 'notice-1', publishedAt = '2026-10-07T04:33:13Z'): SourceEvidence {
  return { sourceId, courseId: 'course-1', title: 'Quiz announcement', publishedAt, body, url: 'https://bb.cuhk.edu.cn/example', anchorId: sourceId, breadcrumb: ['Announcements'], fetchedAt: '2026-10-08T12:00:00Z' };
}

/** 建立当前学期 L01 的快照，允许测试多条通知的相互关系。 */
function snapshot(...sources: SourceEvidence[]): AnnouncementSnapshot {
  return { course: { courseId: 'course-1', code: 'GED2005', title: 'Example course', termId: '2610UG', termLabel: '2026 Term', section: 'L01', announcementUrl: 'https://bb.cuhk.edu.cn/example' }, sources, fetchedAt: '2026-10-08T12:00:00Z', coverage: { status: 'complete', pagesRead: 1, warnings: [] } };
}

/** 构建模型数据并明确引用原文，供验证层独立于网络测试。 */
function answer(text: string, quote: string, sourceId = 'notice-1', status: ModelAnswer['status'] = 'found'): ModelAnswer {
  return { status, answer: text, citations: [{ sourceId, quote }] };
}

describe('announcement evidence validation', describeEvidence);
/** 覆盖关键事实风险，而非仅复刻字段与实现。 */
function describeEvidence(): void {
  test('accepts translated relative weekdays without inventing a calendar date', acceptRelativeTranslation);
  /** 中英文对应可通过；相对时间仍相对于公告，不转换成今天之后的日期。 */
  function acceptRelativeTranslation(): void {
    const quote = 'The project sharing takes place next Wednesday.';
    const data = snapshot(source(quote));
    expect(validateModelAnswer(answer('分享在该公告所说的下周三，未写具体日期。', quote), data, 'pre啥时候').status).toBe('found');
    expect(validateModelAnswer(answer('分享在该公告所说的下周，未写具体日期。', quote), data, 'pre啥时候').status).toBe('found');
    const thisWeek = 'The project sharing takes place this Wednesday.';
    expect(validateModelAnswer(answer('分享在该公告所说的本周三。', thisWeek), snapshot(source(thisWeek)), 'pre啥时候').status).toBe('found');
  }
  test('rejects relative direction, weekday and unsupported absolute date changes', rejectRelativeChanges);
  /** 翻译支持不能放宽到错星期、错周或无依据的日历日期。 */
  function rejectRelativeChanges(): void {
    const quote = 'The project sharing takes place next Wednesday.';
    for (const text of ['分享在下周四。', '分享在本周三。', '分享在上周三。', '分享在2026年10月21日。']) {
      expect(() => validateModelAnswer(answer(text, quote), snapshot(source(quote)), 'pre啥时候')).toThrow('公告依据');
    }
    const week = 'The sharing takes place next week.';
    expect(() => validateModelAnswer(answer('分享在下周三。', week), snapshot(source(week)), 'pre啥时候')).toThrow('公告依据');
  }
  test('accepts a supported date, weekday and duration with whitespace differences', acceptGroundedAnswer);
  /** 英文原文与中文答案共享相同日期事实，引用中的换行差异可定位。 */
  function acceptGroundedAnswer(): void {
    const body = 'Quiz 1 will take place on Monday, October 12.\nIt lasts 20 minutes.';
    const result = validateModelAnswer(answer('Quiz 1 在2026年10月12日，周一，时长20分钟。没有写具体开始时刻。', 'Quiz 1 will take place on Monday, October 12. It lasts 20 minutes.'), snapshot(source(body)), 'GED2005的quiz是什么时候');
    expect(result.status).toBe('found');
    expect(result.citations).toHaveLength(1);
  }
  test('rejects invented source IDs and quotes', rejectInvalidCitation);
  /** 不存在来源或伪造引用都必须失败，而不是显示貌似可点击的依据。 */
  function rejectInvalidCitation(): void {
    const data = snapshot(source('Quiz 1 is on October 12.'));
    expect(() => validateModelAnswer(answer('Quiz 1 在10月12日。', 'Quiz 1 is on October 12.', 'invented'), data, 'quiz什么时候')).toThrow('公告依据');
    expect(() => validateModelAnswer(answer('Quiz 1 在10月15日。', 'Quiz 1 is on October 15.'), data, 'quiz什么时候')).toThrow('公告依据');
  }
  test('rejects an ungrounded date or weekday', rejectWrongDate);
  /** 引用正确但回答日期或星期错误时仍须失败。 */
  function rejectWrongDate(): void {
    const quote = 'Quiz 1 is on Monday, October 12.';
    const data = snapshot(source(quote));
    expect(() => validateModelAnswer(answer('Quiz 1 在10月15日。', quote), data, 'quiz什么时候')).toThrow('公告依据');
    expect(() => validateModelAnswer(answer('Quiz 1 在10月12日，周二。', quote), data, 'quiz什么时候')).toThrow('公告依据');
    expect(() => validateModelAnswer(answer('Quiz 1 在2027年10月12日。', quote), data, 'quiz什么时候')).toThrow('公告依据');
  }
  test('does not turn a duration into a start time', rejectDurationAsTime);
  /** 20分钟只能支持时长，不能支持20:00的钟点。 */
  function rejectDurationAsTime(): void {
    const quote = 'Quiz 1 will last 20 minutes.';
    expect(() => validateModelAnswer(answer('Quiz 1 在20:00开始。', quote), snapshot(source(quote)), '几点开始')).toThrow('公告依据');
    expect(() => validateModelAnswer(answer('Quiz 1 在晚上八点开始。', quote), snapshot(source(quote)), '几点开始')).toThrow('公告依据');
    expect(() => validateModelAnswer(answer('Quiz 1 在eight PM开始。', quote), snapshot(source(quote)), '几点开始')).toThrow('公告依据');
    expect(validateModelAnswer(answer('Quiz 1没有写具体开始时间，时长20分钟。', quote), snapshot(source(quote)), '几点开始').status).toBe('found');
  }
  test('does not borrow Quiz 1 for Quiz 2', rejectDifferentQuiz);
  /** 明确查询另一次测验时不能把已有日期移植过去。 */
  function rejectDifferentQuiz(): void {
    const quote = 'Quiz 1 is on October 12.';
    const data = snapshot(source(quote));
    expect(() => validateModelAnswer(answer('Quiz 2 在10月12日。', quote), data, 'Quiz 2什么时候')).toThrow('公告依据');
    expect(() => validateModelAnswer(answer('Quiz 1 在10月12日。', quote), data, 'Quiz 2什么时候')).toThrow('公告依据');
  }
  test('binds separate dates to separate quizzes in one notice', validateMultipleQuizzes);
  /** 同通知里的两个日期不能交换，正确列出两个测验可以通过。 */
  function validateMultipleQuizzes(): void {
    const quote = 'Quiz 1 is on October 12. Quiz 2 is on October 30.';
    const data = snapshot(source(quote));
    expect(validateModelAnswer(answer('Quiz 1 在10月12日，Quiz 2 在10月30日。', quote), data, '有哪些quiz')).toHaveProperty('status', 'found');
    expect(() => validateModelAnswer(answer('Quiz 1 在10月30日，Quiz 2 在10月12日。', quote), data, '有哪些quiz')).toThrow('公告依据');
  }
  test('preserves unresolved date conflicts', rejectSilentConflict);
  /** 没有明确改期时，较新公告不能静默覆盖旧日期。 */
  function rejectSilentConflict(): void {
    const old = source('Quiz 1 is on October 12.', 'old', '2026-10-01T10:00:00Z');
    const recent = source('Quiz 1 is on October 15.', 'recent', '2026-10-07T10:00:00Z');
    const data = snapshot(old, recent);
    expect(() => validateModelAnswer(answer('Quiz 1 在10月15日。', recent.body, recent.sourceId), data, 'Quiz 1什么时候')).toThrow('公告依据');
    const conflict: ModelAnswer = { status: 'conflict', answer: 'Quiz 1有冲突：旧通知说10月12日，另一条说10月15日。', citations: [{ sourceId: 'old', quote: old.body }, { sourceId: 'recent', quote: recent.body }] };
    expect(validateModelAnswer(conflict, data, 'Quiz 1什么时候').status).toBe('conflict');
  }
  test('accepts explicit rescheduling and rejects the old answer', validateReschedule);
  /** 最新通知明确改期才可选新日期，并保留旧安排的证据用于解释。 */
  function validateReschedule(): void {
    const old = source('Quiz 1 is on October 12.', 'old', '2026-10-01T10:00:00Z');
    const revised = source('Quiz 1 is rescheduled from October 12 to October 15.', 'new', '2026-10-07T10:00:00Z');
    const data = snapshot(old, revised);
    expect(validateModelAnswer(answer('Quiz 1 已改到10月15日。', revised.body, 'new'), data, 'Quiz 1什么时候').status).toBe('found');
    expect(() => validateModelAnswer(answer('Quiz 1 在10月12日。', old.body, 'old'), data, 'Quiz 1什么时候')).toThrow('公告依据');
  }
  test('rejects another section while allowing a no-date result', validateSectionAndUnknown);
  /** 单班证据不能串到L01；没有日期时保留不知道的状态。 */
  function validateSectionAndUnknown(): void {
    const quote = 'L02 Quiz 1 is on October 15.';
    expect(() => validateModelAnswer(answer('Quiz 1 在10月15日。', quote), snapshot(source(quote)), 'quiz什么时候')).toThrow('公告依据');
    const noDate = source('Quiz 2 details will be announced later.');
    expect(validateModelAnswer({ status: 'not_found', answer: '当前读取的公告没有Quiz 2的明确日期。', citations: [] }, snapshot(noDate), 'Quiz 2什么时候').status).toBe('not_found');
  }
  test('rejects another course even with the same source ID', rejectAnotherCourse);
  /** 来源身份与当前课程身份必须同时匹配。 */
  function rejectAnotherCourse(): void {
    const notice = source('Quiz 1 is on October 12.');
    notice.courseId = 'another-course';
    expect(() => validateModelAnswer(answer('Quiz 1 在10月12日。', notice.body), snapshot(notice), 'quiz什么时候')).toThrow('公告依据');
  }
  test('validates slash dates, missing day suffixes and Chinese date digits', rejectAlternativeWrongDates);
  /** 常见日期写法不能绕过提取；无法识别的肯定日期答案也不被放行。 */
  function rejectAlternativeWrongDates(): void {
    const quote = 'Quiz 1 is on October 12.';
    const data = snapshot(source(quote));
    for (const wrong of ['Quiz 1在2026/10/15。', 'Quiz 1在10月15。', 'Quiz 1在十月十五日。', 'Quiz 1在10/15。', 'Quiz 1很快会进行。']) {
      expect(() => validateModelAnswer(answer(wrong, quote), data, 'quiz什么时候')).toThrow('公告依据');
    }
  }
  test('does not treat a tutorial date as a conflicting quiz date', ignoreOtherEvents);
  /** 即使两个活动同句出现，日期仍归属于最近的活动名称。 */
  function ignoreOtherEvents(): void {
    for (const body of ['Quiz 1 is on October 12, and the tutorial is on October 15.', 'Quiz 1在10月12日。Tutorial在10月15日。']) {
      const quote = body.startsWith('Quiz 1 is') ? 'Quiz 1 is on October 12' : 'Quiz 1在10月12日';
      expect(validateModelAnswer(answer('Quiz 1在10月12日。', quote), snapshot(source(body)), 'quiz什么时候').status).toBe('found');
    }
  }
  test('does not pick the old date in a rescheduling parenthesis', revisedDateDirection);
  /** 新日期在to后面，originally后的旧日期即使写在末尾也不能覆盖它。 */
  function revisedDateDirection(): void {
    const old = source('Quiz 1 is on October 12.', 'old', '2026-10-01T10:00:00Z');
    const revised = source('Quiz 1 is rescheduled to October 15 (originally October 12).', 'new', '2026-10-07T10:00:00Z');
    expect(validateModelAnswer(answer('Quiz 1已改到10月15日。', revised.body, 'new'), snapshot(old, revised), 'Quiz 1什么时候').status).toBe('found');
  }
  test('supports British date order and plain AM times', acceptAlternateSourceFormats);
  /** 原文不同日期顺序与12小时制仍可支持规范化中文答案。 */
  function acceptAlternateSourceFormats(): void {
    const quote = 'Quiz 1 will be held on 12 October 2026 at 10 AM.';
    expect(validateModelAnswer(answer('Quiz 1在2026年10月12日10:00开始。', quote), snapshot(source(quote)), 'quiz什么时候').status).toBe('found');
  }
  test('does not inherit a quiz heading into a later course-topic date', ignoreUnrelatedParagraphs);
  /** 虚构多主题通知：Quiz、缺席Tutorial和后续Topic日期不能制造Quiz改期冲突。 */
  function ignoreUnrelatedParagraphs(): void {
    const main = source('Quiz 1 will take place on Monday, October 12. Duration: 20 minutes. There will be no tutorial during the week of October 12. Please note the following schedule: Monday, October 19: Topic 6. Tuesday, October 20: Tutorial sessions.', 'main');
    const earlier = source('Before the break we cover Topic 4 on September 28. We will not meet until October 12. The make-up class on October 10 does not apply. Your first in-class quiz will also take place on October 12.', 'earlier', '2026-09-22T10:00:00Z');
    const grounded: ModelAnswer = { status: 'found', answer: 'Quiz 1在2026年10月12日，时长20分钟，未写具体开始时间。10月12日当周没有tutorial。当前公告没有Quiz 2的日期。', citations: [{ sourceId: 'main', quote: 'Quiz 1 will take place on Monday, October 12.' }, { sourceId: 'main', quote: 'Duration: 20 minutes.' }, { sourceId: 'main', quote: 'There will be no tutorial during the week of October 12.' }, { sourceId: 'earlier', quote: 'Your first in-class quiz will also take place on October 12.' }] };
    expect(validateModelAnswer(grounded, snapshot(main, earlier), 'GED2005的quiz是什么时候').status).toBe('found');
    expect(validateModelAnswer(grounded, snapshot(main, earlier), 'Quiz 1什么时候').status).toBe('found');
  }
}
