// Load nearby OSM sights and the bundled guide entries for the selected city.
window.loadCitySights = async function(map, trip, onAdded) {
  const city = trip.city;
  const cityName = city?.name || trip.destination || trip.title || '';
  const hasCoordinates = Number.isFinite(city?.latitude) && Number.isFinite(city?.longitude);
  const notice = document.querySelector('#sightsStatus');
  const list = document.querySelector('#attractions');
  const status = text => { if (notice) notice.textContent = text; };
  if (!list) return;
  const center = hasCoordinates ? {lat:city.latitude,lng:city.longitude} : null;
  const distanceKm = (a,b) => {
    const rad = value => value * Math.PI / 180;
    const dLat = rad(b.lat-a.lat), dLng = rad(b.lng-a.lng);
    const h = Math.sin(dLat/2)**2 + Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dLng/2)**2;
    return 6371 * 2 * Math.atan2(Math.sqrt(h),Math.sqrt(1-h));
  };
  const cacheKey = center ? `glider-sights-v1:${center.lat}:${center.lng}` : '';
  let cached;
  if (cacheKey) try { cached = JSON.parse(localStorage.getItem(cacheKey)); } catch {}
  const markers = new Map();
  let sights = [];

  function uniqueSights(items) {
    const seen = new Set();
    return items.filter(item => {
      const key = item.name.toLocaleLowerCase('ru').replace(/ё/g,'е');
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });
  }

  function addMarker(sight) {
    const marker = L.marker([sight.lat,sight.lng], {
      zIndexOffset:300,
      riseOnHover:true,
      icon:L.divIcon({className:'sight-marker',html:'<span class="sight-marker-symbol" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m12 2.8 2.55 6.65 6.65 2.55-6.65 2.55L12 21.2l-2.55-6.65L2.8 12l6.65-2.55L12 2.8Z"/><circle cx="12" cy="12" r="2.2"/></svg></span>',iconSize:[32,32],iconAnchor:[16,16]}),
      title:sight.name,
    }).addTo(map);
    markers.set(sight.name.toLocaleLowerCase('ru'),marker);

    const box=document.createElement('div'); box.className='sight-popup';
    const title=document.createElement('strong'); title.textContent=sight.name; box.append(title);
    const description=sight.description || sight.tags?.description || sight.tags?.['description:ru'] || `Достопримечательность · ${sight.tags?.tourism||sight.tags?.historic||'городской объект'}`;
    const desc=document.createElement('p'); desc.textContent=description; box.append(desc);
    if(sight.tags?.opening_hours){const p=document.createElement('p');p.textContent='Часы работы: '+sight.tags.opening_hours;box.append(p);}
    function link(label,href){try{const u=new URL(href);if(!['http:','https:'].includes(u.protocol))return;const a=document.createElement('a');a.textContent=label;a.href=u.href;a.target='_blank';a.rel='noopener noreferrer';box.append(a,document.createElement('br'));}catch{}}
    if(sight.tags?.website)link('Сайт',sight.tags.website);
    const wiki=sight.tags?.wikipedia;
    if(wiki&&/^[a-z-]+:/.test(wiki)){const [lang,...article]=wiki.split(':');link('Википедия',`https://${lang}.wikipedia.org/wiki/${encodeURIComponent(article.join(':'))}`);}
    if(sight.tags?.wikimedia_commons)link('Wikimedia Commons',`https://commons.wikimedia.org/wiki/${encodeURIComponent(sight.tags.wikimedia_commons)}`);
    if(sight.osmId&&!sight.osmId.startsWith('guide/'))link('OpenStreetMap',`https://www.openstreetmap.org/${sight.osmId}`);
    const button=document.createElement('button');button.type='button';button.className='primary';button.textContent='Добавить в маршрут';box.append(button);
    const message=document.createElement('p');message.setAttribute('role','status');box.append(message);
    let point=null,complete=false;
    async function request(endpoint,data){const response=await fetch(endpoint+'?'+new URLSearchParams({tripId:trip.id}),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const result=await response.json();if(!response.ok)throw Error((result.errors||[result.error]).join(', '));return result;}
    button.onclick=async()=>{
      if(complete)return;button.disabled=true;message.textContent='Добавляем…';
      try {
        if(!point)point=await request('/api/points',{name:sight.name,lat:sight.lat,lng:sight.lng,description});
        const date=trip.startDate||`${trip.year}-${String(trip.month).padStart(2,'0')}-01`;
        await request('/api/events',{title:sight.name,type:'excursion',date,startTime:'10:00',pointId:point.id,description});
        complete=true;button.textContent='Добавлено';message.textContent='Добавлено в маршрут на 10:00. Время можно изменить в таймлайне.';
        await onAdded();
      } catch(error) {message.textContent=point?'Точка сохранена, событие не добавлено. Нажмите ещё раз: '+error.message:'Не удалось добавить: '+error.message;button.disabled=false;}
    };
    marker.bindPopup(box);
    return marker;
  }

  function render(items, message) {
    sights=uniqueSights(items);
    list.replaceChildren();
    if(!sights.length){const empty=document.createElement('div');empty.className='sights-empty';empty.textContent='Для этого города пока нет загруженных достопримечательностей.';list.append(empty);status(message||'Список пока пуст');return;}
    sights.forEach(sight=>{
      const marker=markers.get(sight.name.toLocaleLowerCase('ru'))||addMarker(sight);
      const card=document.createElement('article');card.className='sight-card';
      if(sight.photo){const image=document.createElement('img');image.src=sight.photo;image.alt='';image.loading='lazy';image.onerror=()=>image.remove();card.append(image);}
      else {const art=document.createElement('div');art.className='sight-card-art';art.setAttribute('aria-hidden','true');art.textContent='✦';card.append(art);}
      const copy=document.createElement('div');copy.className='sight-card-copy';
      const title=document.createElement('h3');title.textContent=sight.name;copy.append(title);
      const description=document.createElement('p');description.textContent=sight.description||sight.tags?.['name:ru']||sight.tags?.tourism||sight.tags?.historic||'Достопримечательность';copy.append(description);
      const focus=document.createElement('button');focus.type='button';focus.textContent='Показать на карте';focus.onclick=()=>{map.setView([sight.lat,sight.lng],15);marker.openPopup();};copy.append(focus);
      card.append(copy);list.append(card);
    });
    status(message||`Найдено мест: ${sights.length}`);
  }

  let guide=[];
  try {
    const response=await fetch('/api/attractions');
    if(response.ok){
      const items=await response.json();
      guide=items.filter(item=>Number.isFinite(item.lat)&&Number.isFinite(item.lng)&&(!center ? /казан/i.test(cityName) : distanceKm(center,{lat:item.lat,lng:item.lng})<=30))
        .map(item=>({osmId:`guide/${item.id}`,name:item.name,lat:item.lat,lng:item.lng,description:item.description,photo:item.photos?.[0],tags:{tourism:'attraction'}}));
    }
  } catch {}
  guide.forEach(addMarker);
  if(guide.length)render(guide,`Подборка для ${cityName||'города'}`);
  else if(!center){render([],cityName?'Для этого места нет офлайн-подборки':'Выберите город, чтобы загрузить достопримечательности');return;}
  status(center?'Загружаем достопримечательности рядом…':`Подборка для ${cityName}`);

  let osmSights=[];
  try {
    if(cached&&Date.now()-cached.saved<86400000&&Array.isArray(cached.items))osmSights=cached.items;
    else {
      const query=`[out:json][timeout:15];(nwr(around:8000,${center.lat},${center.lng})[tourism~"^(attraction|museum|viewpoint|gallery)$"];nwr(around:8000,${center.lat},${center.lng})[historic];);out center tags;`;
      const response=await fetch('https://overpass-api.de/api/interpreter',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({data:query}),signal:AbortSignal.timeout(18000)});
      if(!response.ok)throw Error('Overpass');
      const result=await response.json();
      if(result.remark||!Array.isArray(result.elements))throw Error('Incomplete Overpass response');
      osmSights=result.elements.map(e=>({osmId:`${e.type}/${e.id}`,name:e.tags?.['name:ru']||e.tags?.name||e.tags?.tourism||e.tags?.historic,lat:e.lat??e.center?.lat,lng:e.lon??e.center?.lon,tags:e.tags||{}}))
        .filter(item=>item.name&&Number.isFinite(item.lat)&&Number.isFinite(item.lng)).sort((a,b)=>distanceKm(center,a)-distanceKm(center,b)).slice(0,100);
      try{localStorage.setItem(cacheKey,JSON.stringify({saved:Date.now(),items:osmSights}));}catch{}
    }
    osmSights.forEach(item=>{if(!markers.has(item.name.toLocaleLowerCase('ru')))addMarker(item);});
    render([...guide,...osmSights],`Достопримечательностей загружено: ${uniqueSights([...guide,...osmSights]).length}`);
  } catch {
    if(cached&&Array.isArray(cached.items)){
      cached.items.forEach(item=>{if(!markers.has(item.name.toLocaleLowerCase('ru')))addMarker(item);});
      render([...guide,...cached.items],'Не удалось обновить список; показаны сохранённые места.');
    } else if(guide.length) render(guide,'Показана городская подборка; внешний каталог временно недоступен.');
    else render([],'Не удалось загрузить достопримечательности. Попробуйте позже.');
  }
};
