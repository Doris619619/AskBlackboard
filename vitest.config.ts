/** 文件用途：在 DOM 环境验证 Blackboard 解析、引用和问答错误处理。 */
import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { environment: 'jsdom', include: ['tests/**/*.test.ts'], fileParallelism: false, isolate: false } });
