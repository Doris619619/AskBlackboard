/** 文件用途：将明确的截止日期和钟点整理为简短展示，不补年份、时区或换算相对日期。 */
const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const monthWord = '(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';

/** 仅格式化无歧义单日期和单钟点；多日期/条件/否定回退原话，避免抹掉约束。 */
export function conciseDeadline(quote: string): string {
  const text = quote.split(/[（(]/)[0];
  if (/\bnot\b|cancel|postpon|extend|改期|延期|取消|不再|不是|暂未|尚未|before|after|之前|之后|earlier|later|\bfrom\b|\bbetween\b|\buntil\b/i.test(text)) return '时间条件见原话';
  const dates: { year?: string; month: number; day: number }[] = [];
  for (const m of text.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${monthWord}(?:[ ,]+(20\\d{2}))?\\b`, 'gi'))) dates.push({ day: Number(m[1]), month: months.indexOf(m[2].slice(0,3).toLowerCase()) + 1, year: m[3] });
  for (const m of text.matchAll(new RegExp(`\\b${monthWord}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(20\\d{2}))?\\b`, 'gi'))) dates.push({ month: months.indexOf(m[1].slice(0,3).toLowerCase()) + 1, day: Number(m[2]), year: m[3] });
  for (const m of text.matchAll(/(?:(20\d{2})年)?(\d{1,2})月(\d{1,2})[日号]?/g)) dates.push({ year: m[1], month: Number(m[2]), day: Number(m[3]) });
  for (const m of text.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b/g)) dates.push({ year: m[1], month: Number(m[2]), day: Number(m[3]) });
  if (dates.length !== 1 || dates[0].month < 1 || dates[0].month > 12 || dates[0].day < 1 || dates[0].day > new Date(Date.UTC(Number(dates[0].year || '2000'), dates[0].month, 0)).getUTCDate()) return '具体时间见原话';
  const times = [...text.matchAll(/\b(\d{1,2}):(\d{2})\s*(AM|PM)?\b/gi)];
  if (times.length > 1 || /\d\s*[–—-]\s*\d/.test(text.replace(/20\d{2}-\d{2}-\d{2}/g, ''))) return '多个时间，见原话';
  const date = dates[0]; let clock = '（未注明具体时刻）';
  if (times.length) {
    let hour = Number(times[0][1]); const minute = Number(times[0][2]); const period = times[0][3]?.toUpperCase();
    if (minute > 59 || hour > (period ? 12 : 23) || (period && hour < 1)) return '具体时间见原话';
    if (period) hour = hour % 12 + (period === 'PM' ? 12 : 0);
    clock = ` ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }
  const zone = text.match(/\b(?:CST|UTC|GMT|HKT)(?:[+-]\d{1,2}(?::\d{2})?)?\b|北京时间|香港时间/i)?.[0];
  return `${date.year ? `${date.year}年` : ''}${date.month}月${date.day}日${clock}${zone ? ` ${zone}` : ''}`;
}
