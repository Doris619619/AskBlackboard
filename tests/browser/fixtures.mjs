/** 文件用途：为真实扩展浏览器回归提供虚构学校页面与模型响应，不包含校园资料或真实凭据。 */
export const portalUrl = 'https://bb.cuhk.edu.cn/webapps/portal/execute/tabs/tabAction?tab_tab_group_id=_1_1';
export const announcementUrl = 'https://bb.cuhk.edu.cn/webapps/blackboard/execute/announcement?method=search&context=mybb&searchSelect=_700_1';
export const gebAnnouncementUrl = announcementUrl.replace('_700_1', '_702_1');
export const portal = `<html><body><button id="global-nav-link">Example Student<span class="hideoff">Activity Updates</span><span class="badge">3</span></button>
<div id="My_Courses_Tools"><h3>2610UG</h3><div><ul class="courseListing"><li>
<a href="/webapps/blackboard/execute/launcher?type=Course&id=_700_1">GED2005 L01 Test Course</a>
<a href="${announcementUrl}">Announcements</a></li><li><a href="/webapps/blackboard/execute/launcher?type=Course&id=_702_1">GEB2509 L01 Creative Practice</a><a href="${gebAnnouncementUrl}">Announcements</a></li></ul></div><h3>No Term Assigned</h3><div><ul class="courseListing"><li><a href="/webapps/blackboard/execute/launcher?type=Course&id=_701_1">MAT1001 Unassigned Course</a></li></ul></div></div></body></html>`;
export const quote = 'Quiz 1 will take place on Monday, October 12. The duration is 20 minutes.';
export const announcements = `<html><body><select id="searchSelectId"><option selected value="_700_1">GED2005 L01</option></select>
<ul id="announcementList"><li id="_901_1"><h3 class="item">Test quiz schedule</h3>
<div class="details"><p>Posted on: Wednesday, October 7, 2026</p><div class="vtbegenerated"><p>${quote}</p></div></div></li></ul></body></html>`;
export const found = { status: 'found', answer: 'Quiz 1 在2026年10月12日，时长20分钟。公告没有注明具体开始时刻。', citations: [{ sourceId: '_901_1', quote }] };
export const gebQuote = 'The project presentation is on October 30, 2026.';
export const gebPreparation = 'Prepare a short introduction.';
export const gebAnnouncements = `<html><body><select id="searchSelectId"><option selected value="_702_1">GEB2509 L01</option></select><ul id="announcementList"><li id="_902_1"><h3 class="item">Project presentation</h3><div class="details"><p>Posted on: October 14, 2026</p><div class="vtbegenerated"><p>${gebQuote}</p><p>${gebPreparation}</p></div></div></li></ul></body></html>`;
export const gebFound = { status: 'found', answer: 'GEB2509 的项目展示在2026年10月30日。公告没有写具体开始时刻。', citations: [{ sourceId: '_902_1', quote: gebQuote }, { sourceId: '_902_1', quote: gebPreparation }] };

/** 包装确定性模型回复，只验证扩展传输、校验和展示链路，不代表真实模型质量。 */
export function completion(answer) { return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(answer) } }] }; }
