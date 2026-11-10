/** 文件用途：定义课件目录及用户勾选的无凭据数据。 */
export interface CoursewareFolder {
  kind: 'folder';
  id: string;
  name: string;
  url: string;
}

export interface CoursewareFile {
  kind: 'file';
  id: string;
  name: string;
  url: string;
  /** 学校页面为同一文件声明的只读点击入口，WebDAV 地址仍用作文件标识。 */
  entryUrl?: string;
  /** 页面已提供的可识别文件后缀，不含点，统一为小写。 */
  extension?: string;
  /** 本次学校会话中成功保存过的实际后缀，仅用于列表展示。 */
  confirmedExtension?: string;
}

export interface CoursewareListing {
  items: (CoursewareFolder | CoursewareFile)[];
}

export interface CoursewareSelection {
  file: CoursewareFile;
  folders: CoursewareFolder[];
}
