import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyCalendarEvent} from '../src/calendar-rules.mjs';

const calendarId='owner@example.test';
const evt=status=>({
 id:'invitation',summary:'合作會議',status:'confirmed',transparency:'opaque',
 start:{dateTime:'2099-12-01T10:00:00+08:00'},end:{dateTime:'2099-12-01T11:00:00+08:00'},
 attendees:[{email:calendarId,responseStatus:status}]
});
test('an invited owner who has not accepted is a review, never an automatic block',()=>{
 assert.equal(classifyCalendarEvent(evt('needsAction'),{calendarId}).status,'REVIEW');
 assert.equal(classifyCalendarEvent(evt('tentative'),{calendarId}).status,'REVIEW');
});
test('owner decline ignores meeting while acceptance blocks it',()=>{
 assert.equal(classifyCalendarEvent(evt('declined'),{calendarId}).status,'IGNORE');
 assert.equal(classifyCalendarEvent(evt('accepted'),{calendarId}).status,'BLOCK');
});
test('calendar owner RSVP takes precedence over an unrelated self attendee',()=>{
 const mixed=evt('needsAction');
 mixed.attendees.unshift({email:'worker@example.test',self:true,responseStatus:'accepted'});
 assert.equal(classifyCalendarEvent(mixed,{calendarId}).status,'REVIEW');
});
