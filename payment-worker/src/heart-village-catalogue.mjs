// Stable IDs: keep previously booked 10mL/50mL slot IDs and all order history.
// Production D1 may still have the old catalogue until the data migration is applied.
// Enforce the current public options and server-side checkout prices regardless.
const active=new Map([
  ['course-01',{course:'香氣探索｜30 mL',price:1350,unit:'位'}],
  ['course-03',{course:'香氣探索｜50 mL',price:1800,unit:'位'}]
]);
const retired=new Set(['course-02','course-04']);
export function effectiveHeartVillageCourse(row){
  if(!row)return null;
  const key=row.course_id||row.id;
  if(retired.has(key))return null;
  const fields=active.get(key);
  return fields?{...row,...fields}:row;
}
