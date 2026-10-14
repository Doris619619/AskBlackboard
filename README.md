<!-- 文件用途：说明 AskBlackboard 首版的安装、使用、开发和验证边界。 -->
# AskBlackboard

在 Edge 或 Chrome 侧栏提问“GED2005 的 quiz 是啥时候”，读取当前登录账号可见的课程公告，返回有原文依据的回答和可定位的来源。

## 安装

1. 使用 Edge 116+ 或 Chrome 116+，正常登录 [学校 Blackboard](https://bb.cuhk.edu.cn/)。
2. 打开 `edge://extensions` 或 `chrome://extensions`，开启开发人员模式，选择“加载解压缩的扩展”。
3. 选择 `D:\Repo\bb\dist`。ZIP 使用前先解压，选择包含 `manifest.json` 的目录。
4. 刷新已经打开的 Blackboard 标签页，让内容脚本生效。点击 AskBlackboard 按钮打开侧栏。
5. 设置中填写 DeepSeek API 密钥，默认模型为 `deepseek-flash`。

构建目录 `dist/`，压缩包 `artifacts/AskBlackboard-0.1.0.zip`。安装本地扩展需由使用者确认权限。

## 使用

- 顶部默认选择最新有效学期编号下唯一的 GED2005；“No Term Assigned”不作为最新学期。同编号多个班时先选择课程，也可询问其他课程。
- Enter 发送，Shift+Enter 换行，中文输入法确认候选词不会发送。
- 每个新问题重新读取所选课程公告和分页。模型重试复用该轮显示检索时间的原文。
- 展开出处查看标题、发布时间、摘录与路径。“打开公告原文”定位学校公告条目。
- 公告只有日期或时长时说明未注明开始时刻；Quiz 2 无依据时不借 Quiz 1 日期。
- 模型鉴权、余额、网络、超时或引用无效时保留已读取公告，可重试或直接查原文。
- 登录失效时在学校页面重新登录，再刷新课程或重试读取。
- 设置支持跟随系统、浅色、深色；关闭设置恢复键盘焦点。主要操作至少 44px，回答正文 17px；高倍缩放或短侧栏使用整页滚动，保证正文可读。

首版只查公告，不读取 PDF、课纲、课程内容、测验作答或作业提交；不提供日历、提醒和后台同步。分页无法读全时显示资料不完整。

## 数据与权限

仅申请 `storage`、`sidePanel` 及 Blackboard、DeepSeek 两个域名。学校密码与 Cookie 留在浏览器。密钥存于扩展受信的 `chrome.storage.local`，不发给学校页面、不随安装包分发。

密钥没有内置在代码里。不同浏览器配置文件各自保存密钥和学校登录状态；独立验收窗口需要使用者自行登录并配置。

提问时，问题和所选课程公告正文发送给 DeepSeek。来源链接由程序生成，引用必须存在于本轮公告，摘录必须属于原文。会话和公告只保留在当前侧栏内存中，不建立历史数据库。

## 开发

Node.js 22.12+ 与 npm：

```powershell
Set-Location D:\Repo\bb
npm ci
npm run check
npm run package
```

`npm run dev` 提供空状态界面预览，不连接学校、不存密钥、不生成示例答案。实际功能需加载扩展。改源码后重新构建，在扩展管理页重新加载并刷新学校页面。

浏览器回归会加载实际扩展，但学校和模型响应使用虚构数据，不能代替真实账号验收：

```powershell
npx playwright install chromium
npm run test:browser
# 使用本机 Edge 时，可指定其实际安装路径：
$env:BB_BROWSER_EXECUTABLE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
npm run test:browser
```

测试使用独立 `.local/browser-smoke-*` 配置，不继承日常浏览器凭据；启用离线网络并由测试路由返回虚构资料。报告和截图位于 `artifacts/browser-smoke/`。学校、真实模型和真正侧栏的最新验收结果见 [验收记录](docs/验收记录.md#2026-10-14-edge-真实验收)。

| 目录 | 职责 |
| --- | --- |
| `src/blackboard/` | 课程发现、安全地址、DOM 解析、分页及定位 |
| `src/extension/` | 后台协调与内容脚本入口 |
| `src/ai/` | 模型请求、提示词及证据校验 |
| `src/shared/` | 类型、受信设置、错误和消息客户端 |
| `src/ui/` | 侧栏、会话、出处及设置 |
| `tests/` | 虚构样本解析、依据和错误恢复测试 |
| `scripts/` | 构建与打包 |

`public/manifest.json` 定义权限与入口，`package.json` 定义命令，`tsconfig.json` 定义类型检查；`package-lock.json` 为自动依赖锁文件，不手工插入 JSON 注释。

工程约定见 [AGENTS.md](AGENTS.md)、[工程协作规范](docs/工程协作规范.md)、[PR 撰写规范](docs/PR撰写规范.md)。架构见 [技术方案](TECHNICAL_PLAN.md)，检查证据见 [验收记录](docs/验收记录.md)。
