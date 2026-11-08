const {test}=require('node:test');const assert=require('node:assert/strict');
const S=require('../public/plan-schedule');const {overlay}=require('../public/map-drafts');
const start='2026-07-10',end='2026-07-13';
test('hints recognize weekday, ordinal, explicit dates, time and year boundaries',()=>{
 assert.equal(S.hints('В субботу музей',start,end).date,'2026-07-11');
 assert.equal(S.hints('На второй день в 15:00 Кремль',start,end).date,'2026-07-11');
 assert.equal(S.hints('На второй день в 15:00 Кремль',start,end).time,'15:00');
 assert.equal(S.hints('12 июля в 5 вечера ужин',start,end).time,'17:00');
 assert.equal(S.hints('2 января музей','2026-12-30','2027-01-03').date,'2027-01-02');
 assert.throws(()=>S.hints('В среду музей',start,end),/не входит/);
 assert.equal(S.days('2026-03-28','2026-03-31').length,4);
});
test('free plans fill chronological morning/day/evening slots and skip occupied intervals',()=>{
 const occupied=[{date:start,startTime:'08:30',endTime:'10:30'}];
 const plans=S.allocate(Array.from({length:4},(_,i)=>({title:'План '+i})),start,end,occupied);
 assert.deepEqual(plans.map(p=>[p.date,p.startTime]),[[start,'14:00'],[start,'19:00'],['2026-07-11','09:00'],['2026-07-11','14:00']]);
 assert.equal(new Set(plans.map(p=>p.date+p.startTime)).size,4);
});
test('fixed time uses next available day; fixed date uses free slot; conflict is non-destructive',()=>{
 const busy=[{date:start,startTime:'14:00',endTime:'16:00'}];
 assert.equal(S.allocate([{title:'Музей',startTime:'15:00',timeExplicit:true}],start,end,busy)[0].date,'2026-07-11');
 assert.equal(S.allocate([{title:'Музей',date:start,dateExplicit:true}],start,end,busy)[0].startTime,'09:00');
 assert.throws(()=>S.allocate([{title:'Музей',date:start,dateExplicit:true,startTime:'15:00',timeExplicit:true}],start,end,busy),/время занято/);
 assert.throws(()=>S.allocate([{title:'Музей',date:'2026-08-01',dateExplicit:true}],start,end),/вне поездки/);
});
test('single-day exhaustion and multi-day occupancy are respected',()=>{
 assert.throws(()=>S.allocate(Array.from({length:4},()=>({title:'План'})),start,start),/слотов нет/);
 const busy=[{date:start,startTime:'08:00',endDate:'2026-07-11',endTime:'15:00'}];
 const [result]=S.allocate([{title:'Прогулка'}],start,end,busy);assert.equal(result.date,'2026-07-11');assert.equal(result.startTime,'19:00');
});
test('moving keeps duration and material fields',()=>{
 const moved=S.place({title:'Музей',date:start,startTime:'10:00',endTime:'12:30',materials:['photo']},start,end,[],{date:'2026-07-11',time:'14:00'});
 assert.equal(moved.endTime,'16:30');assert.deepEqual(moved.materials,['photo']);
});
test('map overlays only dirty managed drafts and preserves unrelated events',()=>{
 const saved=[{id:'managed',source:'day-notes',date:start,title:'old'},{id:'outside',date:start,title:'Встреча'}];
 const notes={'2026-07-11':[{dayNoteId:'n',title:'Кремль',startTime:'14:00',place:{name:'Кремль',lat:55.799,lng:49.106}}]};
 const preview=overlay([],saved,notes,{},'trip');assert.equal(preview.active,true);assert.equal(preview.events.length,2);assert.equal(preview.points.length,1);assert.ok(preview.events.find(e=>e._draft&&e.date==='2026-07-11'));
 assert.equal(overlay([],saved,notes,notes,'trip').active,false);assert.equal(overlay([],saved,{},null,'trip').active,false);
 const imported={'2026-07-12':[{originalEventId:'outside',id:'outside',dayNoteId:'o',title:'Встреча',startTime:'15:00'}]};
 const next=overlay([],saved,imported,{},'trip');assert.equal(next.events.filter(e=>e.id==='outside').length,1);
});
