/** 文件用途：挂载浏览器侧栏 React 工作区和语义化主题样式。 */
import { createRoot } from 'react-dom/client';
import { App } from './app';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('侧栏挂载节点不存在。');
createRoot(root).render(<App />);
