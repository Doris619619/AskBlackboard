/** 文件用途：定义采集、侧栏和模型问答之间共享的无凭据数据契约。 */
export interface Course {
  courseId: string;
  code: string;
  title: string;
  termId: string;
  termLabel: string;
  section: string;
  announcementUrl: string;
}

export interface CourseDiscovery {
  courses: Course[];
  currentTermId: string;
  accountName: string;
}

/** 侧栏可复用的课程列表和扩展生成的浏览范围。 */
export interface CourseBrowseSnapshot {
  discovery: CourseDiscovery;
  cacheScope?: string;
}

export const BROWSE_CACHE_KEY = 'askblackboard:browse-cache:v1';

export interface SourceEvidence {
  kind?: 'announcement' | 'assignment';
  sourceId: string;
  courseId: string;
  title: string;
  publishedAt: string;
  body: string;
  url: string;
  anchorId: string;
  breadcrumb: string[];
  fetchedAt: string;
}

export interface AnnouncementSnapshot {
  scope?: 'announcements' | 'assignments' | 'deadlines';
  course: Course;
  sources: SourceEvidence[];
  fetchedAt: string;
  coverage: { status: 'complete' | 'partial'; pagesRead: number; warnings: string[] };
}

export interface Citation { sourceId: string; quote: string }
export interface ModelAnswer {
  deadlines?: { sourceId: string; title: string; time: string; quote: string; section?: string; tentative?: boolean }[];
  notices?: string[];
  mode?: 'ai' | 'extracted';
  status: 'found' | 'not_found' | 'conflict';
  answer: string;
  citations: Citation[];
}

export interface Settings { apiKey: string; model: string; theme: 'system' | 'light' | 'dark' }

export type ExtensionMessage =
  | { type: 'discover_courses' }
  | { type: 'read_cached_courses' }
  | { type: 'collect_announcements'; course: Course }
  | { type: 'collect_assignments'; course: Course }
  | { type: 'collect_courseware'; course: Course; folderUrl?: string; cacheScope?: string }
  | { type: 'read_cached_courseware'; course: Course; folderUrl?: string; cacheScope: string }
  | { type: 'remember_courseware_format'; course: Course; fileUrl: string; extension: string; cacheScope: string }
  | { type: 'validate_courseware_download'; course: Course; cacheScope?: string }
  | { type: 'read_assignments'; course: Course }
  | { type: 'open_source'; source: SourceEvidence; quote?: string }
  | { type: 'ping' }
  | { type: 'read_discovery' }
  | { type: 'read_announcements'; course: Course }
  | { type: 'highlight_source'; sourceId: string; quote?: string };

export type RuntimeResult<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string; diagnostic?: string } };
