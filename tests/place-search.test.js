const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createPlaceSearcher,countryCode}=require('../server/place-search');
const city={name:'Казань',country:'Россия',latitude:55.7961,longitude:49.1064};
const ok=data=>({ok:true,status:200,json:async()=>data});
const row=(name,locality='Казань',lat=55.8,lon=49.11,country='ru')=>({place_id:name,name,lat:String(lat),lon:String(lon),display_name:`${name}, ${locality}, Россия`,type:'museum',address:{city:locality,country_code:country}});
function searcher(fetchImpl,env={}){return createPlaceSearcher({fetchImpl,env,minIntervalMs:0});}

test('paid 2GIS uses server key, Russian locale and city bounds; never returns credentials',async()=>{
 const key='test-private-places-key',urls=[];
 const search=searcher(async value=>{const url=new URL(value);urls.push(url);assert.equal(url.searchParams.get('key'),key);assert.equal(url.searchParams.get('locale'),'ru_RU');assert.equal(url.searchParams.get('radius'),'50000');return ok({meta:{code:200},result:{items:[{id:'1',name:'Казанский кремль',point:{lat:55.8,lon:49.11},address_name:'Кремль',adm_div:[{type:'country',name:'Россия'},{type:'city',name:'Казань'}],rubrics:[{name:'Музей'}]}]}});},{PLACES_API_KEY:key,PLACES_PROVIDER:'2gis'});
 const result=await search('Казанский кремль',city);assert.equal(result.status,'matched');assert.equal(result.place.source,'2gis');assert.equal(result.place.city,'Казань');assert.equal(result.place.type,'Музей');assert.ok(!JSON.stringify(result).includes(key));assert.equal(urls.length,1);
});
test('invalid paid keys fall back in order, cool down, and scope Nominatim to the country and viewbox',async()=>{
 const calls=[];
 const search=searcher(async value=>{const url=new URL(value);calls.push(url.hostname);
  if(url.hostname==='catalog.api.2gis.com')return ok({meta:{code:403,error:{message:'key invalid'}}});
  if(url.hostname.includes('yandex'))return {ok:false,status:403};
  assert.equal(url.searchParams.get('countrycodes'),'ru');assert.equal(url.searchParams.get('bounded'),'1');assert.equal(url.searchParams.get('addressdetails'),'1');assert.ok(url.searchParams.get('viewbox'));
  return ok([row(url.searchParams.get('q').split(',')[0])]);
 },{PLACES_API_KEY:'not-real',PLACES_PROVIDER:'auto'});
 const result=await search('Казанский кремль',city);assert.equal(result.place.source,'nominatim');assert.deepEqual(calls,['catalog.api.2gis.com','search-maps.yandex.ru','geocode-maps.yandex.ru','nominatim.openstreetmap.org']);
 await search('Музей Тукая',city);assert.equal(calls.filter(x=>x==='catalog.api.2gis.com').length,1);assert.equal(calls.filter(x=>x==='search-maps.yandex.ru').length,1);
});
test('ambiguous local results require selection; a generic one-result query is not confident',async()=>{
 const search=searcher(async url=>ok([row('Музей Тукая'),row('Музей Толстого')]));
 const result=await search('Музей',city);assert.equal(result.place,null);assert.equal(result.status,'choose');assert.equal(result.candidates.length,2);assert.equal(result.candidates[0].inCity,true);
 const generic=await searcher(async()=>ok([row('Музей')]))('музей',city);assert.equal(generic.place,null);assert.equal(generic.status,'choose');
});
test('search expands to nearby areas and country, sorts nearest first and never auto-selects another city',async()=>{
 const views=[];
 const search=searcher(async value=>{const url=new URL(value);
  if(url.hostname.includes('open-meteo'))return ok({results:[]});
  views.push(url.searchParams.get('viewbox'));
  if(views.length<3)return ok([]);
  return ok([row('Музей дальний','Чебоксары',56.14,47.25),row('Музей ближний','Свияжск',55.77,48.66),row('Музей чужой','Другой город',55.78,48.65,'kz')]);
 });
 const result=await search('Музей',city);assert.equal(views.length,3);assert.notEqual(views[0],views[1]);assert.equal(result.scope,'nearby');assert.equal(result.status,'choose');assert.equal(result.place,null);assert.equal(result.candidates[0].city,'Свияжск');assert.ok(result.candidates[0].distanceKm<result.candidates[1].distanceKm);assert.equal(result.candidates.some(p=>p.countryCode==='KZ'),false);
 let attempts=0;
 const national=await searcher(async value=>{const url=new URL(value);if(!url.hostname.includes('nominatim'))return ok({results:[]});attempts++;if(url.searchParams.has('viewbox'))return ok([]);assert.equal(url.searchParams.get('countrycodes'),'ru');return ok([row('Эрмитаж','Санкт-Петербург',59.94,30.31)]);})('Эрмитаж',city);
 assert.equal(attempts,4);assert.equal(national.scope,'country');assert.equal(national.place,null);assert.equal(national.candidates[0].city,'Санкт-Петербург');
});
test('Open-Meteo resolves a settlement but cannot replace a missing museum with its city center',async()=>{
 const fetchImpl=async value=>{const url=new URL(value);if(url.hostname.includes('nominatim'))return ok([]);assert.equal(url.searchParams.get('countryCode'),'RU');return ok({results:[{id:1,name:'Свияжск',latitude:55.77,longitude:48.66,country_code:'RU',country:'Россия',feature_code:'PPL'}]});};
 const settlement=await searcher(fetchImpl)('Свияжск',city);assert.equal(settlement.source,'open-meteo');assert.equal(settlement.status,'choose');
 const museum=await searcher(fetchImpl)('Несуществующий музей',city);assert.equal(museum.status,'not_found');assert.equal(museum.place,null);
});
test('cache coalesces simultaneous requests and separates cities/countries',async()=>{
 let calls=0;const search=searcher(async()=>{calls++;await new Promise(resolve=>setTimeout(resolve,10));return ok([row('Кремль')]);});
 const [a,b]=await Promise.all([search('Кремль',city),search('Кремль',city)]);assert.equal(calls,1);a.place.name='changed';assert.equal(b.place.name,'Кремль');await search('Кремль',city);assert.equal(calls,1);
 await search('Кремль',{name:'Москва',country:'Россия',latitude:55.75,longitude:37.61});assert.ok(calls>1);
});
test('offline, throttled or malformed services preserve a result object; no city means no global search',async()=>{
 const offline=await searcher(async()=>{throw Error('private provider url');})('Музей',city);assert.equal(offline.status,'unavailable');assert.equal(offline.place,null);assert.ok(!JSON.stringify(offline).includes('private'));
 const malformed=await searcher(async value=>new URL(value).hostname.includes('nominatim')?ok([null]):ok({results:[]}))('Музей',city);assert.equal(malformed.place,null);
 const noCity=await searcher(async()=>{throw Error('must not call');})('Музей',{});assert.equal(noCity.status,'no_city');
 assert.equal(countryCode({country:'France'}),'FR');assert.equal(countryCode({country:'Франция'}),'FR');
 const noCoords=await searcher(async()=>ok([row('Кремль','Другой город')]))('Кремль',{name:'Казань',country:'Россия'});assert.equal(noCoords.place,null);
});
test('Yandex place and geocoder adapters normalize country, coordinates and place type',async()=>{
 for(const source of ['yandex','yandex-geocoder']){
  const result=await searcher(async value=>{const url=new URL(value);assert.equal(url.searchParams.get('apikey'),'private-test');assert.equal(url.searchParams.get('rspn'),'1');assert.ok(url.searchParams.get('bbox'));
   if(source==='yandex')return ok({features:[{geometry:{coordinates:[49.11,55.8]},properties:{CompanyMetaData:{id:'company',name:'Музей Тукая',address:'Россия, Казань, улица Тукая',Address:{country_code:'RU',Components:[{kind:'locality',name:'Казань'}]},Categories:[{name:'Музей'}]}}}]});
   return ok({response:{GeoObjectCollection:{featureMember:[{GeoObject:{name:'Музей Тукая',Point:{pos:'49.11 55.8'},metaDataProperty:{GeocoderMetaData:{kind:'museum',Address:{country_code:'RU',formatted:'Казань, улица Тукая',Components:[{kind:'locality',name:'Казань'}]}}}}}]}}});
  },{PLACES_API_KEY:'private-test',PLACES_PROVIDER:source})('Музей Тукая',city);
  assert.equal(result.status,'matched');assert.equal(result.place.source,source);assert.equal(result.place.lng,49.11);assert.equal(result.place.countryCode,'RU');
 }
});
test('429 falls back without exposing errors; negative cache can be explicitly refreshed',async()=>{
 const throttled=await searcher(async value=>new URL(value).hostname.includes('nominatim')?{ok:false,status:429}:ok({results:[{name:'Свияжск',latitude:55.77,longitude:48.66,country_code:'RU',feature_code:'PPL'}]}))('Свияжск',city);
 assert.equal(throttled.source,'open-meteo');assert.equal(throttled.status,'choose');
 let calls=0;const search=searcher(async value=>{calls++;return ok(new URL(value).hostname.includes('nominatim')?[]:{results:[]});});
 const missing=await search('Невозможное место',city);assert.equal(missing.status,'not_found');const count=calls;
 await search('Невозможное место',city);assert.equal(calls,count);await search('Невозможное место',city,{refresh:true});assert.ok(calls>count);
});
