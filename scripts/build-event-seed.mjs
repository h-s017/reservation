import {attendance} from '../hana-event/availability.mjs';
import {eventSlug,eventStart,eventEnd,tickets,candidates} from '../hana-event/catalogue.mjs';

const quote = value => typeof value==='number' ? String(value) : "'"+value.replaceAll("'","''")+"'";
const insert = (table,columns,values) => console.log('INSERT OR IGNORE INTO '+table+'('+columns+') VALUES('+values.map(quote).join(',')+');');
const put = (table,columns,...values) => insert(table,columns,values);
console.log('-- All imported slots are interest-only with zero sellable capacity.');
put('event_catalogue','slug,title,english_title,poster_url,starts_on,ends_on,published',
  eventSlug,'心村裡的時空旅行','A Journey Through Time at Heart Village','/poster.jpg',eventStart,eventEnd,0);
for (const [code,name,description,logo] of [
  ['hineni','此域 Hineni／Hana Scent Artist','活動企劃、預約協調及氣味藝術調香。','/hineni.jpg'],
  ['qipao','鍾兒旗袍','服裝及配件、換裝與簡易妝髮。',''],
  ['photo','羊駝創藝基地','拍攝、照片調色、交付與精修。','/alpalette.jpg']
]) put('event_partners','event_slug,code,name,description,logo_url',eventSlug,code,name,description,logo);
for (const t of tickets) put('event_tickets','event_slug,id,plan,type,price',eventSlug,t.id,t.plan,t.type,t.price);
for (const s of candidates(attendance)) {
  const start = Date.parse(s.date+'T'+s.time+':00+08:00')/1000;
  const end = start+(['10:00','14:00'].includes(s.time)?180:120)*60;
  put('event_slots','event_slug,id,date,time,starts_at,ends_at,team_mask,possible,available',
    eventSlug,s.id,s.date,s.time,start,end,s.teamMask,JSON.stringify(s.possible),JSON.stringify(s.available));
}
