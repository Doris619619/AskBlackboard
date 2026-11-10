/** 文件用途：协调用户选目录、课件逐项保存和受信扩展标签页间的一次性交接。 */
import { useEffect, useRef, useState } from 'react';
import { validateCoursewareDownload } from '../shared/browser-client';
import { saveCoursewareFile } from '../shared/courseware-download';
import { AppError, friendlyError } from '../shared/errors';
import type { CoursewareSelection } from '../shared/courseware-types';
import type { Course } from '../shared/types';

export interface CoursewareBatch { course: Course; files: CoursewareSelection[] }
export type CoursewareResult = { selection: CoursewareSelection; path: string; error?: never } | { selection: CoursewareSelection; path?: never; error: string };
export interface CoursewareReport { batch: CoursewareBatch; results: CoursewareResult[] }
interface HandoffRecord { batch: CoursewareBatch; expiresAt: number }
interface DownloadNotice { message: string; error?: true }
type PickerWindow = Window & { showDirectoryPicker?: (options: { mode: 'readwrite' }) => Promise<FileSystemDirectoryHandle> };
const handoffPrefix = 'courseware-download:';
const handoffLifetime = 5 * 60 * 1000;

/** 从地址片段识别一次性令牌；文件地址和课程数据只留在受信会话存储。 */
export function coursewareHandoffToken(): string | undefined {
  return /^#courseware-download=([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})$/i.exec(location.hash)?.[1];
}

/** 打开扩展独立页接续勾选；删除过期交接，打开失败时撤销这次临时记录。 */
async function handOffBatch(batch: CoursewareBatch): Promise<void> {
  const session = chrome.storage.session;
  const now = Date.now();
  const records = await session.get(null);
  const expired = Object.keys(records).filter(/** 只清理本功能写入的过期记录。 */ function isExpired(key) {
    const record = records[key] as Partial<HandoffRecord> | undefined;
    return key.startsWith(handoffPrefix) && typeof record?.expiresAt === 'number' && record.expiresAt <= now;
  });
  if (expired.length) await session.remove(expired);
  const token = crypto.randomUUID();
  const key = `${handoffPrefix}${token}`;
  const record: HandoffRecord = { batch, expiresAt: now + handoffLifetime };
  await session.set({ [key]: record });
  try { await chrome.tabs.create({ url: chrome.runtime.getURL(`sidepanel.html#courseware-download=${token}`) }); }
  catch (error) { await session.remove(key); throw error; }
}

/** 独立页一次性取走本批勾选；并发打开同一令牌时只有一个页面能取得。 */
export function takeCoursewareBatch(token: string): Promise<CoursewareBatch | undefined> {
  const key = `${handoffPrefix}${token}`;
  return navigator.locks.request(key, /** 按令牌串行读取、删除和检查有效期。 */ async function consume() {
    const session = chrome.storage.session;
    const stored = await session.get(key);
    const record = stored[key] as HandoffRecord | undefined;
    await session.remove(key);
    if (record && record.expiresAt > Date.now()) return record.batch;
  });
}

/** 区分跨工作区一致的文件身份，允许同一文件在不同教师栏目中分别保存。 */
export function coursewareSelectionKey(selection: CoursewareSelection): string {
  return JSON.stringify([...selection.folders.map(/** 保留当前栏目路径的稳定标识。 */ function folderId(folder) { return folder.id; }), selection.file.id]);
}

/** 在有用户点击的上下文选目录和下载，重试时只请求失败项并继续使用已授权目录。 */
export function useCoursewareDownload(canHandOff: boolean, removeSelections?: (selections: CoursewareSelection[]) => void) {
  const [stage, setStage] = useState<'idle' | 'picking' | 'saving'>('idle');
  const [report, setReport] = useState<CoursewareReport | null>(null);
  const [notice, setNotice] = useState<DownloadNotice | null>(null);
  const [needsReload, setNeedsReload] = useState(false);
  const active = useRef<AbortController | null>(null);
  const directory = useRef<FileSystemDirectoryHandle | null>(null);

  /** 关闭下载页或离开课程时终止仍未完成的下载和写入。 */
  useEffect(function stopOnUnmount() {
    return function abortDownload() { active.current?.abort(); };
  }, []);

  /** 本批全程只使用一个目录；目录未授权、选择取消或账号校验失败时不发起文件请求。 */
  async function start(batch: CoursewareBatch, previous?: CoursewareReport): Promise<void> {
    if (!batch.files.length || active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setNotice(null); setNeedsReload(false); setStage('picking');
    try {
      let root = previous ? directory.current : null;
      if (!root) {
        const pickerWindow = window as PickerWindow;
        try {
          if (!pickerWindow.showDirectoryPicker) throw new DOMException('Directory picker unavailable', 'SecurityError');
          root = await pickerWindow.showDirectoryPicker({ mode: 'readwrite' });
        } catch (error) {
          if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) return;
          if (error instanceof DOMException && error.name === 'SecurityError') {
            if (!canHandOff) { setNotice({ message: '当前浏览器无法打开本地目录，请检查浏览器或系统的文件访问限制。', error: true }); return; }
            await handOffBatch(batch);
            if (!controller.signal.aborted) {
              removeSelections?.(batch.files);
              setReport(null);
              setNotice({ message: '已在扩展标签页打开这批课件，请在那里选择目录。' });
            }
            return;
          }
          setNotice({ message: '无法选择本地目录，请检查文件夹权限后重试。', error: true });
          return;
        }
      }
      if (controller.signal.aborted) return;
      directory.current = root;
      const results: CoursewareResult[] = previous?.results.filter(/** 重试时保留已经保存的文件，不再次请求。 */ function saved(result) { return result.path !== undefined; }) ?? [];
      const wholeBatch = previous?.batch ?? batch;
      setReport({ batch: wholeBatch, results: [...results] }); setStage('saving');

      let sessionError = '';
      try { await validateCoursewareDownload(batch.course); }
      catch (error) {
        sessionError = friendlyError(error);
        if (!controller.signal.aborted) {
          setNotice({ message: sessionError, error: true });
          if (error instanceof AppError && error.code === 'extension_reload_required') setNeedsReload(true);
        }
      }
      for (const selection of batch.files) {
        if (controller.signal.aborted) return;
        if (sessionError) results.push({ selection, error: sessionError });
        else {
          try {
            const path = await saveCoursewareFile(root, batch.course.code, selection, controller.signal);
            if (controller.signal.aborted) return;
            results.push({ selection, path });
            removeSelections?.([selection]);
          } catch (error) {
            if (controller.signal.aborted) return;
            const explanation = friendlyError(error);
            results.push({ selection, error: explanation });
            if (error instanceof AppError && error.code === 'login_required') {
              sessionError = explanation;
              setNotice({ message: explanation, error: true });
            }
          }
        }
        setReport({ batch: wholeBatch, results: [...results] });
      }
    } catch {
      if (!controller.signal.aborted) setNotice({ message: '无法在扩展标签页继续，请重新选择并重试。', error: true });
    } finally {
      active.current = null;
      if (!controller.signal.aborted) setStage('idle');
    }
  }

  /** 只将上一批未保存的文件交给下载流程，保留本批成功记录。 */
  function retry(): void {
    if (!report) return;
    const files = report.results.flatMap(/** 从逐项结果挑出仍需重试的文件。 */ function failed(result) { return result.error ? [result.selection] : []; });
    void start({ course: report.batch.course, files }, report);
  }

  return { stage, report, notice, needsReload, start, retry };
}
