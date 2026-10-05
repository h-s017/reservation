import {mkdirSync,copyFileSync,cpSync,readFileSync,writeFileSync} from 'node:fs';
const root=new URL('../',import.meta.url),out=new URL('../payment-worker/public/',import.meta.url);
mkdirSync(out,{recursive:true});
for(const file of ['index.html','payment.js','admin.html','admin.js','admin.css'])copyFileSync(new URL(file,root),new URL(file,out));
cpSync(new URL('assets/',root),new URL('assets/',out),{recursive:true});
console.log('Built public assets only.');

// Worker-hosted test frontend uses its own API; GitHub Pages uses the public API URL.
const index=new URL('index.html',out);
writeFileSync(index,readFileSync(index,'utf8').replace(/PAYMENT_API:'[^']*'/,"PAYMENT_API:''"));
