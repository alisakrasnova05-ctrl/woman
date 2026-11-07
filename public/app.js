const $ = (selector) => document.querySelector(selector);

let attractions=[],userPosition=null,userMarker=null,watchId=null;
let points = [];
let events = [];
let transfers = [];
let tripStartDate = null;
let selectedDate = '2025-06-12';
let selectedKey = null;
let markers = {};
let transferLines = [];
let pickingPoint = false;

const map = L.map('map').setView([55.7558, 37.6173], 12);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap',
}).addTo(map);

map.on('click', (event) => {
  if (!pickingPoint) return;
  $('#pointLat').value = event.latlng.lat.toFixed(6);
  $('#pointLng').value = event.latlng.lng.toFixed(6);
  pickingPoint = false;
  document.body.classList.remove('picking-point');
  $('#pointPickHint').textContent = 'Координаты выбраны на карте.';
  $('#pointDialog').showModal();
});

const eventIcons = {
  excursion: '🏛️',
  stay: '🛏️',
  restaurant: '🍽️',
  meeting: '🤝',
  other: '✨',
};

const transportMeta = {
  walking: { label: 'Пешком', icon: '🚶', color: '#0ea5e9' },
  car: { label: 'Автомобиль', icon: '🚗', color: '#f97316' },
  train: { label: 'Поезд', icon: '🚆', color: '#8b5cf6' },
  plane: { label: 'Самолёт', icon: '✈️', color: '#2563eb' },
  other: { label: 'Другой транспорт', icon: '🚌', color: '#64748b' },
};

const activeTripId = new URLSearchParams(location.search).get('trip') || 'legacy';
async function api(endpoint, options) {
  if (/^\/api\/(points|events|transfers)(\/|$|\?)/.test(endpoint)) endpoint += (endpoint.includes('?') ? '&' : '?') + 'tripId=' + encodeURIComponent(activeTripId);
  const response = await fetch(endpoint, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!response.ok) {
    const error = await response.json();
    throw Error((error.errors || [error.error]).join(', '));
  }
  return response.status === 204 ? null : response.json();
}

async function loadData() {
  [points, events, transfers] = await Promise.all([
    api('/api/points'),
    api('/api/events'),
    api('/api/transfers'),
  ]);
}

async function init() {
  const trips = await api('/api/trips');
  const trip = trips.find(t => t.id === activeTripId);
  if (!trip) throw Error('Путешествие не найдено. Вернитесь на главную.');
  document.querySelector('.trip').textContent = trip.title + ' · ' + trip.startDate;
  tripStartDate = trip.startDate;
  selectedDate = trip.startDate;
  await loadData();
  attractions=await api('/api/attractions');
  $('#attractionId').innerHTML='<option value="">Без экскурсионной точки</option>'+attractions.map(a=>`<option value="${a.id}">${esc(a.name)}</option>`).join('');
  renderAttractions();
  attractions.forEach(a=>{const m=L.marker([a.lat,a.lng]).addTo(map);m.on('click',()=>openAttraction(a.id));attractionMarkers[a.id]=m;});
  const availableDates = dates();
  if (!availableDates.includes(selectedDate)) selectedDate = availableDates[0];
  fillPointSelects();
  render();
}

function fillPointSelects() {
  const pointOptions = points
    .map((point) => `<option value="${esc(point.id)}">${esc(point.name)}</option>`)
    .join('');

  $('#pointId').innerHTML = `<option value="">Без геоточки</option>${pointOptions}`;
  $('#transferFromPointId').innerHTML = `<option value="">Выберите точку</option>${pointOptions}`;
  $('#transferToPointId').innerHTML = `<option value="">Выберите точку</option>${pointOptions}`;
}

function dates() {
  const allItems = [...events, ...transfers];
  const dateSet = new Set(allItems.flatMap((item) => [item.date, item.endDate || item.date]));
  if (!dateSet.size) {
    const base = new Date((tripStartDate || new Date().toISOString().slice(0,10))+'T12:00:00');
    for (let i=0;i<4;i++){const date=new Date(base);date.setDate(base.getDate()+i);dateSet.add(`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`);}
  }
  return [...dateSet].filter(Boolean).sort();
}

function renderDays() {
  $('#days').innerHTML = dates()
    .map((date) => `
      <button class="day ${date === selectedDate ? 'active' : ''}" data-date="${date}">
        ${new Date(`${date}T00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
      </button>
    `)
    .join('');

  document.querySelectorAll('.day').forEach((button) => {
    button.onclick = () => {
      selectedDate = button.dataset.date;
      selectedKey = null;
      render();
    };
  });
}

function visible(item) {
  return item.date === selectedDate
    || (item.endDate && item.date < selectedDate && item.endDate >= selectedDate);
}

function itemKey(kind, id) {
  return `${kind}:${id}`;
}

function timelineItems() {
  return [
    ...events.filter(visible).map((item) => ({ kind: 'event', item })),
    ...transfers.filter(visible).map((item) => ({ kind: 'transfer', item })),
  ].sort((a, b) => {
    const dateCompare = (a.item.date || '').localeCompare(b.item.date || '');
    if (dateCompare) return dateCompare;
    const timeCompare = (a.item.startTime || '').localeCompare(b.item.startTime || '');
    if (timeCompare) return timeCompare;
    return a.kind === 'transfer' ? -1 : 1;
  });
}

function render() {
  renderDays();
  const items = timelineItems();
  $('#timeline').innerHTML = items.length
    ? items.map(({ kind, item }) => kind === 'event' ? eventCard(item) : transferCard(item)).join('')
    : '<div class="empty">В этот день пока нет событий и перемещений.<br>Добавьте первый элемент.</div>';

  document.querySelectorAll('.timeline-item').forEach((element) => {
    element.onclick = () => selectItem(element.dataset.kind, element.dataset.id);
  });

  document.querySelectorAll('[data-edit-event]').forEach((button) => {
    button.onclick = (event) => {
      event.stopPropagation();
      openEventForm(events.find((item) => item.id === button.dataset.editEvent));
    };
  });

  document.querySelectorAll('[data-delete-event]').forEach((button) => {
    button.onclick = async (event) => {
      event.stopPropagation();
      if (!confirm('Удалить событие?')) return;
      await api(`/api/events/${button.dataset.deleteEvent}`, { method: 'DELETE' });
      await loadData();
      render();
    };
  });

  document.querySelectorAll('[data-edit-transfer]').forEach((button) => {
    button.onclick = (event) => {
      event.stopPropagation();
      openTransferForm(transfers.find((item) => item.id === button.dataset.editTransfer));
    };
  });

  document.querySelectorAll('[data-delete-transfer]').forEach((button) => {
    button.onclick = async (event) => {
      event.stopPropagation();
      if (!confirm('Удалить перемещение?')) return;
      await api(`/api/transfers/${button.dataset.deleteTransfer}`, { method: 'DELETE' });
      await loadData();
      render();
    };
  });

  drawMap(items);
}

function eventCard(event){return featureCard(event)}

function transferCard(transfer) {
  const from = points.find((item) => item.id === transfer.fromPointId);
  const to = points.find((item) => item.id === transfer.toPointId);
  const meta = transportMeta[transfer.mode] || transportMeta.other;
  const key = itemKey('transfer', transfer.id);

  return `
    <article class="timeline-item transfer-card ${selectedKey === key ? 'selected' : ''}" data-kind="transfer" data-id="${esc(transfer.id)}">
      <div class="event-actions">
        <button class="icon" type="button" data-edit-transfer="${esc(transfer.id)}">✎</button>
        <button class="icon" type="button" data-delete-transfer="${esc(transfer.id)}">×</button>
      </div>
      <div class="event-time">${meta.icon} Дорога · ${esc(meta.label)}</div>
      <div class="transfer-route">
        <span>${from ? esc(from.name) : 'Точка удалена'}</span>
        <span class="transfer-arrow">→</span>
        <span>${to ? esc(to.name) : 'Точка удалена'}</span>
      </div>
      <div class="event-meta">${esc(transfer.startTime)} — ${esc(transfer.endTime)}${transfer.endDate && transfer.endDate !== transfer.date ? ` · прибытие ${esc(transfer.endDate)}` : ''}</div>
      ${transfer.description ? `<div class="event-desc">${esc(transfer.description)}</div>` : ''}
    </article>
  `;
}

function drawMap(items) {
  Object.values(markers).forEach((marker) => map.removeLayer(marker));
  transferLines.forEach((line) => map.removeLayer(line));
  markers = {};
  transferLines = [];

  points.forEach((point) => {
    const key = `point:${point.id}`;
    const marker = L.marker([point.lat, point.lng])
      .addTo(map)
      .bindPopup(pointPopup(point));
    markers[key] = marker;
  });

  items.forEach(({ kind, item }) => {
    if (kind === 'event') return;

    const from = points.find((candidate) => candidate.id === item.fromPointId);
    const to = points.find((candidate) => candidate.id === item.toPointId);
    if (!from || !to) return;
    const meta = transportMeta[item.mode] || transportMeta.other;
    const key = itemKey('transfer', item.id);
    const selected = selectedKey === key;
    const line = L.polyline(
      [[from.lat, from.lng], [to.lat, to.lng]],
      {
        color: meta.color,
        weight: selected ? 7 : 4,
        opacity: selected ? 1 : 0.8,
        dashArray: '9 7',
      },
    )
      .addTo(map)
      .bindPopup(`<b>${esc(from.name)} → ${esc(to.name)}</b><br>${meta.icon} ${esc(meta.label)} · ${esc(item.startTime)} — ${esc(item.endTime)}`);
    line.on('click', () => selectItem('transfer', item.id, false));
    transferLines.push(line);

    [from, to].forEach((point) => {
      const endpoint = L.circleMarker([point.lat, point.lng], {
        radius: selected ? 8 : 6,
        color: meta.color,
        fillColor: '#fff',
        fillOpacity: 1,
        weight: 3,
      })
        .addTo(map)
        .bindTooltip(point.name);
      transferLines.push(endpoint);
    });
  });
}

function pointPopup(point) {
  return `
    <div class="point-popup">
      <b>${esc(point.name)}</b>
      ${point.description ? `<div>${esc(point.description)}</div>` : ''}
      <div class="point-popup-actions">
        <button type="button" data-edit-point="${esc(point.id)}">Изменить</button>
        <button type="button" data-delete-point="${esc(point.id)}">Удалить</button>
      </div>
    </div>
  `;
}

function selectItem(kind, id, pan = true) {
  selectedKey = itemKey(kind, id);
  render();

  if (kind === 'event') {
    const event = events.find((item) => item.id === id);
    const point = event && points.find((item) => item.id === event.pointId);
    if (point && pan) {
      map.setView([point.lat, point.lng], 15);
      markers[`point:${point.id}`]?.openPopup();
    }
  } else {
    const transfer = transfers.find((item) => item.id === id);
    const from = transfer && points.find((item) => item.id === transfer.fromPointId);
    const to = transfer && points.find((item) => item.id === transfer.toPointId);
    if (from && to && pan) {
      map.fitBounds([[from.lat, from.lng], [to.lat, to.lng]], { padding: [60, 60], maxZoom: 15 });
    }
  }

  document.querySelector(`[data-kind="${kind}"][data-id="${id}"]`)
    ?.scrollIntoView({ block: 'nearest' });
}

function openEventForm(event) {
  $('#eventForm').reset();
  $('#formError').textContent = '';
  $('#eventId').value = event?.id || '';
  $('#formTitle').textContent = event ? 'Редактировать событие' : 'Новое событие';
  if (event) {
    Object.entries(event).forEach(([key, value]) => {
      const element = $(`#${key}`);
      if (element) element.value = Array.isArray(value) ? value.join(', ') : value || '';
    });
  } else {
    $('#date').value = selectedDate;
    $('#endDate').value = selectedDate;
  }
  $('#eventDialog').showModal();
}

function openTransferForm(transfer) {
  $('#transferForm').reset();
  $('#transferFormError').textContent = '';
  $('#transferId').value = transfer?.id || '';
  $('#transferFormTitle').textContent = transfer ? 'Редактировать перемещение' : 'Новое перемещение';
  if (transfer) {
    Object.entries(transfer).forEach(([key, value]) => {
      const element = $(`#transfer${key[0].toUpperCase()}${key.slice(1)}`);
      if (element) element.value = value || '';
    });
  } else {
    $('#transferDate').value = selectedDate;
    $('#transferEndDate').value = selectedDate;
    if (points.length > 1) {
      $('#transferFromPointId').value = points[0].id;
      $('#transferToPointId').value = points[1].id;
    }
  }
  $('#transferDialog').showModal();
}

function openPointForm(point) {
  $('#pointForm').reset();
  $('#pointFormError').textContent = '';
  $('#pointEditId').value = point?.id || '';
  $('#pointFormTitle').textContent = point ? 'Редактировать точку' : 'Новая точка';
  $('#pointPickHint').textContent = 'Можно указать координаты вручную или нажать на карту.';
  if (point) {
    $('#pointName').value = point.name || '';
    $('#pointLat').value = point.lat ?? '';
    $('#pointLng').value = point.lng ?? '';
    $('#pointDescription').value = point.description || '';
  } else {
    const center = map.getCenter();
    $('#pointLat').value = center.lat.toFixed(6);
    $('#pointLng').value = center.lng.toFixed(6);
  }
  $('#pointDialog').showModal();
}

$('#addBtn').onclick = () => openEventForm();
$('#closeBtn').onclick = () => $('#eventDialog').close();
$('#cancelBtn').onclick = () => $('#eventDialog').close();

$('#addTransferBtn').onclick = () => openTransferForm();
$('#closeTransferBtn').onclick = () => $('#transferDialog').close();
$('#cancelTransferBtn').onclick = () => $('#transferDialog').close();

$('#addPointBtn').onclick = () => openPointForm();
$('#closePointBtn').onclick = () => $('#pointDialog').close();
$('#cancelPointBtn').onclick = () => $('#pointDialog').close();
$('#pickPointBtn').onclick = () => {
  pickingPoint = true;
  document.body.classList.add('picking-point');
  $('#pointPickHint').textContent = 'Нажмите на нужное место на карте.';
  $('#pointDialog').close();
};

$('#eventForm').onsubmit = async (submitEvent) => {
  submitEvent.preventDefault();
  const data = {
    title: $('#title').value,
    type: $('#type').value,
    date: $('#date').value,
    startTime: $('#startTime').value,
    endTime: $('#endTime').value,
    endDate: $('#endDate').value || $('#date').value,
    pointId: $('#pointId').value || null,
    attractionId: $('#attractionId').value || null,
    description: $('#description').value,
    bookingUrl: $('#bookingUrl').value,
    materials: $('#materials').value.split(',').map((value) => value.trim()).filter(Boolean),
  };

  try {
    const id = $('#eventId').value;
    await api(id ? `/api/events/${id}` : '/api/events', {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify(data),
    });
    await loadData();
    selectedDate = data.date;
    $('#eventDialog').close();
    render();
  } catch (error) {
    $('#formError').textContent = error.message;
  }
};

$('#transferForm').onsubmit = async (submitEvent) => {
  submitEvent.preventDefault();
  const data = {
    fromPointId: $('#transferFromPointId').value,
    toPointId: $('#transferToPointId').value,
    mode: $('#transferMode').value,
    date: $('#transferDate').value,
    startTime: $('#transferStartTime').value,
    endDate: $('#transferEndDate').value,
    endTime: $('#transferEndTime').value,
    description: $('#transferDescription').value,
  };

  try {
    const id = $('#transferId').value;
    await api(id ? `/api/transfers/${id}` : '/api/transfers', {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify(data),
    });
    await loadData();
    selectedDate = data.date;
    $('#transferDialog').close();
    render();
  } catch (error) {
    $('#transferFormError').textContent = error.message;
  }
};

$('#pointForm').onsubmit = async (submitEvent) => {
  submitEvent.preventDefault();
  const data = {
    name: $('#pointName').value,
    lat: $('#pointLat').value,
    lng: $('#pointLng').value,
    description: $('#pointDescription').value,
  };

  try {
    const id = $('#pointEditId').value;
    await api(id ? `/api/points/${id}` : '/api/points', {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify(data),
    });
    await loadData();
    fillPointSelects();
    $('#pointDialog').close();
    render();
  } catch (error) {
    $('#pointFormError').textContent = error.message;
  }
};

document.addEventListener('click', async (event) => {
  const editButton = event.target.closest('[data-edit-point]');
  if (editButton) {
    event.stopPropagation();
    const point = points.find((item) => item.id === editButton.dataset.editPoint);
    if (point) openPointForm(point);
    return;
  }

  const deleteButton = event.target.closest('[data-delete-point]');
  if (deleteButton) {
    event.stopPropagation();
    if (!confirm('Удалить точку и связанные с ней перемещения?')) return;
    await api(`/api/points/${deleteButton.dataset.deletePoint}`, { method: 'DELETE' });
    selectedKey = null;
    await loadData();
    fillPointSelects();
    render();
  }
});

function esc(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[character]));
}

function updateClock(){const el=$('#localClock');if(el){const now=new Date();el.textContent=new Intl.DateTimeFormat('ru-RU',{hour:'2-digit',minute:'2-digit',second:'2-digit',timeZoneName:'short'}).format(now)}}
function geoMessage(msg){let el=$('#geoStatus');if(!el){el=document.createElement('div');el.id='geoStatus';$('#timeline').before(el)}el.className='geo-status';el.textContent=msg}
function locate(){if(!navigator.geolocation){geoMessage('Геолокация недоступна в этом браузере.');return}geoMessage('Запрашиваю разрешение на геолокацию…');const success=pos=>{userPosition={lat:pos.coords.latitude,lng:pos.coords.longitude};if(!userMarker){userMarker=L.marker([userPosition.lat,userPosition.lng],{icon:L.divIcon({className:'user-location',iconSize:[18,18]})}).addTo(map).bindPopup('Вы здесь')}else userMarker.setLatLng([userPosition.lat,userPosition.lng]);const nearest=points.map(p=>({...p,d:distanceKm(userPosition,p)})).sort((a,b)=>a.d-b.d)[0];geoMessage(nearest?`Вы здесь. Ближайшая точка: ${nearest.name} · ${fmtDistance(nearest.d)}`:'Позиция определена.');render()}
const error=err=>{const msg=err.code===1?'Доступ к геолокации запрещён. Разрешите её в настройках браузера или продолжайте без неё.':err.code===2?'Позиция недоступна. Проверьте GPS или сеть.':'Геолокация не ответила вовремя. Попробуйте ещё раз.';geoMessage(msg)};navigator.geolocation.getCurrentPosition(success,error,{enableHighAccuracy:true,timeout:10000});if(watchId===null)watchId=navigator.geolocation.watchPosition(success,error,{enableHighAccuracy:true,maximumAge:5000,timeout:15000})}
function isNow(e){if(!e.startAt)return false;const now=Date.now(),start=Date.parse(e.startAt),end=e.endAt?Date.parse(e.endAt):start+60000;return now>=start&&now<=end}
function distanceKm(a,b){const R=6371,dLat=(b.lat-a.lat)*Math.PI/180,dLon=(b.lng-a.lng)*Math.PI/180;const x=Math.sin(dLat/2)**2+Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*Math.sin(dLon/2)**2;return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x))}
function fmtDistance(k){return k<1?Math.round(k*1000)+' м':k.toFixed(1)+' км'}
function offsetFor(tz){try{const parts=new Intl.DateTimeFormat('en-US',{timeZone:tz,timeZoneName:'longOffset'}).formatToParts(new Date());return parts.find(x=>x.type==='timeZoneName')?.value.replace('GMT','UTC')||tz}catch{return tz}}
function featureCard(e){const attraction=attractions.find(a=>a.id===e.attractionId);const p=points.find(p=>p.id===e.pointId);const mats=(e.materials||[]).filter(Boolean).map(u=>`<img src="${u}" onerror="this.style.display='none'">`).join('');return `<article class="timeline-item event ${selectedKey===itemKey('event',e.id)?'selected':''}" data-kind="event" data-id="${e.id}"><div class="event-actions"><button class="icon" data-edit-event="${e.id}">✎</button><button class="icon" data-delete-event="${e.id}">×</button></div><div class="event-time">${eventIcons[e.type]||'✨'} ${e.startTime}${e.endTime?' — '+e.endTime:''} ${offsetFor(points.find(p=>p.id===e.pointId)?.timezone||'Europe/Moscow')}${isNow(e)?'<span class="now-badge">идёт сейчас</span>':''}${e.endDate&&e.endDate!==e.date?' · '+e.endDate:''}</div><div class="event-title">${esc(e.title)}</div><div class="event-meta">${p? '📍 '+esc(p.name):'Без геоточки'}</div>${e.description?`<div class="event-desc">${esc(e.description)}</div>`:''}${attraction?`<div class="event-meta">📸 ${esc(attraction.name)}</div><div class="materials">${(attraction.photos||[]).slice(0,3).map(u=>`<img src="${u}" onerror="this.style.display='none'">`).join('')}</div>`:''}${userPosition&&p?`<div class="distance">${fmtDistance(distanceKm(userPosition,p))} до места <a class="route-link" target="_blank" href="https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}">Построить маршрут</a></div>`:''}${e.bookingUrl?`<div class="event-meta"><a href="${esc(e.bookingUrl)}" target="_blank" rel="noopener">🎟 Бронь / билет</a></div>`:''}${mats?`<div class="materials">${mats}</div>`:''}</article>`}
function renderAttractions(){$('#attractions').innerHTML=attractions.map(a=>`<div class="attraction-card" data-attraction="${a.id}"><img src="${a.photos?.[0]||''}" onerror="this.style.display='none'"><b>${esc(a.name)}</b><span class="stars">${stars(avg(a))}</span></div>`).join('');document.querySelectorAll('[data-attraction]').forEach(el=>el.onclick=()=>openAttraction(el.dataset.attraction));}
function avg(a){const r=a.reviews||[];return r.length?r.reduce((x,y)=>x+y.rating,0)/r.length:0}
function stars(n){return '★★★★★'.slice(0,Math.round(n))+'☆☆☆☆☆'.slice(0,5-Math.round(n))}
function openAttraction(id){const a=attractions.find(x=>x.id===id);if(!a)return;$('#placeContent').innerHTML=`<h2>${esc(a.name)}</h2><div class="place-photos">${(a.photos||[]).map(u=>`<img src="${u}" onerror="this.style.display='none'">`).join('')}</div><p>${esc(a.description)}</p><div class="stars">${stars(avg(a))} <small>${avg(a).toFixed(1)} / 5 (${(a.reviews||[]).length})</small></div><h3>Отзывы</h3>${(a.reviews||[]).map(r=>`<div class="review"><strong>${esc(r.name)} · <span class="stars">${stars(r.rating)}</span></strong><p>${esc(r.text)}</p></div>`).join('')}`;$('#reviewForm').dataset.attraction=id;$('#reviewForm').reset();$('#reviewError').textContent='';$('#attractionDialog').showModal();const m=attractionMarkers[id];if(m){map.setView([a.lat,a.lng],15);m.openPopup()}}
const attractionMarkers={};

$('#locateBtn').onclick=locate;setInterval(()=>{updateClock();document.querySelectorAll('.timeline-item[data-kind="event"]').forEach(el=>{const e=events.find(e=>e.id===el.dataset.id);if(e)el.querySelector('.event-time')?.classList.toggle('now-badge',isNow(e))})},1000);updateClock();$('#placeClose').onclick=()=>$('#attractionDialog').close();$('#reviewForm').onsubmit=async ev=>{ev.preventDefault();const id=ev.currentTarget.dataset.attraction;try{await api('/api/attractions/'+id+'/reviews',{method:'POST',body:JSON.stringify({name:$('#reviewName').value,rating:Number($('#reviewRating').value),text:$('#reviewText').value})});attractions=await api('/api/attractions');renderAttractions();openAttraction(id)}catch(e){$('#reviewError').textContent=e.message}};

init().catch((error) => {
  $('#timeline').innerHTML = `<div class="error">Не удалось загрузить данные: ${esc(error.message)}</div>`;
});
