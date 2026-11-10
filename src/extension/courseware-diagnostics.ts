/** 文件用途：为课件故障生成仅包含页面类别和参数形状的诊断文本。 */
import { BLACKBOARD_ORIGIN } from '../blackboard/policy';

const pages = new Map([
  ['/webapps/blackboard/execute/courseMain', '课程入口（courseMain）'],
  ['/webapps/blackboard/execute/modulepage/view', '课程首页（modulepage）'],
  ['/webapps/blackboard/content/listContent.jsp', '课件目录（listContent）'],
  ['/webapps/blackboard/content/launchLink.jsp', '课程菜单链接（launchLink）'],
  ['/webapps/blackboard/execute/launcher', '课程启动页（launcher）'],
  ['/webapps/blackboard/execute/announcement', '公告页'],
  ['/webapps/portal/execute/tabs/tabAction', '学校门户'],
]);
const parameterNames = ['course_id', 'content_id', 'cmp_tab_id', 'toc_id', 'mode', 'tool_id', 'tool_type', 'cmd', 'type', 'url', 'id', 'framesetWrapped', 'context', 'handle', 'method'];

/** 将地址压缩为固定类别、参数出现次数和课程匹配状态，不返回 URL 或参数值。 */
export function coursewareUrlShape(value: string, courseId: string): string {
  let url: URL;
  try { url = new URL(value); } catch { return '无效地址'; }
  if (url.origin !== BLACKBOARD_ORIGIN || url.username || url.password) return '非 Blackboard 地址';
  let page = pages.get(url.pathname) ?? '其他 Blackboard 页面';
  if (/\/(?:assessment|quiz)(?:\/|$)/i.test(url.pathname)) page = '测验或作答入口';
  else if (/\/(?:assignment|uploadAssignment)(?:\/|$)/i.test(url.pathname)) page = '作业入口';
  else if (/\/(?:login|signon|sso)(?:\/|$)/i.test(url.pathname)) page = '登录页';
  const parameters = [];
  for (const name of parameterNames) {
    const count = url.searchParams.getAll(name).length;
    if (count) parameters.push(count === 1 ? name : `${name}×${count}`);
  }
  const other = [...url.searchParams.keys()].filter(/** 统计未知参数，避免显示其名称或值。 */ function unknown(name) { return !parameterNames.includes(name); }).length;
  if (other) parameters.push(`其他×${other}`);
  const ids = url.searchParams.getAll('course_id');
  const scope = ids.length === 0 ? '无课程参数' : ids.length === 1 && ids[0] === courseId ? '课程匹配' : '课程参数不符';
  return `${page}，${scope}，参数 ${parameters.join('、') || '无'}`;
}
