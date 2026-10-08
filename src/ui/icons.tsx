/** 文件用途：提供侧栏使用的统一线条图标，图标本身不代替可访问的文字标签。 */
import type { SVGProps } from 'react';

type IconName = 'book' | 'settings' | 'arrow' | 'close' | 'chevron' | 'external' | 'refresh' | 'stop';
const paths: Record<IconName, string> = {
  book: 'M12 5.5C9.5 3.8 6 3.6 3 4.5v15c3-1 6.5-.8 9 1m0-15c2.5-1.7 6-1.9 9-1v15c-3-1-6.5-.8-9 1m0-15v15',
  settings: 'M9 4.5l.6-2h4.8l.6 2 2 .9 1.9-.5 2.4 4.2-1.4 1.5v2.8l1.4 1.5-2.4 4.2-1.9-.5-2 .9-.6 2H9l-.6-2-2-.9-1.9.5-2.4-4.2 1.4-1.5v-2.8L2.1 9.1l2.4-4.2 1.9.5 2-.9M15.5 12a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0',
  arrow: 'M12 19V5m-6 6 6-6 6 6',
  close: 'm6 6 12 12M18 6 6 18',
  chevron: 'm9 5 7 7-7 7',
  external: 'M14 3h7v7m0-7L10 14M10 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5',
  refresh: 'M20 7v5h-5m4.2-3.5a8 8 0 1 0 .4 7',
  stop: 'M7 7h10v10H7z',
};

/** 根据名称绘制无障碍隐藏的装饰图标；控件负责提供自己的标签。 */
export function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: IconName }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}><path d={paths[name]} /></svg>;
}
