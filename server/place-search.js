// Server-only provider adapters. Never return request URLs or provider error bodies.
const COUNTRIES = new Map([['россия','RU'],['russia','RU'],['russian federation','RU'],['uk','GB'],['украина','UA']]);
const clean = value => String(value || '').normalize('NFKC').toLowerCase().replace(/ё/g,'е').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
for (const locale of ['ru','en']) {
  const names = new Intl.DisplayNames([locale], {type:'region'});
  for(let a=65;a<=90;a++)for(let b=65;b<=90;b++){
    const code=String.fromCharCode(a,b),name=names.of(code);
    if(name && name!==code && new Intl.Locale('und-'+code).region===code && !COUNTRIES.has(clean(name)))COUNTRIES.set(clean(name),code);
  }
}
function countryCode(city) {
  const code=String(city?.countryCode||city?.country_code||'').toUpperCase();
  if(/^[A-Z]{2}$/.test(code))return code==='UK'?'GB':code;
  return COUNTRIES.get(clean(city?.country)) || null;
}
function center(city) {
  const lat=city?.latitude,lng=city?.longitude;
  return Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180?{lat,lng}:null;
}
function distance(a,b) {
  const rad=Math.PI/180,dlat=(b.lat-a.lat)*rad,dlng=(b.lng-a.lng)*rad;
  const h=Math.sin(dlat/2)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(dlng/2)**2;
  return 6371*2*Math.asin(Math.sqrt(Math.min(1,h)));
}
function bounds(c,km) {
  const dlat=km/111,dlng=km/(111*Math.max(.01,Math.cos(c.lat*Math.PI/180)));
  return [Math.max(-180,c.lng-dlng),Math.min(90,c.lat+dlat),Math.min(180,c.lng+dlng),Math.max(-90,c.lat-dlat)];
}
const coordinate=value=>typeof value==='number'?value:typeof value==='string'&&value.trim()?Number(value):NaN;
const cityName = address => address?.city || address?.town || address?.village || address?.municipality || address?.hamlet || '';
function confident(query,place) {
  const words=clean(query).split(' ').filter(word=>word.length>2&&!['музей','кафе','парк','отель','ресторан','театр','вокзал','гостиница','сходить','посетить'].includes(word));
  return place.inCity && words.length>0 && words.some(word=>clean(place.name).includes(word));
}
function createPlaceSearcher({fetchImpl=fetch,env=process.env,minIntervalMs=1100,timeoutMs=2500,budgetMs=14000}={}) {
  const cache=new Map(),pending=new Map(),cooldown=new Map();
  let queue=Promise.resolve(),lastRequest=0;
  async function json(source,base,params,deadline,headers={}) {
    if(Date.now()>=deadline || (cooldown.get(source)||0)>Date.now())return null;
    try {
      if(source==='nominatim'){
        const before=queue;
        let release;queue=new Promise(resolve=>{release=resolve;});
        await before;
        try {
          const delay=Math.max(0,minIntervalMs-(Date.now()-lastRequest));
          if(Date.now()+delay>=deadline)return null;
          if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
          lastRequest=Date.now();
          return await send();
        }finally{release();}
      }
      return await send();
    }catch{return null;}
    async function send(){
      if(Date.now()>=deadline)return null;
      const response=await fetchImpl(base+'?'+new URLSearchParams(params),{headers,redirect:'error',signal:AbortSignal.timeout(Math.max(1,Math.min(timeoutMs,deadline-Date.now())))});
      if(!response.ok){
        if([401,403,429].includes(response.status))cooldown.set(source,Date.now()+(response.status===429?60000:1800000));
        return null;
      }
      const data=await response.json();
      if(data.meta?.code && data.meta.code!==200){
        if([401,403,429].includes(data.meta.code))cooldown.set(source,Date.now()+1800000);
        return null;
      }
      return data;
    }
  }
  async function provider(source,query,city,scope,deadline) {
    const c=center(city),code=countryCode(city),box=c&&scope.radius?bounds(c,scope.radius):null;
    const qualified=scope.kind==='city'?[query,city?.name].filter(Boolean).join(', '):scope.kind==='country'?[query,city?.country||code].filter(Boolean).join(', '):query;
    if(source==='2gis'){
      const params={key:env.PLACES_API_KEY,q:qualified,locale:'ru_RU',page_size:'10',fields:'items.point,items.address,items.adm_div,items.rubrics'};
      if(c && scope.radius)Object.assign(params,{point:`${c.lng},${c.lat}`,radius:String(Math.min(50000,scope.radius*1000))});
      // Larger areas use a rectangle; the server also filters distance and country.
      if(box && scope.radius>50){delete params.radius;delete params.point;params.point1=`${box[0]},${box[1]}`;params.point2=`${box[2]},${box[3]}`;}
      const data=await json(source,'https://catalog.api.2gis.com/3.0/items',params,deadline);
      if(data===null)return null;
      return (data?.result?.items||[]).map(row=>({id:row.id,name:row.name,lat:row.point?.lat,lng:row.point?.lon,address:row.full_name||row.address_name,city:row.adm_div?.find(a=>a.type==='city')?.name,country:row.adm_div?.find(a=>a.type==='country')?.name,type:row.rubrics?.[0]?.name||row.type}));
    }
    if(source==='yandex'){
      const params={apikey:env.PLACES_API_KEY,text:qualified,lang:'ru_RU',results:'10',type:'biz'};
      if(box)Object.assign(params,{bbox:`${box[0]},${box[3]}~${box[2]},${box[1]}`,rspn:'1'});
      const data=await json(source,'https://search-maps.yandex.ru/v1/',params,deadline);
      if(data===null)return null;
      return (data?.features||[]).map(row=>{
        const meta=row.properties?.CompanyMetaData||{},components=meta.Address?.Components||[];
        return {id:meta.id,name:meta.name||row.properties?.name,lng:row.geometry?.coordinates?.[0],lat:row.geometry?.coordinates?.[1],address:meta.address,city:components.find(a=>a.kind==='locality')?.name||String(meta.address||'').split(',').map(x=>x.trim()).find(x=>clean(x)===clean(city?.name)),country:components.find(a=>a.kind==='country')?.name||String(meta.address||'').split(',')[0],countryCode:meta.Address?.country_code,type:meta.Categories?.[0]?.name};
      });
    }
    if(source==='yandex-geocoder'){
      const params={apikey:env.PLACES_API_KEY,geocode:qualified,format:'json',lang:'ru_RU',results:'10'};
      if(box)Object.assign(params,{bbox:`${box[0]},${box[3]}~${box[2]},${box[1]}`,rspn:'1'});
      const data=await json(source,'https://geocode-maps.yandex.ru/1.x/',params,deadline);
      if(data===null)return null;
      return (data?.response?.GeoObjectCollection?.featureMember||[]).map(row=>{
        const object=row.GeoObject||{},meta=object.metaDataProperty?.GeocoderMetaData||{},components=meta.Address?.Components||[],coordinates=(object.Point?.pos||'').split(' ').map(Number);
        return {name:object.name,lng:coordinates[0],lat:coordinates[1],address:meta.Address?.formatted||meta.text,countryCode:meta.Address?.country_code,city:components.find(a=>a.kind==='locality')?.name,type:meta.kind};
      });
    }
    if(source==='nominatim'){
      const params={q:qualified,format:'jsonv2',limit:'10','accept-language':'ru',addressdetails:'1',namedetails:'1',dedupe:'1'};
      if(code)params.countrycodes=code.toLowerCase();
      if(box){params.viewbox=box.join(',');params.bounded='1';}
      const data=await json(source,'https://nominatim.openstreetmap.org/search',params,deadline,{'User-Agent':'TravelersGlider/1.0 (travel itinerary place lookup)'});
      if(data===null)return null;
      return (Array.isArray(data)?data:[]).map(row=>({id:row.place_id,name:row.namedetails?.['name:ru']||row.name||String(row.display_name||'').split(',')[0]||query,lat:coordinate(row.lat),lng:coordinate(row.lon),city:cityName(row.address),countryCode:row.address?.country_code,address:row.display_name,type:row.type||row.class}));
    }
    // Open-Meteo indexes settlements, not POIs: never invent a museum at a city center.
    const params={name:query,count:'10',language:'ru',format:'json'};
    if(code)params.countryCode=code;
    const data=await json(source,'https://geocoding-api.open-meteo.com/v1/search',params,deadline);
    if(data===null)return null;
    return (data?.results||[]).filter(row=>/^PPL/.test(row.feature_code||'') && clean(row.name)===clean(query)).map(row=>({id:row.id,name:row.name,lat:row.latitude,lng:row.longitude,city:row.name,countryCode:row.country_code,country:row.country,address:[row.name,row.admin1,row.country].filter(Boolean).join(', '),type:'settlement'}));
  }
  function normalize(rows,query,city,source,scope) {
    const c=center(city),code=countryCode(city);
    const places=[];
    for(const raw of rows){
      const {lat,lng}=raw;
      if(!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180)continue;
      const candidateCode=countryCode(raw);
      // Do not leak cross-border or unverified-country results into broader searches.
      if(code && candidateCode!==code)continue;
      const distanceKm=c?distance(c,{lat,lng}):null;
      if(scope.radius && distanceKm!==null && distanceKm>scope.radius)continue;
      const locality=String(raw.city||'').slice(0,150);
      if(!c && clean(locality)!==clean(city?.name))continue;
      const inCity=!!city?.name && (clean(locality)===clean(city.name) || (!locality && distanceKm!==null && distanceKm<=10 && scope.kind==='city'));
      const name=String(raw.name||query).slice(0,200);
      const place={id:`${source}:${raw.id||lat+','+lng}`.slice(0,200),name,city:locality||(inCity?city.name:''),countryCode:candidateCode||code,lat,lng,type:String(raw.type||'place').slice(0,100),address:String(raw.address||'').slice(0,500),source,distanceKm:distanceKm===null?null:Math.round(distanceKm*10)/10,inCity,scope:scope.kind};
      place.displayName=[place.name,place.city].filter(Boolean).join(' — ');
      place.confident=confident(query,place);
      if(!places.some(other=>distance(other,place)<.08 && clean(other.name)===clean(place.name)))places.push(place);
    }
    return places.sort((a,b)=>Number(b.inCity)-Number(a.inCity)||(a.distanceKm??Infinity)-(b.distanceKm??Infinity)).slice(0,6);
  }
  async function run(query,city) {
    const c=center(city),code=countryCode(city),deadline=Date.now()+budgetMs;
    const scopes=[{kind:'city',radius:c?50:null}];
    if(c && code)scopes.push({kind:'nearby',radius:150},{kind:'nearby',radius:300},{kind:'country',radius:null});
    const selection=env.PLACES_PROVIDER||'auto';
    const paid=env.PLACES_API_KEY && selection!=='none'?(selection==='auto'?['2gis','yandex','yandex-geocoder']:[selection]):[];
    const sources=[...paid.filter(source=>['2gis','yandex','yandex-geocoder'].includes(source)),'nominatim','open-meteo'];
    let available=false;
    for(const scope of scopes){
      for(const source of sources){
        if(Date.now()>=deadline)break;
        let rows;try{rows=await provider(source,query,city,scope,deadline);}catch{rows=null;}
        if(rows!==null)available=true;
        const candidates=normalize(rows||[],query,city,source,scope);
        if(candidates.length){
          const place=candidates.length===1 && candidates[0].confident?candidates[0]:null;
          return {place,candidates,status:place?'matched':'choose',scope:scope.kind,source,cacheable:true};
        }
      }
    }
    return {place:null,candidates:[],status:available?'not_found':'unavailable',scope:null,source:null,cacheable:available};
  }
  return async function search(query,city={},{refresh=false}={}) {
    query=String(query||'').trim().slice(0,200);
    if(!query)return {place:null,candidates:[],status:'not_found',cacheable:false};
    // Without a selected city, do not search arbitrary places across the world.
    if(!city?.name && !center(city))return {place:null,candidates:[],status:'no_city',cacheable:false};
    const key=JSON.stringify([clean(query),clean(city.name),countryCode(city),center(city)]);
    const cached=cache.get(key);
    if(!refresh && cached && Date.now()-cached.at<(cached.result.status==='not_found'?60000:86400000))return structuredClone(cached.result);
    if(pending.has(key))return structuredClone(await pending.get(key));
    const promise=run(query,city).catch(()=>({place:null,candidates:[],status:'unavailable',cacheable:false}));
    pending.set(key,promise);
    try{
      const result=await promise;
      if(result.cacheable){if(cache.size>=500)cache.delete(cache.keys().next().value);cache.set(key,{at:Date.now(),result});}
      return structuredClone(result);
    }finally{pending.delete(key);}
  };
}
const instances=new WeakMap();
function searchPlaces(query,city,options={}) {
  const fetchImpl=options.fetchImpl||fetch,env=options.env||process.env;
  let configs=instances.get(fetchImpl);if(!configs){configs=new WeakMap();instances.set(fetchImpl,configs);}
  let search=configs.get(env);if(!search){search=createPlaceSearcher({...options,fetchImpl,env});configs.set(env,search);}
  return search(query,city,{refresh:options.refresh===true});
}
module.exports={searchPlaces,createPlaceSearcher,countryCode,distance,bounds};
