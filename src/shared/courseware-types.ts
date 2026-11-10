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
}

export interface CoursewareListing {
  items: (CoursewareFolder | CoursewareFile)[];
}

export interface CoursewareSelection {
  file: CoursewareFile;
  folders: CoursewareFolder[];
}
