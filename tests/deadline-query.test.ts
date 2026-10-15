/** 文件用途：使用虚构任务验证报告别名、班组、编号隔离、时间展示与双来源部分失败。 */
import { describe, expect, it } from 'vitest';
import { answerAssignmentDeadlines, isAssignmentDeadlineQuestion } from '../src/blackboard/deadlines';
import { conciseDeadline } from '../src/blackboard/deadline-time';
import { collectDeadlineSources } from '../src/shared/deadline-client';
import { AppError } from '../src/shared/errors';
import type { AnnouncementSnapshot, SourceEvidence } from '../src/shared/types';
const course = { courseId: '_700_1', code: 'ECE3810', title: 'Example laboratory', section: '', termId: '2610UG', termLabel: '2610UG', announcementUrl: 'https://bb.cuhk.edu.cn/webapps/blackboard/execute/announcement?searchSelect=_700_1' };
const body = 'Lab 1 report and code are open.\nL01 — due 19:00, Tuesday, 17 November 2026\n- Lab 1 Report\n- Lab 1 Code\nL02 — due 20:00, Thursday, 19 November 2026\n- Lab 1 Report\n- Lab 1 Code';
/** 建立可参数化的单条学校来源，日期不使用真实课程数据。 */
function source(title = 'Lab 1 Submission: Report and Code', text = body): SourceEvidence { return { sourceId: '_901_1', courseId: course.courseId, title, body: text, publishedAt: '', url: course.announcementUrl, anchorId: '_901_1', breadcrumb: [], fetchedAt: '' }; }
/** 建立默认已完整读取的本轮快照。 */
function snapshot(sources = [source()]): AnnouncementSnapshot { return { course, scope: 'deadlines', sources, fetchedAt: '', coverage: { status: 'complete', pagesRead: 1, warnings: [] } }; }
describe('report deadline queries', () => {
  it.each(['ece3810的report1的ddl是啥时候', '报告1什么时候交，截止是哪天', 'lab1 report due date', 'hw1 ddl', 'project2 deadline'])('recognizes %s', question => expect(isAssignmentDeadlineQuestion(question)).toBe(true));
  it('keeps both sections, includes source quotes, and labels Lab 1 report as related', () => {
    const answer = answerAssignmentDeadlines('ece3810的report1的ddl是啥时候', snapshot());
    expect(answer.status).toBe('found'); expect(answer.deadlines).toHaveLength(2);
    expect(answer.deadlines?.map(f => [f.section, f.time])).toEqual([['L01','2026年11月17日 19:00'],['L02','2026年11月19日 20:00']]);
    expect(answer.notices?.join(' ')).toContain('相关');
    for (const citation of answer.citations) expect(body).toContain(citation.quote);
    expect(answerAssignmentDeadlines('report1 L02 ddl', snapshot()).deadlines).toHaveLength(1);
    expect(answerAssignmentDeadlines('lab1 report due', snapshot()).deadlines).toHaveLength(2);
  });
  it('never borrows Report 2, code-only or another course deadlines', () => {
    expect(answerAssignmentDeadlines('report2 ddl', snapshot()).status).toBe('not_found');
    expect(answerAssignmentDeadlines('report1 ddl', snapshot([source('Lab 1 Code', 'Lab 1 Code due November 17, 2026.')] )).status).toBe('not_found');
    expect(answerAssignmentDeadlines('report1 ddl', snapshot([{...source(), courseId:'_999_1'}])).status).toBe('not_found');
    const result = answerAssignmentDeadlines('report1 ddl', snapshot([source('Report 1', 'Report 1\nDue: November 17, 2026\nReport 2\nDue: November 19, 2026')]));
    expect(result.citations).toHaveLength(1); expect(result.answer).not.toContain('November 19');
    const codeOnly = answerAssignmentDeadlines('lab1 report due', snapshot([source('Lab 1 Report and Code', 'Lab 1 Code due November 17, 2026.')]));
    expect(codeOnly.status).toBe('not_found');
  });
  it('does not present multiple dates, relative dates or negations as a definite single deadline', () => {
    expect(conciseDeadline('Deadline: November 17, 2026 and November 19, 2026')).toBe('具体时间见原话');
    expect(conciseDeadline('Deadline is next Thursday')).toBe('具体时间见原话');
    expect(conciseDeadline('Deadline is not November 17, 2026')).toBe('时间条件见原话');
    expect(conciseDeadline('Due: November 17, 2026 9:30 PM')).toBe('2026年11月17日 21:30');
    expect(conciseDeadline('Due: 21:30, 17 Nov 2026 (5 minute grace period)')).toBe('2026年11月17日 21:30');
    expect(conciseDeadline('Due: November 17')).toBe('11月17日（未注明具体时刻）');
  });
  it('does not carry report context into an unnumbered code heading, or vice versa', () => {
    const report = answerAssignmentDeadlines('report1 ddl', snapshot([source('Report 1 and Code', 'Report\nDue November 17, 2026\nSource Code:\nDue November 19, 2026')]));
    expect(report.citations.map(c => c.quote)).toEqual(['Due November 17, 2026']);
    const code = answerAssignmentDeadlines('code1 ddl', snapshot([source('Code 1 and Report', 'Code\nDue November 17, 2026\n报告：\nDue November 19, 2026')]));
    expect(code.citations.map(c => c.quote)).toEqual(['Due November 17, 2026']);
  });
  it('preserves parenthesized zones and does not hide conditions or alternate dates', () => {
    expect(conciseDeadline('Due November 17, 2026 19:00 (UTC+8)')).toBe('2026年11月17日 19:00 UTC+8');
    expect(conciseDeadline('Due November 17, 2026 19:00 (if approved)')).toBe('时间条件见原话');
    expect(conciseDeadline('Due November 17, 2026 (otherwise November 19, 2026)')).not.toContain('2026年11月17日');
    expect(conciseDeadline('Due November 17, 2026 (延期至 November 19, 2026)')).toBe('时间条件见原话');
  });
  it('merges both scopes and makes one-route failure visible while retaining evidence', async () => {
    const merged = await collectDeadlineSources(course, [async () => snapshot(), async () => snapshot([])]);
    expect(merged.scope).toBe('deadlines'); expect(merged.sources).toHaveLength(1); expect(merged.coverage.pagesRead).toBe(2);
    const partial = await collectDeadlineSources(course, [async () => snapshot(), async () => { throw new AppError('transport_error','fixture'); }]);
    expect(partial.coverage.status).toBe('partial'); expect(answerAssignmentDeadlines('report1 ddl', partial).status).toBe('found');
    await expect(collectDeadlineSources(course, [async () => snapshot(), async () => { throw new AppError('login_required','fixture'); }])).rejects.toMatchObject({code:'login_required'});
    await expect(collectDeadlineSources(course, [async () => { throw new Error(); }, async () => { throw new Error(); }])).rejects.toMatchObject({code:'read_failed'});
  });
});
