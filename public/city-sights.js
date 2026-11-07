// Optional OSM layer. Cache is independent of the user's route and events.
window.loadCitySights = async function(map, trip, onAdded) {
  const city = trip.city;
  if (!city || !Number.isFinite(city.latitude) || !Number.isFinite(city.longitude)) return;
  const notice = document.createElement('div');
  notice.className = 'sights-status'; notice.setAttribute('role','status');
  document.querySelector('.map-wrap').append(notice);
  const cacheKey = `glider-sights-v1:${city.latitude}:${city.longitude}`;
  let cached;
  try { cached = JSON.parse(localStorage.getItem(cacheKey)); } catch {}
  const status = text => { notice.textContent = text; };
  const distance = p => (p.lat-city.latitude)**2 + ((p.lng-city.longitude)*Math.cos(city.latitude*Math.PI/180))**2;
  let sights;
  try {
    if (cached && Date.now()-cached.saved < 86400000 && Array.isArray(cached.items)) sights = cached.items;
    else {
      status('Загружаем достопримечательности…');
      const query = `[out:json][timeout:20];(nwr(around:8000,${city.latitude},${city.longitude})[tourism~"^(attraction|museum|viewpoint|gallery)$"];nwr(around:8000,${city.latitude},${city.longitude})[historic];);out center tags;`;
      const response = await fetch('https://overpass-api.de/api/interpreter', {
        method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'},
        body:new URLSearchParams({data:query}), signal:AbortSignal.timeout(25000)
      });
      if (!response.ok) throw Error('Overpass');
      const result = await response.json();
      if (result.remark || !Array.isArray(result.elements)) throw Error('Incomplete Overpass response');
      sights = result.elements.map(e=>({osmId:`${e.type}/${e.id}`,name:e.tags?.['name:ru']||e.tags?.name||e.tags?.tourism||e.tags?.historic,lat:e.lat??e.center?.lat,lng:e.lon??e.center?.lon,tags:e.tags||{}}))
        .filter(p=>p.name&&Number.isFinite(p.lat)&&Number.isFinite(p.lng)).sort((a,b)=>distance(a)-distance(b)).slice(0,100);
      try { localStorage.setItem(cacheKey,JSON.stringify({saved:Date.now(),items:sights})); } catch {}
    }
    status(sights.length ? `Достопримечательности OSM: ${sights.length} · радиус 8 км` : 'В радиусе 8 км достопримечательности не найдены');
  } catch {
    status('Не удалось загрузить достопримечательности');
    if (!cached || !Array.isArray(cached.items)) return;
    sights = cached.items; status('Не удалось обновить достопримечательности. Показан сохранённый кэш.');
  }
  sights.forEach(sight => {
    const marker = L.marker([sight.lat,sight.lng], {zIndexOffset:300,riseOnHover:true,icon:L.divIcon({className:'sight-marker',html:'<span aria-hidden="true">★</span>',iconSize:[28,28],iconAnchor:[14,14]}),title:sight.name}).addTo(map);
    const box=document.createElement('div'); box.className='sight-popup';
    const title=document.createElement('strong'); title.textContent=sight.name;box.append(title);
    const desc=document.createElement('p');desc.textContent=sight.tags.description||sight.tags['description:ru']||`Объект OpenStreetMap · ${sight.tags.tourism||sight.tags.historic||'достопримечательность'}`;box.append(desc);
    if(sight.tags.opening_hours){const p=document.createElement('p');p.textContent='Часы работы: '+sight.tags.opening_hours;box.append(p)}
    function link(label,href){try{const u=new URL(href);if(!['http:','https:'].includes(u.protocol))return;const a=document.createElement('a');a.textContent=label;a.href=u.href;a.target='_blank';a.rel='noopener noreferrer';box.append(a,document.createElement('br'))}catch{}}
    if(sight.tags.website)link('Сайт',sight.tags.website);
    const wiki=sight.tags.wikipedia;
    if(wiki&&/^[a-z-]+:/.test(wiki)){const [lang,...article]=wiki.split(':');link('Википедия',`https://${lang}.wikipedia.org/wiki/${encodeURIComponent(article.join(':'))}`)}
    if(sight.tags.wikimedia_commons)link('Wikimedia Commons',`https://commons.wikimedia.org/wiki/${encodeURIComponent(sight.tags.wikimedia_commons)}`);
    link('OpenStreetMap',`https://www.openstreetmap.org/${sight.osmId}`);
    const button=document.createElement('button');button.type='button';button.className='primary';button.textContent='Добавить в маршрут';box.append(button);
    const message=document.createElement('p');message.setAttribute('role','status');box.append(message);
    let point=null,complete=false;
    async function request(endpoint,data){const response=await fetch(endpoint+'?'+new URLSearchParams({tripId:trip.id}),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const result=await response.json();if(!response.ok)throw Error((result.errors||[result.error]).join(', '));return result}
    button.onclick=async()=>{
      if(complete)return;button.disabled=true;message.textContent='Добавляем…';
      try {
        if(!point) point=await request('/api/points',{name:sight.name,lat:sight.lat,lng:sight.lng,description:desc.textContent});
        const date=trip.startDate || `${trip.year}-${String(trip.month).padStart(2,'0')}-01`;const start=new Date(date+'T10:00:00');
        await request('/api/events',{title:sight.name,type:'excursion',date,startTime:'10:00',pointId:point.id,description:desc.textContent,startAt:start.toISOString()});
        complete=true;button.textContent='Добавлено';message.textContent='Точка и событие добавлены на первый день поездки, 10:00. Время можно изменить в таймлайне.';
        await onAdded();
      } catch(error){message.textContent=point?'Точка сохранена, но событие не добавлено. Нажмите ещё раз: '+error.message:'Не удалось добавить: '+error.message;button.disabled=false}
    };
    marker.bindPopup(box);
  });
};
