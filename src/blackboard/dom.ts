/** 文件用途：提取 Blackboard DOM 中的纯文本，并识别登录、协议及不完整响应。 */
import { AppError } from '../shared/errors';

const blockNames = new Set(['P', 'DIV', 'LI', 'UL', 'OL', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'SECTION', 'ARTICLE', 'TR', 'TABLE', 'BLOCKQUOTE']);
const ignoredNames = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'INPUT', 'BUTTON', 'SELECT', 'TEXTAREA']);

/** 将 DOM 文本转换为保留段落的纯文字；不执行页面 HTML 或收集表单值。 */
export function plainText(node: Node | null): string {
  if (!node) return '';
  let output = '';
  /** 逐个读取文字节点并在块边界加换行，忽略脚本和输入控件。 */
  function visit(current: Node): void {
    if (current.nodeType === 3) { output += current.textContent ?? ''; return; }
    if (current.nodeType !== 1 && current.nodeType !== 9 && current.nodeType !== 11) return;
    const name = current.nodeType === 1 ? (current as Element).tagName.toUpperCase() : '';
    if (ignoredNames.has(name)) return;
    if (name === 'BR') { output += '\n'; return; }
    const block = blockNames.has(name);
    if (block && output && !output.endsWith('\n')) output += '\n';
    for (const child of current.childNodes) visit(child);
    if (block && !output.endsWith('\n')) output += '\n';
  }
  visit(node);
  return output.replace(/\u00a0/g, ' ').replace(/[\t \f\v]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** 在解析目录或公告前识别登录及协议页面，防止 HTTP 200 被当作有效数据。 */
export function assertReadableDocument(document: Document): void {
  if (document.querySelector('input[type="password"], #loginForm, #loginFormList, form[action*="login"]')) throw new AppError('login_required', '请在 Blackboard 页面正常登录，再回来查询。');
  const title = plainText(document.querySelector('title'));
  const text = plainText(document.body);
  if (!text && !document.querySelector('#announcementList')) throw new AppError('unsupported_page', 'Blackboard 返回了空页面，未读取到公告。');
  if (/^(?:Sign In|Log In|Login|登录)(?:\s|$)/i.test(title)) throw new AppError('login_required', '登录状态已过期，请重新登录 Blackboard。');
  for (const dialog of document.querySelectorAll('[role="dialog"], dialog[open], .lightbox, .modal')) {
    if (dialog.hasAttribute('hidden') || dialog.getAttribute('aria-hidden') === 'true' || /display\s*:\s*none/i.test(dialog.getAttribute('style') ?? '')) continue;
    if (/(?:Accept.*(?:Terms|Privacy)|Privacy.*(?:Terms|Agreement)|接受.*(?:条款|协议)|隐私.*使用条款)/i.test(plainText(dialog))) throw new AppError('consent_required', '请在 Blackboard 页面处理学校的条款提示，再重新查询。');
  }
  if (!document.querySelector('#My_Courses_Tools, #announcementList') && /(?:Accept.*(?:Terms|Privacy)|Privacy.*(?:Terms|Agreement)|接受.*(?:条款|协议)|隐私.*使用条款)/i.test(text)) throw new AppError('consent_required', '请在 Blackboard 页面处理学校的条款提示，再重新查询。');
}

/** 从 HTML 响应建立仅供读取的 DOM；空白响应直接失败。 */
export function parseHtml(html: string): Document {
  if (!html.trim()) throw new AppError('unsupported_page', 'Blackboard 返回了空页面，未读取到公告。');
  return new DOMParser().parseFromString(html, 'text/html');
}

/** 计算无凭据的稳定文本标识，供缺少 DOM ID 的公告回跳定位。 */
export function textFingerprint(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16);
}
