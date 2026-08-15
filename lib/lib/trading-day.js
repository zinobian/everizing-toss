/**
 * 미국 거래일 판별 유틸
 */

function isWeekend(date) {
  const d = date instanceof Date ? date : new Date(date);
  const day = d.getUTCDay();
  return day === 0 || day === 6;
}

function isUsTradingDay(date = new Date()) {
  return !isWeekend(date);
}

function countUsTradingDays(from, to) {
  const start = new Date(from);
  const end = new Date(to);
  start.setUTCHours(0, 0, 0, 0);
  end.setUTCHours(0, 0, 0, 0);

  let count = 0;
  const cur = new Date(start);
  while (cur <= end) {
    if (isUsTradingDay(cur)) count++;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return count;
}

function addUsTradingDays(from, n) {
  const d = new Date(from);
  let added = 0;
  while (added < n) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (isUsTradingDay(d)) added++;
  }
  return d;
}

module.exports = {
  isUsTradingDay,
  isWeekend,
  countUsTradingDays,
  addUsTradingDays,
};
