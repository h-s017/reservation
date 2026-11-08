import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {fixture} from './db.mjs';
import {createOrder,startCheckout,notifyOrder,adminAction,ownedOrder} from '../src/orders.mjs';
test('withdraw pending refund preserves the paid transaction and cancelled reservation; completed refunds stay final',async()=>{
 const db=fixture(),hash='a'.repeat(64),o=await createOrder(db,hash,{slotIds:['s'],name:'測試',phone:'0912345678',email:'test@example.com'});
 const a=await startCheckout(db,hash,o.id);await notifyOrder(db,{merchantOrderNo:a.attempt.id,amount:6500,status:'PAID',tradeNo:'withdrawal-fixture'});
 await adminAction(db,'/api/admin/cancel-reservation',{id:o.id,confirmed:true,reason:'原取消原因'});
 const before=await ownedOrder(db,hash,o.id);
 assert.throws(()=>db.sqlite.prepare("UPDATE orders SET cancellation_status='NONE' WHERE id=?").run(o.id),/REFUND_STATE_CONFLICT/);
 db.sqlite.prepare("UPDATE orders SET cancellation_status='NONE',cancellation_reason=cancellation_reason||'；使用者撤回待退款標記' WHERE id=?").run(o.id);
 const after=await ownedOrder(db,hash,o.id);
 for(const k of ['status','amount','trade_no','paid_at','booking_cancelled_at','refund_requested_at','refunded_at'])assert.equal(after[k],before[k]);
 assert.deepEqual(after.attempt,before.attempt);assert.equal(after.cancellation_status,'NONE');assert.equal(db.sqlite.prepare("SELECT booked FROM slots WHERE id='s'").get().booked,0);
 assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM admin_audit WHERE action='CANCELLATION_NONE' AND target=?").get(o.id).n,1);
 await adminAction(db,'/api/admin/refund-request',{id:o.id,reason:'重新申請測試'});
 await adminAction(db,'/api/admin/refund-confirm',{id:o.id,amount:6500,confirmed:true,reference:'real-refund-fixture'});
 assert.throws(()=>db.sqlite.prepare("UPDATE orders SET cancellation_status='NONE',cancellation_reason='不允許撤回已完成退款' WHERE id=?").run(o.id),/REFUND_STATE_CONFLICT/);
});
test('cancelled paid booking with no refund request does not display pending refund',()=>{
 const nodes={};const document={getElementById:id=>nodes[id]??={style:{},classList:{add(){}}}};
 const ctx=vm.createContext({document,$:id=>document.getElementById(id),clearTimeout(){},show(){},esc:s=>String(s||''),money:n=>'NT$ '+n});
 vm.runInContext(readFileSync(new URL('../../payment.js',import.meta.url),'utf8'),ctx);
 vm.runInContext("renderPaymentResult({id:'fixture',status:'CANCELLED',payment_status:'PAID',booking_cancelled_at:123,cancellation_status:'NONE',course:'課程',slots:[],amount:800})",ctx);
 assert.equal(nodes.doneTitle.textContent,'預約已取消');assert.ok(!nodes.doneBody.innerHTML.includes('退款尚待確認'));assert.equal(nodes.retryPayment.hidden,true);
});
