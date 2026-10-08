/** 文件用途：提供键盘可用的个人模型和外观设置表单；密钥仅交给受信设置模块。 */
import { useEffect, useRef, useState } from 'react';
import { friendlyError } from '../shared/errors';
import type { Settings } from '../shared/types';
import { Icon } from './icons';

interface Props { settings: Settings; onSave: (settings: Settings) => Promise<void>; onClose: () => void; extensionAvailable: boolean }

/** 打开原生模态对话框并保存设置；空密钥输入保留之前配置，单独按钮允许清除。 */
export function SettingsDialog({ settings, onSave, onClose, extensionAvailable }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [apiKey, setApiKey] = useState('');
  const [theme, setTheme] = useState<Settings['theme']>(settings.theme);
  const [model, setModel] = useState(settings.model);
  const [clearKey, setClearKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  /** 使用浏览器原生焦点约束；关闭时由浏览器恢复触发设置按钮的焦点。 */
  useEffect(function showDialog() { const element = dialog.current; element?.showModal(); return /** 使用捕获的节点关闭原生对话框，兼容 StrictMode 和 ref 已清除的卸载。 */ function cleanup() { element?.close(); }; }, []);

  /** 提交掩码输入和外观选择；密钥不在界面回显，也不写入本地网页预览。 */
  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    if (saving) return;
    if (!extensionAvailable) { setError('请在浏览器加载扩展后保存设置。'); return; }
    const nextKey = clearKey ? '' : apiKey.trim() || settings.apiKey;
    if (apiKey.trim() && !apiKey.trim().startsWith('sk-')) { setError('请检查 DeepSeek API 密钥，应以 sk- 开头。'); return; }
    if (model.trim() && !/^[a-z0-9][a-z0-9._-]{0,79}$/i.test(model.trim())) { setError('模型名称只能使用英文字母、数字、点、下划线和连字符。'); return; }
    setSaving(true);
    try { await onSave({ apiKey: nextKey, model: model.trim() || 'deepseek-flash', theme }); onClose(); }
    catch (caught) { setError(friendlyError(caught)); }
    finally { setSaving(false); }
  }

  /** 点击明确的清除操作只修改草稿，按保存后才会删除受信存储中的密钥。 */
  function handleClearKey() { setClearKey(true); setApiKey(''); }

  return <dialog ref={dialog} className="settings-dialog" aria-labelledby="settings-title" onCancel={/** 保存期间等待操作结束；其它状态 Escape 使用同一关闭入口。 */ function handleCancel(event) { event.preventDefault(); if (!saving) onClose(); }}>
    <form onSubmit={handleSubmit}>
      <div className="sheet-heading"><h2 id="settings-title">设置</h2><button className="icon-button" type="button" aria-label="关闭设置" disabled={saving} onClick={onClose}><Icon name="close" /></button></div>
      <p className="sheet-intro">连接 DeepSeek，按课程公告回答你的问题。</p>
      <div className="settings-group">
        <label htmlFor="api-key">API 密钥</label>
        <input autoFocus id="api-key" type="password" autoComplete="off" spellCheck={false} value={apiKey} placeholder={settings.apiKey && !clearKey ? '已配置 · 输入新密钥可更换' : '输入 DeepSeek API 密钥'} onChange={/** 只在当前表单内保存密钥草稿。 */ function handleKeyChange(event) { setApiKey(event.target.value); setClearKey(false); }} />
        <p className="field-help">保存在当前浏览器扩展中。回答时会将该课程公告发送给 DeepSeek。</p>
        {settings.apiKey && <button type="button" className="text-button" disabled={clearKey} onClick={handleClearKey}>{clearKey ? '保存后清除密钥' : '清除已保存的密钥'}</button>}
      </div>
      <div className="settings-group"><label htmlFor="model">模型</label><input id="model" value={model} autoComplete="off" spellCheck={false} onChange={/** 模型名称允许使用服务当前支持的个人模型。 */ function handleModelChange(event) { setModel(event.target.value); }} /><p className="field-help">默认 deepseek-flash。</p></div>
      <div className="settings-group"><label htmlFor="appearance">外观</label><select id="appearance" value={theme} onChange={/** 外观在保存后通过页面语义主题切换。 */ function handleThemeChange(event) { setTheme(event.target.value as Settings['theme']); }}><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></div>
      {error && <p className="inline-error" role="alert">{error}</p>}
      <div className="sheet-actions"><button type="button" className="secondary-button" disabled={saving} onClick={onClose}>取消</button><button type="submit" className="primary-button" disabled={saving}>{saving ? '保存中…' : '保存设置'}</button></div>
    </form>
  </dialog>;
}
