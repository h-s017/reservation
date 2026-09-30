import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
export function database(seed=false){
  const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');
  for(const name of ['0001_courses.sql',...(seed?['0002_catalogue.sql']:[]),'0003_payment_transitions.sql','0004_atm.sql'])sqlite.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
  const db={sqlite,prepare(text){let args=[];return{bind(...a){args=a;return this;},async first(){return sqlite.prepare(text).get(...args)||null;},async all(){return{results:sqlite.prepare(text).all(...args)};},async run(){const r=sqlite.prepare(text).run(...args);return{meta:{changes:Number(r.changes)}};},execute(){const s=sqlite.prepare(text);if(/^\s*SELECT/i.test(text))return{results:s.all(...args)};return{meta:{changes:Number(s.run(...args).changes)}};}};},async batch(statements){sqlite.exec('BEGIN IMMEDIATE');try{const result=statements.map(s=>s.execute());sqlite.exec('COMMIT');return result;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};return db;
}
export function fixture(capacity=2){
  const db=database();
  db.sqlite.exec(`INSERT INTO courses VALUES('c','系列','課程','',6500,${capacity},'位','single',1,1,0,1);
    INSERT INTO courses VALUES('combo','系列','組合','',10500,6,'位','multiple',2,2,0,1);
    INSERT INTO courses VALUES('contest','比賽','比賽','',0,10,'位','single',1,1,1,1);`);
  for(const [id,c] of [['s','c'],['a','combo'],['b','combo'],['contest','contest']])db.sqlite.prepare('INSERT INTO slots(id,course_id,date,time,starts_at,capacity) VALUES(?,?,?,?,?,?)').run(id,c,'2099-12-01','09:00–11:00',4100000000,capacity);
  return db;
}
