const {test}=require('node:test');
const assert=require('node:assert/strict');
const {extract,heuristic,parsePlans}=require('../server/plan-parser');
const context={date:'2026-07-01',city:{name:'Казань'}};
const env={LLM_API_KEY:'test-secret',LLM_BASE_URL:'https://proxy.example/',LLM_MODEL:'test-model'};
test('fallback extracts Russian dates, relative time and the place without action verbs',()=>{
 const [a,b]=heuristic('12 июля сходить в Кремль после обеда; В 10:30 посетить музей','2026-07-01');
 assert.equal(a.placeName,'Кремль');assert.equal(a.date,'2026-07-12');assert.equal(a.startTime,'14:00');assert.equal(a.type,'excursion');
 assert.equal(b.placeName,'музей');assert.equal(b.startTime,'10:30');
});
test('LLM uses server Bearer auth; model coordinates are discarded',async()=>{
 const result=await extract('музей',context,{env,fetchImpl:async(url,options)=>{
  assert.equal(String(url),'https://proxy.example/chat/completions');assert.equal(options.headers.Authorization,'Bearer test-secret');
  return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({items:[{title:'Музей',placeName:'Музей',date:'invalid',type:'excursion',startTime:'25:00',lat:1,lng:2}]})}}]})};
 }});
 assert.equal(result.source,'llm');assert.equal(result.items[0].date,context.date);assert.equal(result.items[0].startTime,'');assert.equal(result.items[0].lat,undefined);
});
test('LLM authentication errors, network errors and malformed output fall back without throwing',async()=>{
 for(const fetchImpl of [async()=>({ok:false,status:401}),async()=>{throw Error('offline')},async()=>({ok:true,json:async()=>({choices:[{message:{content:'not JSON'}}]})})]){
  const result=await extract('Сходить в Кремль после обеда',context,{env,fetchImpl});assert.equal(result.source,'heuristic');assert.equal(result.items[0].placeName,'Кремль');
 }
});
test('geocoder failures retain extracted plans without invented coordinates',async()=>{
 const result=await parsePlans('В 10:00 посетить музей недоступный',context,{env:{},fetchImpl:async()=>{throw Error('offline')}});
 assert.equal(result.items.length,1);assert.equal(result.items[0].place,null);assert.equal(result.items[0].title,'В 10:00 посетить музей недоступный');
});
test('places use geocoder coordinates, cache and an identifiable User-Agent',async()=>{
 let calls=0;
 const options={env:{},fetchImpl:async(url,request)=>{calls++;assert.match(url,/nominatim/);assert.match(request.headers['User-Agent'],/TravelersGlider/);return {ok:true,json:async()=>[{lat:'55.799',lon:'49.106',display_name:'Казанский кремль'}]};}};
 const a=await parsePlans('Кремль уникальный в 14:00',context,options);const b=await parsePlans('Кремль уникальный в 14:00',context,options);
 assert.equal(a.items[0].place.lat,55.799);assert.equal(b.items[0].place.lng,49.106);assert.equal(calls,1);
});
