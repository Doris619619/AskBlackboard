/** 文件用途：在受信浏览器会话内缓存同一 Blackboard 文档已核对的课程与目录。 */
import type { CoursewareListing } from '../shared/courseware-types';
import { BROWSE_CACHE_KEY, type Course, type CourseBrowseSnapshot, type CourseDiscovery } from '../shared/types';
import type { BrowseAnchor } from './browse-session';

interface DirectorySnapshot { key: string; requestedAt: number; savedAt: number; listing: CoursewareListing }
interface ConfirmedFormat { courseId: string; url: string; extension: string }
interface BrowseCache {
  anchor: BrowseAnchor;
  scope: string;
  discovery: CourseDiscovery;
  requestedAt: number;
  savedAt: number;
  directories: DirectorySnapshot[];
  formats: ConfirmedFormat[];
}

const lifetime = 5 * 60 * 1000;
const maxDirectories = 32;
const maxFormats = 256;
let revision = 0;
let queue = Promise.resolve();

/** 让同时打开的侧栏依次读写缓存。存储不可用时允许实时读取继续工作。 */
function transact<T>(operation: () => Promise<T>): Promise<T | undefined> {
  const result = queue.then(operation).catch(/** 缓存失败作为未命中处理。 */ function miss() { return undefined; });
  queue = result.then(/** 本次读写完成后释放下一次操作。 */ function release() {});
  return result;
}

/** 只读取本扩展的版本化缓存项。 */
async function read(): Promise<BrowseCache | undefined> {
  return (await chrome.storage.session.get(BROWSE_CACHE_KEY))[BROWSE_CACHE_KEY] as BrowseCache | undefined;
}

/** 写入已校验的快照，不使用磁盘存储。 */
function write(cache: BrowseCache): Promise<void> { return chrome.storage.session.set({ [BROWSE_CACHE_KEY]: cache }); }

/** 页面随机标识与标签页共同识别原文档，账号显示名只做一致性检查。 */
export function sameBrowseAnchor(left?: BrowseAnchor, right?: BrowseAnchor): boolean {
  return Boolean(left && right && left.tabId === right.tabId && left.documentToken === right.documentToken && left.accountName === right.accountName);
}

/** 快照是展示资料。完整课程标识必须与同范围内最后确认的课程一致。 */
function hasCourse(cache: BrowseCache, course: Course): boolean {
  return cache.discovery.courses.some(/** 区分课程、学期及教学班。 */ function match(item) {
    return item.courseId === course.courseId && item.termId === course.termId && item.code === course.code && item.section === course.section;
  });
}

/** 将课程根或已校验的目录地址映射到独立快照。 */
function directoryKey(course: Course, folderUrl?: string): string { return JSON.stringify([course.courseId, course.termId, course.section, folderUrl ?? null]); }

/** 补上曾成功保存的格式提示，与来源目录中的格式信息分开。 */
function displayFormats(cache: BrowseCache, course: Course, listing: CoursewareListing): CoursewareListing {
  const formats = new Map(cache.formats.filter(/** 只取当前课程确认的格式。 */ function belongs(format) { return format.courseId === course.courseId; }).map(/** 按来源文件链接匹配。 */ function pair(format) { return [format.url, format.extension]; }));
  if (!formats.size) return listing;
  return { items: listing.items.map(/** 只补充文件的展示提示。 */ function addFormat(item) { return item.kind === 'file' ? { ...item, confirmedExtension: formats.get(item.url) } : item; }) };
}

/** 给实时读取标记起始登录版本，拒绝退出后迟到的响应。 */
export function browseRevision(): number { return revision; }

/** 观察到登录变化时清除全部快照，原标签页导航或关闭时仅清除其快照。 */
export function invalidateBrowseCache(tabId?: number): Promise<void | undefined> {
  if (tabId === undefined) revision += 1;
  return transact(async function clear() {
    if (tabId === undefined || (await read())?.anchor.tabId === tabId) await chrome.storage.session.remove(BROWSE_CACHE_KEY);
  });
}

/** 只在原文档仍匹配且快照足够新时交付课程列表。 */
export function readCachedCourses(anchor: BrowseAnchor, started: number): Promise<CourseBrowseSnapshot | undefined> {
  return transact(async function load() {
    const cache = await read();
    if (started !== revision || !cache || Date.now() - cache.savedAt >= lifetime || !sameBrowseAnchor(cache.anchor, anchor)) return;
    return { discovery: cache.discovery, cacheScope: cache.scope };
  });
}

/** 保存新发现的课程，保留仍属于同一原文档的目录与格式。 */
export function saveBrowseCourses(anchor: BrowseAnchor, discovery: CourseDiscovery, started: number, requestedAt: number): Promise<CourseBrowseSnapshot | undefined> {
  return transact(async function save() {
    const previous = await read();
    if (started !== revision) return;
    const current = sameBrowseAnchor(previous?.anchor, anchor) ? previous : undefined;
    if (current && current.requestedAt > requestedAt) return { discovery: current.discovery, cacheScope: current.scope };
    const scope = current?.scope ?? crypto.randomUUID();
    await write({ anchor, scope, discovery, requestedAt, savedAt: Date.now(), directories: current?.directories ?? [], formats: current?.formats ?? [] });
    return started === revision ? { discovery, cacheScope: scope } : undefined;
  });
}

/** 返回同一原文档、课程和目录下仍在有效期的文件列表。 */
export function readCachedDirectory(anchor: BrowseAnchor, scope: string, course: Course, folderUrl: string | undefined, started: number): Promise<CoursewareListing | undefined> {
  return transact(async function load() {
    const cache = await read();
    if (started !== revision || !cache || cache.scope !== scope || !sameBrowseAnchor(cache.anchor, anchor) || !hasCourse(cache, course)) return;
    const key = directoryKey(course, folderUrl);
    const entry = cache.directories.find(/** 精确匹配当前目录。 */ function match(item) { return item.key === key; });
    if (entry && Date.now() - entry.savedAt < lifetime) return displayFormats(cache, course, entry.listing);
  });
}

/** 保存实时核对成功的列表。已经切换账号的晚到请求无法写回。 */
export function saveBrowseDirectory(scope: string, course: Course, folderUrl: string | undefined, listing: CoursewareListing, started: number, requestedAt: number): Promise<CoursewareListing | undefined> {
  return transact(async function save() {
    const cache = await read();
    if (started !== revision || !cache || cache.scope !== scope || !hasCourse(cache, course)) return;
    const key = directoryKey(course, folderUrl);
    const existing = cache.directories.find(/** 防止较早发出的响应覆盖同目录较新的结果。 */ function match(item) { return item.key === key; });
    if (existing && existing.requestedAt > requestedAt) return displayFormats(cache, course, existing.listing);
    const now = Date.now();
    const directories = cache.directories.filter(/** 释放过期和被本轮替代的快照。 */ function keep(item) { return item.key !== key && now - item.savedAt < lifetime; });
    await write({ ...cache, directories: [...directories, { key, requestedAt, savedAt: now, listing }].slice(-maxDirectories) });
    return started === revision ? displayFormats(cache, course, listing) : undefined;
  });
}

/** 记录已成功保存的文件格式。仅保留在触发保存时所用的浏览范围内。 */
export function saveBrowseFormat(scope: string, course: Course, url: string, extension: string): Promise<void | undefined> {
  return transact(async function save() {
    const cache = await read();
    if (!cache || cache.scope !== scope || !hasCourse(cache, course)) return;
    const formats = cache.formats.filter(/** 以最近一次保存的格式替换同一文件。 */ function keep(format) { return format.courseId !== course.courseId || format.url !== url; });
    await write({ ...cache, formats: [...formats, { courseId: course.courseId, url, extension }].slice(-maxFormats) });
  });
}

/** 已选课件保存前仍需实时校验，原浏览范围必须与实时核对的账号相符。 */
export async function matchesBrowseAccount(scope: string, discovery: CourseDiscovery, started: number): Promise<boolean> {
  return Boolean(await transact(async function verify() {
    const cache = await read();
    return started === revision && cache?.scope === scope && cache.anchor.accountName === discovery.accountName;
  }));
}
