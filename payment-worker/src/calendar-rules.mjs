// Classifier for PRIMARY Google Calendar; deliberate exclusion of class/course
// reference events prevents an all-day teaching reminder closing public seats.
// Never infer "available" from tentative events: surface them for review.
export function classifyCalendarEvent(e,{calendarId=null}={}) {
  const title=typeof e?.summary==='string'?e.summary.trim():'';
  const allDay=Boolean(e?.start?.date);
  const attendees=Array.isArray(e?.attendees)?e.attendees:[];
  // For a shared personal Calendar, "self" may refer to the API client rather
  // than the owner; match the actual calendar owner address when available.
  const calendarEmail=typeof calendarId==='string'?calendarId.toLowerCase():'';
  const self=attendees.find(a=>a?.email?.toLowerCase()===calendarEmail)
    ||attendees.find(a=>a?.self===true);
  const decision=(status,reason)=>({status,reason});
  if(!e||e.status==='cancelled')return decision('IGNORE','CANCELLED');
  if(e.transparency==='transparent'||e.eventType==='workingLocation')return decision('IGNORE','MARKED_FREE');
  if(self?.responseStatus==='declined')return decision('IGNORE','DECLINED');
  // Explicit notes are optional; the normal workflow requires no tagging.
  if(/(?:\[HANA:OPEN\]|\[可預約\]|保留開放預約)/i.test(title))return decision('IGNORE','EXPLICIT_KEEP_OPEN');
  if(/(?:\[HANA:BLOCK\]|\[不可預約\]|停止預約|不接受預約)/i.test(title))return decision('BLOCK','EXPLICIT_BLOCK');
  if(e.status==='tentative'||self?.responseStatus==='tentative'||self?.responseStatus==='needsAction')return decision('REVIEW','UNCONFIRMED_INVITATION');
  // HANA class reminders may be all-day despite the public class being a timed
  // multi-student session. These are not proof that the class itself must close.
  if(/(?:氣味藝術序曲|調香師的和弦|KPIA|調香課程|香氛課程|正式授課|一日專業調香師)/i.test(title))return decision('REVIEW','COURSE_REFERENCE');
  if(allDay){
    if(/(?:安息日|Sabbath Rest|休假|休息日|不營業|出國|旅行|旅遊|請假)/i.test(title))return decision('BLOCK','ALL_DAY_UNAVAILABLE');
    return decision('REVIEW','ALL_DAY_UNCERTAIN');
  }
  return decision('BLOCK','CONFIRMED_BUSY');
}
export function categorizeCalendarEvents(items,options={}) {
  if(!Array.isArray(items))throw Error('CALENDAR_INVALID_RESPONSE');
  const blocked=[],review=[],ignored=[];
  for(const e of items){
    const result=classifyCalendarEvent(e,options);
    if(result.status==='BLOCK')blocked.push(e);
    else if(result.status==='REVIEW')review.push({event:e,reason:result.reason});
    else ignored.push({event:e,reason:result.reason});
  }
  return {blocked,review,ignored,counts:{blocked:blocked.length,review:review.length,ignored:ignored.length}};
}
