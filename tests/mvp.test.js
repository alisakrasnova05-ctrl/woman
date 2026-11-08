const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');

test('MVP API: cover, four days, route, typed transfers, events, server tickets and restart persistence',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'glider-mvp-'));
 for(const folder of ['server','data','public'])fs.mkdirSync(path.join(root,folder));
 for(const file of ['index.js','plan-parser.js'])fs.copyFileSync(path.join(__dirname,'../server',file),path.join(root,'server',file));
 fs.copyFileSync(path.join(__dirname,'../public/plan-schedule.js'),path.join(root,'public/plan-schedule.js'));
 fs.writeFileSync(path.join(root,'data/db.json'),JSON.stringify({trips:[],points:[],events:[],transfers:[]}));
 let child,base;
 async function start(){
  const script=`const http=require('http'),listen=http.Server.prototype.listen;http.Server.prototype.listen=function(){return listen.call(this,0,'127.0.0.1',()=>console.log('PORT:'+this.address().port))};require(${JSON.stringify(path.join(root,'server/index.js'))});`;
  child=spawn(process.execPath,['-e',script],{env:{...process.env,LLM_API_KEY:'',LLM_BASE_URL:''},stdio:['ignore','pipe','pipe']});
  base=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('startup timeout')),5000);child.on('error',reject);child.stdout.on('data',d=>{const m=String(d).match(/PORT:(\d+)/);if(m){clearTimeout(timer);resolve('http://127.0.0.1:'+m[1]);}});});
 }
 t.after(()=>{child?.kill();fs.rmSync(root,{recursive:true,force:true});});
 await start();
 const request=async(url,body,method='POST',expected=200)=>{const res=await fetch(base+url,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});assert.equal(res.status,expected,await res.clone().text());return res.status===204?null:res.json();};
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
 async function upload(bytes,type,name,field='photos',status=201){const form=new FormData();form.append(field,new Blob([bytes],{type}),name);const res=await fetch(base+'/api/uploads',{method:'POST',body:form});assert.equal(res.status,status);return res.json();}
 const [cover]=await upload(png,'image/png','cover.png');
 const trip=await request('/api/trips',{title:'СПб → Казань',origin:'Санкт-Петербург',originCity:{id:'local-saint-petersburg'},destination:'Казань',city:{id:'local-kazan'},month:7,year:2026,coverUrl:cover.url},'POST',201);
 await request('/api/trips/'+trip.id,{startDate:'2026-07-12',endDate:'2026-07-15'},'PATCH');
 const renamed=await request('/api/trips/'+trip.id,{title:'Четыре дня в Казани',coverUrl:cover.url},'PATCH');assert.equal(renamed.startDate,'2026-07-12');assert.equal(renamed.originCity.name,'Санкт-Петербург');assert.equal(renamed.title,'Четыре дня в Казани');
 const scope='?tripId='+trip.id;
 const points=[];
 for(const point of [{name:'Санкт-Петербург',lat:59.93,lng:30.31},{name:'Казань аэропорт',lat:55.60,lng:49.28},{name:'Отель',lat:55.79,lng:49.12},{name:'Казанский Кремль',lat:55.80,lng:49.10}])points.push(await request('/api/points'+scope,point,'POST',201));
 for(const [index,mode] of ['plane','car'].entries())await request('/api/transfers'+scope,{fromPointId:points[index].id,toPointId:points[index+1].id,mode,date:'2026-07-12',endDate:'2026-07-12',startTime:index?'12:00':'09:00',endTime:index?'13:00':'11:00'},'POST',201);
 const [photo]=await upload(png,'image/png','excursion.png');
 const [ticket]=await upload(Buffer.from('%PDF-1.4\n%%EOF'),'application/pdf','ticket.pdf','attachments');
 await upload(Buffer.from('<script>alert(1)</script>'),'application/pdf','fake.pdf','attachments',400);
 await upload(Buffer.from('%PDF-1.4'),'application/pdf','cover.pdf','photos',400);
 const excursion={title:'Экскурсия',date:'2026-07-13',endDate:'2026-07-13',startTime:'14:00',type:'excursion',pointId:points[3].id,materials:[photo.url],ticket};
 const created=await request('/api/events'+scope,excursion,'POST',201);
 for(const [index,type] of ['stay','walking','restaurant'].entries())await request('/api/events'+scope,{title:type,type,date:'2026-07-12',startTime:['13:00','15:00','19:00'][index],pointId:points[2].id},'POST',201);
 await request('/api/events/'+created.id+scope,{...excursion,startTime:'08:00'},'PUT');
 const calendarEvent={dayNoteId:'calendar',title:'Билет из календаря',type:'walking',date:'2026-07-14',startTime:'09:00',ticket};
 await request('/api/trips/'+trip.id+'/day-events',{events:[calendarEvent]},'PUT');
 const bad=await fetch(base+'/api/trips/'+trip.id+'/day-events',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({events:[{...calendarEvent,ticket:{url:'/uploads/missing.pdf'}}]})});assert.equal(bad.status,400);
 const [dbTrip]=await request('/api/trips',null,'GET');assert.equal(dbTrip.endDate,'2026-07-15');assert.equal(dbTrip.coverUrl,cover.url);
 assert.equal((await request('/api/events'+scope+'&date=2026-07-13',null,'GET')).length,1);
 assert.equal((await request('/api/points?tripId=another',null,'GET')).length,0);
 assert.deepEqual((await request('/api/transfers'+scope,null,'GET')).map(t=>t.mode),['plane','car']);
 await new Promise(resolve=>{child.once('exit',resolve);child.kill();});await start();
 const events=await request('/api/events'+scope,null,'GET');assert.equal(events.length,5);assert.equal(events.find(e=>e.id===created.id).startTime,'08:00');assert.equal(events.find(e=>e.dayNoteId==='calendar').ticket.url,ticket.url);
 for(const [file,type] of [[cover,'image/png'],[photo,'image/png'],[ticket,'application/pdf']]){const res=await fetch(base+file.url);assert.equal(res.status,200);assert.equal(res.headers.get('content-type'),type);assert.ok((await res.arrayBuffer()).byteLength>0);}
 assert.equal((await request('/api/points'+scope,null,'GET')).length,4);
 await request('/api/trips/'+trip.id,null,'DELETE');assert.equal((await request('/api/events'+scope,null,'GET')).length,0);
});
