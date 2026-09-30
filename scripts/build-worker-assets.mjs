import {mkdirSync,copyFileSync,cpSync} from 'node:fs';
const root=new URL('../',import.meta.url),out=new URL('../payment-worker/public/',import.meta.url);
mkdirSync(out,{recursive:true});
for(const file of ['index.html','payment.js','admin.html','admin.js','admin.css'])copyFileSync(new URL(file,root),new URL(file,out));
cpSync(new URL('assets/',root),new URL('assets/',out),{recursive:true});
console.log('Built public assets only.');
