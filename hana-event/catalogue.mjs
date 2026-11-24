export const eventSlug = 'heart-village';
export const eventStart = '2026-12-15';
export const eventEnd = '2027-01-31';
export const plans = {
  A: {name:'完整體驗', includes:'旗袍／長袍＋調香＋攝影', times:['10:00','14:00'], teams:7},
  B: {name:'氣味體驗', includes:'旗袍／長袍＋調香', times:['10:00','13:00','16:00'], teams:3},
  C: {name:'影像體驗', includes:'旗袍／長袍＋攝影', times:['10:00','13:00','16:00'], teams:5}
};
export const types = ['女性','男性','兒童'];
export const tickets = Object.entries({A:[2700,2400,2000],B:[2000,1700,1300],C:[1700,1400,1000]})
  .flatMap(([plan, prices]) => prices.map((price,i) => ({id:plan+(i+1),plan,type:types[i],price})));
export const format = n => 'NT$'+new Intl.NumberFormat('zh-TW').format(n);
export function candidates(rows) {
  const byDate = Map.groupBy(rows, row => row.date);
  return [...byDate].flatMap(([date, blocks]) => {
    if (date<eventStart||date>eventEnd||[1,6].includes(new Date(date+'T12:00:00Z').getUTCDay())) return [];
    return ['10:00','13:00','14:00','16:00'].flatMap(time => {
      const windows = time === '13:00' ? [0,1] : time < '14:00' ? [0] : [1];
      const teamMask = windows.reduce((mask,i) => mask & (blocks.find(b=>b.block===i)?.teams ?? 0),7);
      if (!(teamMask & 1)) return [];
      const possible = Object.keys(plans).filter(p => plans[p].times.includes(time));
      return [{id:date+'-'+time, date, time, teamMask, possible,
        available:possible.filter(p => (teamMask & plans[p].teams) === plans[p].teams),
        capacity:0, mixes:[], status:'interest'}];
    });
  });
}
export function eligible(slot, selected) {
  const mix = [...new Set(selected)].sort().join('');
  if (!mix || ![...mix].every(p => slot.possible.includes(p))) return false;
  return slot.status === 'interest' ||
    (slot.status === 'open' && slot.mixes.includes(mix) && [...mix].every(p => slot.available.includes(p)));
}
