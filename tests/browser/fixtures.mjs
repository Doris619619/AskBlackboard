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

export const reportAnnouncementUrl = announcementUrl.replace('_700_1', '_703_1');
export const reportPortal = portal.replace('</ul></div><h3>No Term Assigned', `<li><a href="/webapps/blackboard/execute/launcher?type=Course&id=_703_1">ECE3810 LAB1LAB2 Example Laboratory</a><a href="${reportAnnouncementUrl}">Announcements</a></li></ul></div><h3>No Term Assigned`);
export const reportAnnouncements = `<html><body><select id="searchSelectId"><option selected value="_703_1">ECE3810</option></select><ul id="announcementList"><li id="_903_1"><h3 class="item">Lab 1 Submission: Report and Code</h3><div class="details"><div class="vtbegenerated"><p>Lab 1 report and code are open.</p><p>L01 — due 19:00, Tuesday, 17 November 2026</p><p>Lab 1 Report</p><p>Lab 1 Code</p><p>L02 — due 20:00, Thursday, 19 November 2026</p><p>Lab 1 Report</p><p>Lab 1 Code</p></div></div></li></ul></body></html>`;

/** 包装确定性模型回复，只验证扩展传输、校验和展示链路，不代表真实模型质量。 */
export function completion(answer) { return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(answer) } }] }; }

/** 构建虚构课程入口，课程列表链接是唯一可遍历的后续地址。 */
export function assignmentRoot(courseId) { return `<ul id="courseMenuPalette_contents"><li><a href="/webapps/blackboard/content/listContent.jsp?course_id=${courseId}&content_id=_900_1">Assignments</a></li></ul>`; }
/** 作业提交链接仅用于辨认类型，浏览器验收会断言该地址从未被访问。 */
export function assignmentListing(courseId) { return `<div id="breadcrumbs"><a href="/webapps/blackboard/execute/courseMain?course_id=${courseId}">Example</a></div><h1 id="pageTitleHeader">Assignments</h1><ul id="content_listContainer"><li id="contentListItem:_910_1"><img class="item_icon" alt="Assignment"><div class="item" id="_910_1"><h3><a href="/webapps/assignment/uploadAssignment?course_id=${courseId}&content_id=_910_1">Assignment1</a></h3></div><div class="vtbegenerated"><p>The deadline is 21:30, 22 Nov 2026.</p></div></li></ul>`; }

export const coursewareCourseId = '_704_1';
export const historicalCoursewareCourseId = '_705_1';
export const alternateCoursewareCourseId = '_706_1';
export const coursewareLanding = `/webapps/blackboard/execute/modulepage/view?course_id=${coursewareCourseId}&cmp_tab_id=_38993_1&mode=view`;
export const forbiddenCoursewareLanding = '/webapps/assessment/courseware-redirect-fixture';
export const unsupportedCoursewareLandingPath = '/webapps/blackboard/content/launchLink.jsp';
export const unsupportedCoursewareLanding = `${unsupportedCoursewareLandingPath}?course_id=${alternateCoursewareCourseId}&toc_id=_70600_1&mode=view&mode=reset`;
export const alternateCoursewareLanding = `/webapps/blackboard/execute/announcement?method=search&context=course_entry&course_id=${alternateCoursewareCourseId}&handle=announcements_entry&mode=view`;
export const historicalCoursewareAlternate = alternateCoursewareLanding.replace(alternateCoursewareCourseId, historicalCoursewareCourseId);
export const coursewarePortal = reportPortal.replace('</ul></div><h3>No Term Assigned', `<li><a href="/webapps/blackboard/execute/launcher?type=Course&amp;id=${coursewareCourseId}">ECE4016:Example Course_L01L02</a></li><li><a href="/webapps/blackboard/execute/launcher?type=Course&amp;id=${alternateCoursewareCourseId}">ECE3060:Introduction to Robotics_L01</a></li></ul></div><h3>2600UG</h3><div><ul class="courseListing"><li><a href="/webapps/blackboard/execute/launcher?type=Course&amp;id=${historicalCoursewareCourseId}">ECE4016:Older Course_L02</a></li></ul></div><h3>No Term Assigned`);
export const lectureFilePath = '/bbcswebdav/pid-961-dt-content-rid-971_1/xid-971_1';
export const tutorialFilePath = '/bbcswebdav/xid-972_1';
export const unselectedFilePath = '/bbcswebdav/xid-973_1';
export const assignmentAttachmentPath = '/bbcswebdav/xid-974_1';
export const lectureBytes = Buffer.from('%PDF-1.7\nSynthetic courseware PDF\n%%EOF');
export const tutorialBytes = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.from('Synthetic legacy PPT')]);

/** 为虚构课程提供教师菜单、多层目录、课件及不应暴露的作业附件。 */
export function coursewarePage(url) {
  if (`${url.pathname}${url.search}` === alternateCoursewareLanding) {
    return `<div id="breadcrumbs"><a href="/webapps/blackboard/execute/courseMain?course_id=${alternateCoursewareCourseId}">Robotics</a></div><ul id="courseMenuPalette_contents"><li><a href="/webapps/blackboard/content/listContent.jsp?course_id=${alternateCoursewareCourseId}&amp;content_id=_963_1">Content</a></li></ul>`;
  }
  if (url.searchParams.get('course_id') !== coursewareCourseId) return undefined;
  /** 拼接虚构课程内可跟随的内容列表链接。 */
  function folder(contentId) { return `/webapps/blackboard/content/listContent.jsp?course_id=${coursewareCourseId}&amp;content_id=${contentId}`; }
  if (`${url.pathname}${url.search}` === coursewareLanding) return `<ul id="courseMenuPalette_contents"><li><a href="${folder('_960_1')}">Content</a></li><li><a href="${folder('_962_1')}">Tutorial</a></li><li><a href="/webapps/assessment/example">Tests</a></li></ul>`;
  if (!url.pathname.endsWith('/listContent.jsp')) return undefined;
  const contentId = url.searchParams.get('content_id');
  const listing = {
    _960_1: `<li><h3><a href="${folder('_961_1')}">Lecture</a></h3></li>`,
    _961_1: `<li><h3><a href="${lectureFilePath}">Week 01.pdf</a></h3></li><li><h3><a href="${unselectedFilePath}">Unselected.pdf</a></h3><div class="vtbegenerated"><img src="${unselectedFilePath}" alt=""><iframe src="${unselectedFilePath}"></iframe></div></li><li><img class="item_icon" alt="Assignment"><h3><a href="/webapps/assignment/uploadAssignment">Assignment</a></h3><div class="attachments"><a href="${assignmentAttachmentPath}">Assignment.pdf</a></div></li>`,
    _962_1: `<li><h3><a href="${tutorialFilePath}">Tutorial 01.ppt</a></h3></li>`,
  }[contentId];
  if (listing === undefined) return undefined;
  return `<div id="breadcrumbs"><a href="/webapps/blackboard/execute/courseMain?course_id=${coursewareCourseId}">Example Course</a></div><ul id="content_listContainer">${listing}</ul>`;
}
