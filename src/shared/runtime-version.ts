/** 文件用途：约定侧栏与后台的消息协议，防止本地构建更新后旧 worker 继续接收新操作。 */
export const RUNTIME_PROTOCOL = 2;
export const RELOAD_REQUIRED_MESSAGE = '插件界面与后台版本不一致，请重新加载插件。仅刷新 Blackboard 页面不会更新后台。';
