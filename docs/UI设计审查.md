<!-- 文件用途：记录 AskBlackboard 侧栏的 Apple HIG 设计依据、量化检查、已修正问题与真实界面验收边界。 -->
# AskBlackboard UI 设计审查

审查日期：2026 年 10 月 8 日。审查对象：`src/ui/` 的实际 React、交互和 CSS。界面运行于 Windows Edge／Chrome 桌面侧栏，采用 iOS HIG 的阅读层级、控制尺寸、系统字体及语义外观原则。CSS 像素是本产品的工程单位；不把网页样式等同于 UIKit 的点、原生 Dynamic Type、VoiceOver 认证或 iOS 应用审核结果。

## 设计判断

本版以课程选择、问答、原文来源为三个连续区域，保留底部输入和单一蓝色主操作。采用普通列表及分隔线展示资料，用可展开条目承载长原文；没有营销首屏、功能卡片拼盘或无用途的装饰动画。

成熟产品结构参考来自 [Google 官方 Gemini in Chrome 侧栏展示](https://blog.google/products-and-platforms/products/chrome/gemini-3-auto-browse/) 和 [Microsoft 官方 Copilot Chat in Edge](https://learn.microsoft.com/en-us/copilot/edge)。参考其在网页旁持续提问的交互形态，不复制商标、资源或声称像素级复刻。AskBlackboard 的课程和证据列表按自身场景设计。

## 量化检查

| 检查项 | 本版标准与实现 | 当前证据 |
| --- | --- | --- |
| 正文和输入 | 问题、回答、引用、完整公告、课程选择、输入与设置字段均为 17px；操作文字 15px，辅助信息最低 13px；根字号和正文使用 rem 层级 | CSS 静态检查已满足；见 [Apple Typography](https://developer.apple.com/design/human-interface-guidelines/typography) |
| 命中区域 | 主操作、设置、发送、停止为 44×44px；按钮和表单控件至少 44px 高，资料展开条目至少 44px 高 | CSS 静态检查已满足；见 [Apple Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons) |
| 可读对比 | 有效正文、辅助信息和操作文字在各实际语义背景上至少 4.5:1 | 已按 WCAG 相对亮度公式计算，下表记录具体值；见 [Apple Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility) |
| 深浅外观 | 默认跟随系统；自定义语义变量分别提供浅色、深色、高对比组合，避免简单反色 | CSS 检查已满足；真实不同外观截图仍需记录；见 [Apple Color](https://developer.apple.com/design/human-interface-guidelines/color) 与 [Dark Mode](https://developer.apple.com/design/human-interface-guidelines/dark-mode) |
| 缩放与窄宽 | 使用可换行文本、可缩 flex 子项、表单 min-width:0、可折行操作；dialog 显式限制到视口宽度；短视口改用页面滚动 | 已审查 320px 和 160px 布局约束，尚未据此宣称真实 200% 缩放通过；见 [Apple Layout](https://developer.apple.com/design/human-interface-guidelines/layout) |
| 键盘与焦点 | 原生 select、button、details、dialog；明确标签；3px focus-visible 焦点环；Escape 关闭设置，Enter 发送、Shift+Enter 换行，输入法组字不发送 | 交互代码已检查；真实 Tab 顺序、焦点恢复及输入法仍需验收；见 [Apple Focus and Selection](https://developer.apple.com/design/human-interface-guidelines/focus-and-selection) |
| 动画和反馈 | 按下反馈、读取／回答文字状态、可停止和重试；prefers-reduced-motion 去除全部自定义动画与过渡 | CSS 和事件已检查；见 [Apple Motion](https://developer.apple.com/design/human-interface-guidelines/motion) |
| AI 与来源 | 明确显示“AI 回答”；结果采用礼貌 live status；保留来源标题、原文、路径及检索时间；失败后可读原文 | React 实现已检查；屏幕阅读器的实际播报待验收；见 [Apple Generative AI](https://developer.apple.com/design/human-interface-guidelines/generative-ai) |
| 安全字段 | API 密钥采用 password 输入且不预填回显；保存、关闭和字段标签明确 | 代码已检查；见 [Apple Entering Data](https://developer.apple.com/design/human-interface-guidelines/entering-data) |

Apple 官方字号表的 iOS Body 默认是 17pt，辅助层级可更小；本产品为网页将其作为层级依据，采用更保守的 13px 辅助文字下限。44px 对应本版选用的触控友好目标，不据此声称与各设备物理尺寸完全一致。

## 已修正的不足

- 原辅助提示 `.64rem` 仅 10.88px，连接状态、来源日期和路径也偏小。已改成统一 17／15／13px 语义字号，重要原文和设置输入不再缩到 13–15px。
- 原按钮只有 hover 状态；已补明确的 active 按下反馈。
- 原“根据课程公告”未在结果处直接标明 AI；已改为“AI 回答”，并提供稳定的 status 区域，让完成信息可被辅助技术获取。
- 已补系统深色与高对比同时开启时的颜色变体，以及原生 dialog 默认最大宽度在极窄窗口中的限制。

## 颜色计算记录

数值为 CSS 最终语义颜色的静态计算，使用 sRGB 线性化后按 `(较亮相对亮度 + 0.05) / (较暗相对亮度 + 0.05)` 计算。禁用控件的淡化状态不作为有效正文结论。

| 前景／背景 | 对比度 |
| --- | --- |
| 浅色正文 `#1c1c1e`／页面 `#f2f2f7` | 15.25:1 |
| 浅色辅助文字 `#62626b`／页面 `#f2f2f7` | 5.41:1 |
| 浅色辅助文字 `#62626b`／白色表面 | 6.04:1 |
| 浅色操作蓝 `#0064db`／页面 `#f2f2f7` | 4.89:1 |
| 白色按钮文字／操作蓝 `#0064db` | 5.46:1 |
| 深色辅助文字 `#b1b1bb`／页面 `#151518` | 8.57:1 |
| 深色辅助文字 `#b1b1bb`／弹窗 `#2c2c2e` | 6.55:1 |
| 深色操作蓝 `#5ca2ff`／弹窗 `#2c2c2e` | 5.35:1 |
| 深色按钮文字 `#091d37`／操作蓝 `#5ca2ff` | 6.49:1 |
| 浅色错误文字 `#ad2929`／页面 `#f2f2f7` | 6.02:1 |
| 深色错误文字 `#ff9690`／弹窗 `#2c2c2e` | 6.65:1 |

## 真实界面验收边界

以下项目不能只凭源码或构建结果标为通过，最终结果应由主代理写入运行验收记录，并提供截图或设备证据。

- [ ] Edge 真实侧栏在 320px 宽下，空状态、回答、长来源及设置无水平溢出。
- [ ] 真实 200% 浏览器缩放下仍可读完整答案、打开来源、操作输入和设置；160px 测宽只是额外布局压力检查，不等同于真实缩放测试。
- [ ] 浅色、深色和高对比实际截图的层级、字重和控件没有退化。
- [ ] Tab 顺序、dialog 焦点约束与关闭恢复、Enter／中文输入法、资料展开和来源回跳均真实操作通过。
- [ ] 减少动画开启后，进度文本和完成状态仍清楚；屏幕阅读器正确读出状态与控件标签。

本审查完成官方资料核验、实现静态审阅、字号修正、语义颜色计算及 TypeScript 检查。未进行原生 iPhone/iPad、VoiceOver 或 Apple Accessibility Inspector 测试，不将这些能力写成已验收结果。

### 2026-10-14 实际 Edge 补充

在真正Edge侧栏完成深浅外观、Enter提问、出处高亮、Escape关闭与焦点恢复、实际200%缩放以及减少动画媒体模拟。200%时视口为191×424 CSS px，原正文区域仅44px高；现对高度≤600px或宽度≤260px的视口改用整页滚动，正文不被固定头尾遮挡，横向无溢出。对话框关闭后显式恢复设置按钮焦点。

另在真实Edge扩展页面、虚构网络回归中通过320px宽度检查；不把它写作手动调整真正侧栏到320px的验收。高对比、实体中文输入法和屏幕阅读器仍待人工验证。截图与详细边界见[最新验收记录](验收记录.md#2026-10-14-edge-真实验收)。
