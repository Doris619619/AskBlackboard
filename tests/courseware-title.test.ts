/** 文件用途：验证课件侧栏课程标题能识别教学班后缀并保留原有课程名称。 */
import { expect, it } from 'vitest';
import { coursewareTitle } from '../src/ui/courseware-title';

it.each([
  ['ECE3060', 'ECE3060:Introduction to Robotics_L01', 'ECE3060: Introduction to Robotics'],
  ['ECE3080', 'ECE3080:Introduction to Embedded Systems_L01L02', 'ECE3080: Introduction to Embedded Systems'],
  ['ECE3810', 'ECE3810:Embedded Systems Laboratory_LAB1LAB2', 'ECE3810: Embedded Systems Laboratory'],
  ['GEB2509', 'GEB2509:AI-Powered Creativity (Dr. LIN Yongqian_2627T1)', 'GEB2509: AI-Powered Creativity (Dr. LIN Yongqian_2627T1)'],
  ['ECE3060', 'ece-3060： Robotics and L01 Sensors', 'ECE3060: Robotics and L01 Sensors'],
  ['ECE3060', 'Introduction to Robotics', 'ECE3060: Introduction to Robotics'],
  ['ECE3060', 'ECE3060_L01', 'ECE3060'],
])('formats %s and %s as a single course title', /** 按实际课程名和边界用例核对显示标题。 */ (code, title, expected) => {
  expect(coursewareTitle({ code, title })).toBe(expected);
});
