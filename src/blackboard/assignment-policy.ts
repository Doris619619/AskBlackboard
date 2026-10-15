/** 文件用途：限定作业元信息读取为课程入口和内容文件夹，禁止访问上传、作答、文件和工具入口。 */
import { AppError } from '../shared/errors';
import { BLACKBOARD_ORIGIN, schoolUrl } from './policy';

export const CONTENT_PATH = '/webapps/blackboard/content/listContent.jsp';
export const COURSE_PATH = '/webapps/blackboard/execute/courseMain';
const MODULE_PATH = '/webapps/blackboard/execute/modulepage/view';
const allowedKeys = new Set(['course_id', 'content_id', 'cmp_tab_id', 'mode']);

/** 校验课程范围和只读路径；不允许重复参数或借 mode 执行编辑操作。 */
export function assignmentReadUrl(value: string, courseId: string, base = BLACKBOARD_ORIGIN): URL {
  const url = schoolUrl(value, base);
  if (!/^_\d+_\d+$/.test(courseId) || url.searchParams.get('course_id') !== courseId) throw new AppError('course_mismatch', '作业页面与所选课程不一致。');
  if (![CONTENT_PATH, COURSE_PATH, MODULE_PATH].includes(url.pathname)) throw new AppError('unsafe_url', '只能读取课程内容列表，不能进入作答或提交页面。');
  for (const key of url.searchParams.keys()) {
    if (!allowedKeys.has(key) || url.searchParams.getAll(key).length !== 1) throw new AppError('unsafe_url', '课程列表包含不支持的操作参数。');
  }
  if (!['', 'view', 'reset'].includes(url.searchParams.get('mode') ?? '')) throw new AppError('unsafe_url', '不支持编辑课程页面。');
  for (const key of ['content_id', 'cmp_tab_id']) if (url.searchParams.has(key) && !/^_\d+_\d+$/.test(url.searchParams.get(key)!)) throw new AppError('unsafe_url', '课程内容标识无效。');
  if (url.pathname === CONTENT_PATH && !url.searchParams.has('content_id')) throw new AppError('unsafe_url', '缺少课程内容文件夹。');
  url.hash = '';
  return url;
}

/** 课程 ID 必须由门户发现，入口仅用于寻找实际可见内容列表链接。 */
export function assignmentEntry(courseId: string): string {
  return assignmentReadUrl(`${BLACKBOARD_ORIGIN}${COURSE_PATH}?course_id=${encodeURIComponent(courseId)}`, courseId).href;
}
