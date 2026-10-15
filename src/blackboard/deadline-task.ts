/** 文件用途：识别截止问题中的任务名称和编号，区分报告、代码、作业与实验相关称呼。 */
export interface DeadlineTask { kind: string; number?: string }
const taskPattern = /(assignment|homework|hw|作业|reports?|实验报告|报告|projects?|项目|codes?|代码|labs?|实验)\s*(?:no\.?\s*|#\s*|[-_：:]\s*)?(\d+)(?!\d)/giu;

/** 识别独立的无编号报告/代码小标题，供调用者切断上一任务的截止上下文；不将正文提及当标题。 */
export function taskHeadingKind(text: string): string | undefined {
  const heading = text.replace(/^[\s#*•-]+|[\s:：*]+$/gu, '');
  if (/^(?:(?:lab|laboratory)\s+)?reports?$|^(?:实验)?报告$/iu.test(heading)) return 'report';
  if (/^(?:source\s+)?codes?$|^(?:源)?代码$/iu.test(heading)) return 'code';
  return undefined;
}

/** 提取明确编号，不把课程号、班组号或日期当成作业编号。 */
export function taskReferences(text: string): DeadlineTask[] {
  return [...text.matchAll(taskPattern)].map(/** 将常见中英文名称归到相同任务类型。 */ function normalize(match) {
    const word = match[1].toLowerCase();
    const kind = /assignment|homework|hw|作业/.test(word) ? 'assignment' : /report|报告/.test(word) ? 'report' : /project|项目/.test(word) ? 'project' : /code|代码/.test(word) ? 'code' : 'lab';
    return { kind, number: match[2].replace(/^0+(?=\d)/u, '') };
  });
}

/** 识别提问对象；没有显式编号时仍保留报告/代码等类型，避免泛化到所有作业。 */
export function requestedTask(question: string): DeadlineTask {
  const references = taskReferences(question);
  const detail = /report|报告/i.test(question) ? 'report' : /\bcode|代码/i.test(question) ? 'code' : undefined;
  if (detail) {
    const explicit = references.find(/** 显式报告/代码编号优先于实验编号。 */ function same(ref) { return ref.kind === detail; });
    if (explicit) return explicit;
    const labs = references.filter(/** Lab N Report作为目标名称线索，后续匹配仍标相关候选。 */ function lab(ref) { return ref.kind === 'lab'; });
    if (labs.length === 1) return { kind: detail, number: labs[0].number };
  }
  return references[0] ?? { kind: /report|报告/i.test(question) ? 'report' : /code|代码/i.test(question) ? 'code' : /project|项目/i.test(question) ? 'project' : /lab|实验/i.test(question) ? 'lab' : 'assignment' };
}

/** 完整任务名可确认匹配；Lab N + report/code只作为相关候选，不能仅靠同编号混同任务。 */
export function matchTask(text: string, task: DeadlineTask): 'exact' | 'related' | undefined {
  const refs = taskReferences(text);
  if (refs.some(/** 同类且同编号才是直接匹配。 */ function exact(ref) { return ref.kind === task.kind && (!task.number || ref.number === task.number); })) return 'exact';
  if (refs.some(/** 显式不同报告/作业编号不能被实验号覆盖。 */ function different(ref) { return ref.kind === task.kind; })) return undefined;
  const lab = refs.filter(/** 实验编号只能建立候选关系。 */ function labs(ref) { return ref.kind === 'lab'; });
  if (['report', 'code'].includes(task.kind) && lab.length === 1 && (!task.number || lab[0].number === task.number) && (task.kind === 'report' ? /report|报告/i : /code|代码/i).test(text)) return 'related';
  if (!task.number && (task.kind === 'report' ? /report|报告/i : task.kind === 'code' ? /code|代码/i : task.kind === 'project' ? /project|项目/i : task.kind === 'lab' ? /lab|实验/i : /assignment|homework|作业|\bhw/i).test(text)) return 'exact';
  return undefined;
}
