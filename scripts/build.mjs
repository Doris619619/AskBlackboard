/** 文件用途：构建 React 侧栏及不依赖远程代码的经典格式扩展脚本。 */
import { build as viteBuild } from 'vite';
import { build as esbuild } from 'esbuild';

await viteBuild();
for (const entry of ['background', 'content']) {
  await esbuild({ entryPoints: [`src/extension/${entry}.ts`], outfile: `dist/${entry}.js`, bundle: true, format: 'iife', platform: 'browser', target: 'chrome116', minify: true });
}
