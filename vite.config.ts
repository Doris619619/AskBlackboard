/** 文件用途：构建相对路径的扩展侧栏页面，避免远程脚本或站点根路径。 */
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: { rollupOptions: { input: 'sidepanel.html' }, outDir: 'dist' },
});
