<!-- 文件用途：记录已实施的公告问答首版架构、接口、限制和后续路线。 -->
# Blackboard 公告问答技术方案

实施日期：2026 年 10 月 8 日。个人版目标：在侧栏问 GED2005 的 Quiz 日期，按最新可见公告回答，并提供原文及回跳路径。仓库 `D:\Repo\bb`，远端 `Doris619619/AskBlackboard`，分支 `feat/20261007-bb-quiz-assistant`。

## 架构

Manifest V3、TypeScript、React、Vite，npm 锁定依赖。后台和内容脚本为独立打包脚本；没有本地 AI 代理或云端历史库。

```mermaid
flowchart LR
  U[侧栏提问] --> B[后台寻找学校标签页]
  B --> C[内容脚本同源只读 GET]
  C --> D[课程公告及分页解析]
  C -. 备用 .-> T[专用采集标签页 DOM]
  D --> U
  U --> M[侧栏直连 DeepSeek]
  M --> V[程序校验引用和时间]
  V --> R[答案、摘录、路径、覆盖范围]
  R --> P[打开原文、滚动及高亮]
```

学校登录使用正常浏览器流程，Cookie 不离开浏览器。后台协调标签页，内容脚本仅接受本扩展内部消息。读取仅限学校同源门户和公告 GET，拒绝作答、提交、编辑和跨站地址。

## 课程与公告

解析真实 My_Courses_Tools 模块的学期、课程 ID、名称、代码及教学班。账号姓名兼容导航链接和按钮，仅读取其显示标签，不放宽通用正文对按钮、输入框和脚本的忽略规则。公告入口来自实际链接，不硬编码课程 ID。默认学期仅从含有效课程的四位 UG/PG 编号中按时间排序，排除 No Term Assigned 等文字标签和空分组；无编号时回退第一门有效课程的学期。仅当前学期只有一门课程时自动默认选择；多课程账号初始为空。`course-resolution.ts` 在采集前优先匹配问题中的完整课程号或目录中真实存在的编号前缀简称（如 GEB），只在唯一时自动切换。多课程、多班组、历史学期需要明确选择；没有课程指代时才使用顶部选择。支持 ged2005、GED 2005、GED-2005，不对 GEB/GED 做模糊纠错。

解析 announcementList，正文读取整个 .vtbegenerated，包含 MessageUniqueBody 之前的内容。所有已识别安全分页逐页读取：最多 20 页、约 60 秒，每页 15 秒。缺正文、超过上限或后续分页失败显示 partial；登录、错误或条款页不能当成空公告。

每条来源包含 sourceId、courseId、title、publishedAt、body、url、anchorId、breadcrumb、fetchedAt。整轮快照含 coverage.status、pagesRead 与警告。

每个新问题刷新选定课程全部可见公告，完整正文直接作为模型证据；不建立向量数据库和历史库。模型重试复用本轮检索时间明确的证据，会话只存侧栏内存。

## 模型与证据

固定接口 https://api.deepseek.com/chat/completions，默认 deepseek-flash，thinking.type=disabled，stream=false，response_format.type=json_object，max_tokens=1024，60 秒超时。密钥在 chrome.storage.local 的 TRUSTED_CONTEXTS 中，内容脚本不能读取，不经 runtime 消息传递。

模型输出 {status, answer, citations}。status 为 found、not_found、conflict，引用为 {sourceId, quote}。程序验证 JSON、选定课程来源、原文连续摘录和可识别的日期、星期、钟点与时长；分别绑定测验编号与教学班，区分明确改期与冲突。无效输出报错并保留公告，模型不生成可点击链接。

相对周表达按方向和星期归一化，中英文可以对应，但不把相对周转换为日历日期；明确星期可支持仅提及该周的较粗表达，反向禁止补星期。

日期校验覆盖已测试格式，并非所有自然语言的完整逻辑证明。复杂表述仍依赖模型说明不确定；被拒绝时可直接查看来源。只读公告不代表查遍课程资料。

出处由课程公告 URL 和真实条目锚点生成，后台打开后内容脚本滚动并高亮。不读取公告中指向测验作答或作业提交的链接。

## 界面与恢复

顶部课程、教学班及连接状态；中间会话和展开出处；底部输入。系统字体、15px 回答正文、紫色强调、深浅主题、44px 主要操作，键盘和中文输入法，减少动画及窄侧栏。设计审查与实际截图分别记录。

视口高度不超过 600px 或宽度不超过 260px 时改为整页滚动，避免实际 200% 缩放后固定头尾挤压正文。设置关闭后在 React 卸载模态节点的下一动画帧恢复设置按钮焦点。2026-10-14 已在真正 Edge 侧栏验证；见验收记录。

鉴权、余额、限速、服务不可用、断网、超时、截断及引用无效均显示可恢复提示，避免展示提供商原始错误。学校读取失败不回答“没有 quiz”。取消后忽略迟到采集结果。

## 真实验收基线

2026 年 10 月 8 日的 GED2005 L01 属于 2610UG，可见 4 条公告。最新标题 Class Announcement: Quiz 1 and Tutorial Schedule，发表于 2026 年 10 月 7 日，原文包含：

> Quiz 1 will take place on Monday, October 12.

支持 Quiz 1 在 2026 年 10 月 12 日，时长 20 分钟，未注明开始时刻。9 月 22 日旧公告同日。此为验收基线，日期不写入运行代码，每次仍重新读取。

实际扩展、真实模型、逐条对账、出处回跳及截图以 docs/验收记录.md 为准。

## 后续与依据

PDF、课纲、日历、提醒、历史库、后台同步及多人账号另立任务。官方 Blackboard REST/OAuth 需要学校管理员开放，个人首版不依赖它。Chrome 需独立加载测试，Edge 结果不能代替。

- [Chrome Side Panel](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)
- [Chrome 内容脚本网络](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)
- [Chrome 存储](https://developer.chrome.com/docs/extensions/reference/api/storage)
- [DeepSeek API](https://api-docs.deepseek.com/)
- [Apple Typography](https://developer.apple.com/design/human-interface-guidelines/typography)
