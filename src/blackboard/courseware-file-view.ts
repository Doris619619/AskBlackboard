/** 文件用途：从 Blackboard 课件查看页提取指向已选文件的静态链接。 */
import { AppError } from '../shared/errors';
import { coursewareFileUrl, isCoursewareFilename } from './courseware-policy';
import { plainText } from './dom';

/** 已选文件的 PID/RID 或资源 XID 必须与查看页的 WebDAV 地址一致。 */
function sameFile(target: URL, original: URL): boolean {
  if (target.href === original.href) return true;
  const selected = decodeURIComponent(original.pathname).toLowerCase().split('/');
  const candidate = decodeURIComponent(target.pathname).toLowerCase().split('/');
  const rid = /^pid-\d+-dt-content-rid-(\d+_\d+)$/.exec(selected[2])?.[1];
  if (!rid) return false;
  if (candidate.length === 3 && candidate[2] === `xid-${rid}`) return true;
  return candidate.length === 4 && candidate[2] === selected[2] && (!candidate[3].startsWith('xid-') || candidate[3] === `xid-${rid}`);
}

/** 查看页可能带未启用的错误提示占位，只识别显式隐藏状态。 */
function isHidden(element: Element): boolean {
  return element.hasAttribute('hidden') || element.getAttribute('aria-hidden')?.toLowerCase() === 'true'
    || /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\s*(?:!important\s*)?(?:;|$)/i.test(element.getAttribute('style') ?? '');
}

/** 对确切错误标题和明显的拒绝/不可用状态停止下载。 */
function isErrorStatus(text: string): boolean {
  return /^(?:error|错误)\s*[:：]?\s*$/i.test(text)
    || /^(?:(?:error\s*[:：]\s*)?(?:access denied\b|permission denied\b|forbidden\b|not found\b|service unavailable\b|internal server error\b)|(?:an |unexpected )error occurred\b|(?:the )?(?:content|file) (?:is )?(?:not available|unavailable|could not be found)\b|发生错误|访问被拒绝|找不到|服务不可用)/i.test(text);
}

/** 解析惰性模板内容。仅静态的同文件链接可用，不加载标签或执行脚本。 */
export function fileFromCoursewareView(html: string, entry: URL, original: URL): URL {
  const template = document.createElement('template');
  template.innerHTML = html;
  const view = template.content;
  const visible = view.cloneNode(true) as DocumentFragment;
  for (const element of visible.querySelectorAll('[hidden], [aria-hidden], [style]')) if (isHidden(element)) element.remove();
  const title = plainText(visible.querySelector('title'));
  const pageText = plainText(visible).replace(/\s+/g, ' ');
  const statusText = [title, ...Array.from(visible.querySelectorAll('h1, h2, [role="alert"]'), plainText)];
  if (view.querySelector('input[type="password"], #loginForm, #loginFormList, form[action*="login"]')
    || statusText.some(/** 查看页中的登录标题不能触发原链接回退。 */ function login(text) { return /^(?:Sign In|Log In|Login|登录)(?:\s|$)/i.test(text); })) {
    throw new AppError('login_required', '请在 Blackboard 页面重新登录后再下载。');
  }
  if (/(?:Accept.*(?:Terms|Privacy)|Privacy.*(?:Terms|Agreement)|接受.*(?:条款|协议)|隐私.*使用条款)/i.test(pageText)) {
    throw new AppError('consent_required', '请在 Blackboard 页面处理学校的条款提示，再下载课件。');
  }
  const hasError = Array.from(visible.querySelectorAll('#errorMessage, .errorMessage, #errorMsg, .errorMsg')).some(
    /** 空占位不表示出错。 */ function filled(element) { return Boolean(plainText(element)); },
  );
  if (!view.childElementCount || [...statusText, pageText].some(isErrorStatus) || hasError) {
    throw new AppError('file_not_available', 'Blackboard 返回了课件错误页，请在课程页面打开该文件。');
  }

  const matches = new Set<string>();
  let hasOtherTarget = false;
  /** 忽略普通导航，文件或预览目标则必须能与目录选中项对应。 */
  function record(raw: string, explicit: boolean): void {
    if (!raw.trim() || raw.trim() === 'about:blank') return;
    try {
      const target = new URL(raw, entry);
      const refersToFile = explicit || target.pathname.startsWith('/bbcswebdav/') || isCoursewareFilename(decodeURIComponent(target.pathname));
      if (!refersToFile) return;
      const verified = coursewareFileUrl(raw, entry.href);
      if (sameFile(verified, original)) matches.add(verified.href);
      else hasOtherTarget = true;
    } catch { hasOtherTarget = true; }
  }

  for (const link of view.querySelectorAll('a[href], iframe[src], frame[src], embed[src], object[data], meta[http-equiv="refresh" i]')) {
    if (link.localName === 'meta') {
      const address = /;\s*url\s*=\s*(?:"([^"]*)"|'([^']*)'|(.+))/i.exec(link.getAttribute('content') ?? '');
      if (address) record(address[1] ?? address[2] ?? address[3], true);
      continue;
    }
    const attr = link.localName === 'a' ? 'href' : link.localName === 'object' ? 'data' : 'src';
    record(link.getAttribute(attr) ?? '', link.localName !== 'a' || link.hasAttribute('download'));
  }
  if (matches.has(original.href)) return original;
  if (matches.size === 1) return new URL(matches.values().next().value!);
  if (matches.size > 1 || hasOtherTarget) throw new AppError('file_redirect_blocked', '无法核对 Blackboard 课件查看页中的文件地址。');
  // 只有同课程的查看入口已验证，且页面没有声明另一文件时，才回退到教师目录中原先选定的链接。
  return original;
}
