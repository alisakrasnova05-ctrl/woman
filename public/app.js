const $ = (selector) => document.querySelector(selector);

let userPosition=null,userMarker=null,watchId=null;
let points = [];
let events = [];
let transfers = [];
let tripStartDate = null;
let tripEndDate = null;
let selectedDate = '2025-06-12';
let selectedKey = null;
let markers = {};
let transferLines = [];
let pickingPoint = false;
let resumeEventAfterPoint = false;
let eventMaterials = [];
let pendingPhotos = [];
let photoPreviewUrls = [];

const map = L.map('map').setView([25, 10], 2);
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
  excursion: GliderIcons.icon("excursion"),
  stay: GliderIcons.icon("stay"),
  restaurant: GliderIcons.icon("restaurant"),
  meeting: GliderIcons.icon("meeting"),
  other: GliderIcons.icon("other"),
};

const transportMeta = {
  walking: { label: 'Пешком', icon: GliderIcons.icon("walking"), color: '#467568' },
  car: { label: 'Автомобиль', icon: GliderIcons.icon("car"), color: '#a63d2b' },
  train: { label: 'Поезд', icon: GliderIcons.icon("train"), color: '#795977' },
  plane: { label: 'Самолёт', icon: GliderIcons.icon("plane"), color: '#1f3b3d' },
  other: { label: 'Другой транспорт', icon: GliderIcons.icon("other"), color: '#75614d' },
};

const requestedDay = new URLSearchParams(location.search).get('date');
const focusedDay = /^\d{4}-\d{2}-\d{2}$/.test(requestedDay || '') && Number.isFinite(Date.parse(requestedDay)) && new Date(requestedDay).toISOString().slice(0,10)===requestedDay ? requestedDay : null;
const activeTripId = new URLSearchParams(location.search).get('trip') || 'legacy';
const mapStorageKey = 'glider-map-v1:' + activeTripId;
const mapParams = new URLSearchParams(location.search);
const requestedEvent = mapParams.get('event');
let mapReady = false, lastPlace = null;
const validPosition = p => p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat)<=90 && Math.abs(p.lng)<=180;
const motionOptions = () => ({animate:!matchMedia('(prefers-reduced-motion: reduce)').matches,duration:0.4});
function readMapState() {
  try {
    const state = JSON.parse(localStorage.getItem(mapStorageKey));
    return state && validPosition(state.center) && Number.isFinite(state.zoom) && state.zoom>=0 && state.zoom<=19 ? state : null;
  } catch { return null; }
}
function saveMapState() {
  if (!mapReady) return;
  const center=map.getCenter().wrap();
  try {localStorage.setItem(mapStorageKey,JSON.stringify({center:{lat:center.lat,lng:center.lng},zoom:map.getZoom(),place:lastPlace,day:selectedDate}));} catch {}
}
function placePoint(place) {
  if (!place) return null;
  if (place.kind==='point') return points.find(p=>p.id===place.id);
  if (place.kind==='event') {const event=events.find(e=>e.id===place.id);return event && points.find(p=>p.id===event.pointId);}
  if (place.kind==='transfer') {const transfer=transfers.find(t=>t.id===place.id);return transfer && points.find(p=>p.id===transfer.fromPointId);}
  return null;
}
function focusPoint(point,zoom=15) {
  if(validPosition(point)) map.flyTo([point.lat,point.lng],zoom,motionOptions());
}
function restoreMap(trip) {
  const state=readMapState();
  const explicitEvent=events.find(e=>e.id===requestedEvent);
  const dayEvent=focusedDay && (!state || state.day!==focusedDay) && events.find(e=>e.date<=focusedDay && (e.endDate||e.date)>=focusedDay && validPosition(points.find(p=>p.id===e.pointId)));
  const navigationType=performance.getEntriesByType('navigation')[0]?.type;
  const target=(explicitEvent && (navigationType==='navigate' || state?.place?.kind!=='event' || state.place.id!==explicitEvent.id || (focusedDay && state.day!==focusedDay)) ? explicitEvent : null) || dayEvent;
  if(target) {
    selectedDate=focusedDay || target.date;
    lastPlace={kind:'event',id:target.id};selectedKey=itemKey('event',target.id);
    render();
    const point=placePoint(lastPlace);
    if(validPosition(point)) focusPoint(point);
    else if(state) map.flyTo(state.center,state.zoom,motionOptions());
    else defaultMapView(trip);
  } else if(state) {
    lastPlace=state.place;
    const point=placePoint(lastPlace);
    if(lastPlace?.kind==='city' || validPosition(point)) {
      if(!focusedDay && state.day && dates().includes(state.day)) selectedDate=state.day;
      const event=lastPlace.kind==='event' && events.find(e=>e.id===lastPlace.id);
      if(!focusedDay && event && !(event.date<=selectedDate && (event.endDate||event.date)>=selectedDate))selectedDate=event.date;
      selectedKey=lastPlace.kind==='city'?null:itemKey(lastPlace.kind,lastPlace.id);
      render();
    } else if(lastPlace) {lastPlace=null;defaultMapView(trip);mapReady=true;saveMapState();return;}
    map.flyTo(state.center,state.zoom,motionOptions());
  } else defaultMapView(trip);
  mapReady=true;
  saveMapState();
}
function defaultMapView(trip) {
  const city=trip.city && {lat:trip.city.latitude,lng:trip.city.longitude};
  if(validPosition(city)) {focusPoint(city,12);return;}
  const located=points.filter(validPosition);
  if(located.length) document.querySelector('.map-hint').textContent='Нажмите на точку или перемещение, чтобы открыть подробности';
  if(located.length>1) map.fitBounds(located.map(p=>[p.lat,p.lng]),{padding:[45,45],maxZoom:13,...motionOptions()});
  else if(located.length===1) focusPoint(located[0]);
  else {map.setView([25,10],2);document.querySelector('.map-hint').textContent='Выберите город при создании путешествия';}
}
map.on('moveend zoomend',saveMapState);
window.addEventListener('pagehide',saveMapState);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')saveMapState();});
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
  document.querySelector('.trip').textContent = trip.title + ' · ' + (trip.startDate || 'Даты не выбраны');
  tripStartDate = trip.startDate;
  tripEndDate = trip.endDate;
  selectedDate = focusedDay || trip.startDate;
  const savedView=readMapState();
  if(savedView) map.flyTo(savedView.center,savedView.zoom,motionOptions());
  else defaultMapView(trip);
  await loadData();
  if (trip.city && Number.isFinite(trip.city.latitude) && Number.isFinite(trip.city.longitude)) {
    const city = trip.city;

    L.marker([city.latitude, city.longitude], {title:city.name,icon:L.divIcon({className:"journal-marker city-marker",html:GliderIcons.icon("glider"),iconSize:[36,36],iconAnchor:[18,30]})}).addTo(map).bindPopup(esc(city.name)).on('click',()=>{lastPlace={kind:"city"};selectedKey=null;render();focusPoint({lat:city.latitude,lng:city.longitude},12);saveMapState();});
    if (!points.length) document.querySelector('.map-hint').textContent = 'Добавьте первую точку маршрута';
  }
  const availableDates = dates();
  if (!availableDates.includes(selectedDate)) selectedDate = availableDates[0];
  fillPointSelects();
  render();
  restoreMap(trip);
  window.loadCitySights(map, trip, async () => {await loadData();fillPointSelects();selectedDate=trip.startDate || dates()[0];render();});
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
  const dateSet = new Set(focusedDay ? [focusedDay] : []);
  if (tripStartDate && tripEndDate) {
    const current = new Date(tripStartDate+'T00:00:00Z');
    const end = new Date(tripEndDate+'T00:00:00Z');
    while (current <= end) {
      dateSet.add(current.toISOString().slice(0,10));
      current.setUTCDate(current.getUTCDate()+1);
    }
  }
  allItems.forEach((item) => {
    if (!item.date) return;
    const endDate = item.endDate || item.date;
    let current = new Date(`${item.date}T00:00:00Z`);
    const last = new Date(`${endDate}T00:00:00Z`);
    while (current <= last) {
      dateSet.add(current.toISOString().slice(0, 10));
      current.setUTCDate(current.getUTCDate() + 1);
    }
  });
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
    ...events.filter(visible).map((item) => ({
      kind: 'event',
      item,
      continuation: item.date < selectedDate,
    })),
    ...transfers.filter(visible).map((item) => ({
      kind: 'transfer',
      item,
      continuation: item.date < selectedDate,
    })),
  ].sort((a, b) => {
    const aDate = a.continuation ? selectedDate : a.item.date || '';
    const bDate = b.continuation ? selectedDate : b.item.date || '';
    const dateCompare = aDate.localeCompare(bDate);
    if (dateCompare) return dateCompare;
    const aTime = a.continuation ? '00:00' : a.item.startTime || '';
    const bTime = b.continuation ? '00:00' : b.item.startTime || '';
    const timeCompare = aTime.localeCompare(bTime);
    if (timeCompare) return timeCompare;
    return a.kind === 'transfer' ? -1 : 1;
  });
}

function render() {
  document.querySelector('.city-marker')?.classList.toggle('marker-selected',lastPlace?.kind==='city');
  renderDays();
  const items = timelineItems();
  $('#timeline').innerHTML = items.length
    ? items.map(({ kind, item, continuation }) => (
      kind === 'event' ? eventCard(item, continuation) : transferCard(item)
    )).join('')
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

function eventCard(event, continuation = false) {
  return featureCard(event, continuation);
}

function transferCard(transfer) {
  const from = points.find((item) => item.id === transfer.fromPointId);
  const to = points.find((item) => item.id === transfer.toPointId);
  const meta = transportMeta[transfer.mode] || transportMeta.other;
  const key = itemKey('transfer', transfer.id);

  return `
    <article class="timeline-item transfer-card ${selectedKey === key ? 'selected' : ''}" data-kind="transfer" data-id="${esc(transfer.id)}">
      <div class="event-actions">
        <button class="icon" type="button" data-edit-transfer="${esc(transfer.id)}" aria-label="Редактировать">${GliderIcons.icon("edit")}</button>
        <button class="icon" type="button" data-delete-transfer="${esc(transfer.id)}">×</button>
      </div>
      <div class="event-time"><span class="event-kind-icon" aria-hidden="true">${meta.icon}</span><span class="event-time-copy">Дорога · ${esc(meta.label)}</span></div>
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
    const marker = L.marker([point.lat, point.lng], {icon:L.divIcon({className:"journal-marker",html:GliderIcons.icon(events.find(e=>e.pointId===point.id)?.type || "pin"),iconSize:[34,34],iconAnchor:[17,30]})})
      .addTo(map)
      .bindPopup(pointPopup(point));
    const selectedPoint = selectedKey === key || events.some((event) => selectedKey === itemKey('event', event.id) && event.pointId === point.id);
    marker.getElement()?.classList.toggle('marker-selected', selectedPoint);
    marker.on('click',()=>{
      const event=events.find(e=>e.pointId===point.id && e.date<=selectedDate && (e.endDate||e.date)>=selectedDate) || events.find(e=>e.pointId===point.id);
      if(event){if(!(event.date<=selectedDate && (event.endDate||event.date)>=selectedDate))selectedDate=event.date;selectItem('event',event.id);}
      else {lastPlace={kind:'point',id:point.id};selectedKey=key;render();focusPoint(point);markers[key]?.openPopup();saveMapState();}
    });
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
        className: 'journal-route',
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
  lastPlace = {kind,id};
  render();

  if (kind === 'event') {
    const event = events.find((item) => item.id === id);
    const point = event && points.find((item) => item.id === event.pointId);
    if (point && pan) {
      focusPoint(point);
      markers[`point:${point.id}`]?.openPopup();
    }
  } else {
    const transfer = transfers.find((item) => item.id === id);
    const from = transfer && points.find((item) => item.id === transfer.fromPointId);
    const to = transfer && points.find((item) => item.id === transfer.toPointId);
    if (from && to && pan) {
      map.fitBounds([[from.lat, from.lng], [to.lat, to.lng]], { padding: [60, 60], maxZoom: 15, ...motionOptions() });
    }
  }

  saveMapState();
  document.querySelector(`[data-kind="${kind}"][data-id="${id}"]`)
    ?.scrollIntoView({ block: 'nearest' });
}

function openEventForm(event) {
  photoPreviewUrls.forEach((photoUrl) => URL.revokeObjectURL(photoUrl));
  photoPreviewUrls = [];
  pendingPhotos = [];
  eventMaterials = [...(event?.materials || [])];
  $('#eventForm').reset();
  $('#formError').textContent = '';
  $('#photoPreview').innerHTML = '';
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
  renderPhotoPreview();
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

function openPointForm(point, returnToEvent = false) {
  resumeEventAfterPoint = returnToEvent;
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

$('#addPointFromEventBtn').onclick = () => openPointForm(null, true);
$('#closePointBtn').onclick = () => closePointForm();
$('#cancelPointBtn').onclick = () => closePointForm();
$('#pickPointBtn').onclick = () => {
  resumeEventAfterPoint = $('#eventDialog').open;
  pickingPoint = true;
  document.body.classList.add('picking-point');
  $('#pointPickHint').textContent = 'Нажмите на нужное место на карте.';
  $('#pointDialog').close();
  if ($('#eventDialog').open) $('#eventDialog').close();
};

$('#photoFiles').onchange = () => {
  const selectedPhotos = [...$('#photoFiles').files];
  const invalidPhoto = selectedPhotos.find((photo) => (
    !['image/jpeg', 'image/png'].includes(photo.type) || photo.size > 10 * 1024 * 1024
  ));
  if (invalidPhoto) {
    $('#formError').textContent = 'Выберите JPG или PNG не больше 10 МБ каждый.';
    $('#photoFiles').value = '';
    return;
  }
  $('#formError').textContent = '';
  pendingPhotos.push(...selectedPhotos);
  $('#photoFiles').value = '';
  renderPhotoPreview();
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
    description: $('#description').value,
    materials: [...eventMaterials],
  };

  try {
    const id = $('#eventId').value;
    if (pendingPhotos.length) {
      const uploadedPhotos = await uploadPhotos(pendingPhotos);
      data.materials.push(...uploadedPhotos.map((photo) => photo.url));
    }
    await api(id ? `/api/events/${id}` : '/api/events', {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify(data),
    });
    await loadData();
    selectedDate = data.date;
    $('#eventDialog').close();
    pendingPhotos = [];
    eventMaterials = [];
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
    const savedPoint = await api(id ? `/api/points/${id}` : '/api/points', {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify(data),
    });
    await loadData();
    fillPointSelects();
    $('#pointDialog').close();
    if (resumeEventAfterPoint) {
      resumeEventAfterPoint = false;
      $('#pointId').value = savedPoint.id;
      if (!$('#eventDialog').open) $('#eventDialog').showModal();
    } else {
      render();
    }
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
function featureCard(event, continuation = false) {
  const point = points.find((item) => item.id === event.pointId);
  const photos = (event.materials || [])
    .filter(Boolean)
    .map((photo) => `<img src="${esc(photo)}" alt="" onerror="this.style.display='none'">`)
    .join('');
  const time = continuation
    ? `Продолжение · до ${esc(event.endTime || 'конца дня')}`
    : `${esc(event.startTime)}${event.endTime ? ` — ${esc(event.endTime)}` : ''}`;
  const timezone = offsetFor(point?.timezone || 'Europe/Moscow');
  const endDate = !continuation && event.endDate && event.endDate !== event.date
    ? ` · до ${esc(event.endDate)}`
    : '';
  return `
    <article class="timeline-item event ${selectedKey === itemKey('event', event.id) ? 'selected' : ''}" data-kind="event" data-id="${esc(event.id)}">
      <div class="event-actions">
        <button class="icon" type="button" data-edit-event="${esc(event.id)}" aria-label="Редактировать">${GliderIcons.icon("edit")}</button>
        <button class="icon" type="button" data-delete-event="${esc(event.id)}">×</button>
      </div>
      <div class="event-time"><span class="event-kind-icon" aria-hidden="true">${eventIcons[event.type] || GliderIcons.icon("other")}</span><span class="event-time-copy">${time} ${esc(timezone)}${endDate}${isNow(event) ? '<span class="now-badge">идёт сейчас</span>' : ''}</span></div>
      <div class="event-title">${esc(event.title)}</div>
      <div class="event-meta">${point ? `${GliderIcons.icon("pin")} ${esc(point.name)}` : 'Без геоточки'}</div>
      ${event.description ? `<div class="event-desc">${esc(event.description)}</div>` : ''}
      ${userPosition && point ? `<div class="distance">${fmtDistance(distanceKm(userPosition, point))} до места <a class="route-link" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&amp;destination=${point.lat},${point.lng}">Построить маршрут</a></div>` : ''}
      ${event.bookingUrl ? `<div class="event-meta"><a href="${esc(event.bookingUrl)}" target="_blank" rel="noopener">${GliderIcons.icon("ticket")} Бронь / билет</a></div>` : ''}
      ${photos ? `<div class="materials">${photos}</div>` : ''}
    </article>
  `;
}
$('#locateBtn').onclick=locate;setInterval(()=>{updateClock();document.querySelectorAll('.timeline-item[data-kind="event"]').forEach(el=>{const e=events.find(e=>e.id===el.dataset.id);if(e)el.querySelector('.event-time')?.classList.toggle('now-badge',isNow(e))})},1000);updateClock();

init().catch((error) => {
  const state=readMapState();
  if(state) map.flyTo(state.center,state.zoom,motionOptions());
  $('#timeline').innerHTML = `<div class="error">Не удалось загрузить данные: ${esc(error.message)}</div>`;
});

function renderPhotoPreview() {
  photoPreviewUrls.forEach((photoUrl) => URL.revokeObjectURL(photoUrl));
  photoPreviewUrls = [];
  const existing = eventMaterials.map((photoUrl, index) => ({ photoUrl, index, isPending: false }));
  const pending = pendingPhotos.map((file, index) => {
    const photoUrl = URL.createObjectURL(file);
    photoPreviewUrls.push(photoUrl);
    return { photoUrl, index, isPending: true };
  });

  $('#photoPreview').innerHTML = [...existing, ...pending].map((photo) => `
    <div class="photo-preview-item">
      <img src="${esc(photo.photoUrl)}" alt="Прикреплённое фото">
      <button type="button" aria-label="Убрать фото" data-remove-photo="${photo.index}" data-pending="${photo.isPending}">×</button>
    </div>
  `).join('');

  document.querySelectorAll('[data-remove-photo]').forEach((button) => {
    button.onclick = () => {
      const index = Number(button.dataset.removePhoto);
      if (button.dataset.pending === 'true') pendingPhotos.splice(index, 1);
      else eventMaterials.splice(index, 1);
      renderPhotoPreview();
    };
  });
}

async function uploadPhotos(files) {
  const formData = new FormData();
  files.forEach((file) => formData.append('photos', file));
  const response = await fetch('/api/uploads', { method: 'POST', body: formData });
  const result = await response.json();
  if (!response.ok) throw Error(result.error || 'Не удалось загрузить фотографии');
  return result;
}

function closePointForm() {
  $('#pointDialog').close();
  if (resumeEventAfterPoint && !$('#eventDialog').open && !pickingPoint) {
    $('#eventDialog').showModal();
    resumeEventAfterPoint = false;
  }
}
