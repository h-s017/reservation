import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const gas=readFileSync(new URL('../Code.gs',import.meta.url),'utf8');
const front=vm.runInNewContext(html.match(/const C=([\s\S]*?);\s*let S=/)[0].replace(/;\s*let S=$/,'; C.COURSES'));
const back=vm.runInNewContext(gas+'\nCOURSES');
for(const course of front){
  const server=back.find(c=>c.series===course.series&&c.course===course.course&&(c.variant||'')===(course.variant||''));
  assert.ok(server,`Missing backend course: ${course.course} ${course.variant||''}`);
  assert.equal(server.price,course.price,`Price mismatch: ${course.course} ${course.variant||''}`);
}
console.log(`Verified ${front.length} website course prices against the server catalogue.`);
