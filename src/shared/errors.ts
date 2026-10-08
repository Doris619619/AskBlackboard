/** 文件用途：提供可显示给用户且不会包含凭据的错误类型。 */
export class AppError extends Error {
  /** 创建带稳定错误代码的业务错误；message 只包含用户可见说明。 */
  constructor(public code: string, message: string) { super(message); this.name = 'AppError'; }
}

/** 将未知错误转换成无凭据的界面说明，不显示模型或网络原始响应。 */
export function friendlyError(error: unknown): string {
  return error instanceof AppError ? error.message : '操作未完成，请重试；如果仍失败，请刷新 Blackboard 页面。';
}
