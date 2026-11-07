const $ = (selector) => document.querySelector(selector);

let points = [];
let events = [];
let transfers = [];
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

async function api(endpoint, options) {
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
  await loadData();
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
    dateSet.add('2025-06-12');
    dateSet.add('2025-06-13');
    dateSet.add('2025-06-14');
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

function eventCard(event) {
  const point = points.find((item) => item.id === event.pointId);
  const key = itemKey('event', event.id);
  const materials = (event.materials || [])
    .filter(Boolean)
    .map((material) => `<img src="${esc(material)}" alt="" onerror="this.style.display='none'">`)
    .join('');

  return `
    <article class="timeline-item event ${selectedKey === key ? 'selected' : ''}" data-kind="event" data-id="${esc(event.id)}">
      <div class="event-actions">
        <button class="icon" type="button" data-edit-event="${esc(event.id)}">✎</button>
        <button class="icon" type="button" data-delete-event="${esc(event.id)}">×</button>
      </div>
      <div class="event-time">${eventIcons[event.type] || '✨'} ${esc(event.startTime)}${event.endTime ? ` — ${esc(event.endTime)}` : ''}${event.endDate && event.endDate !== event.date ? ` · ${esc(event.endDate)}` : ''}</div>
      <div class="event-title">${esc(event.title)}</div>
      <div class="event-meta">${point ? `📍 ${esc(point.name)}` : 'Без геоточки'}</div>
      ${event.description ? `<div class="event-desc">${esc(event.description)}</div>` : ''}
      ${materials ? `<div class="materials">${materials}</div>` : ''}
    </article>
  `;
}

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

init().catch((error) => {
  $('#timeline').innerHTML = `<div class="error">Не удалось загрузить данные: ${esc(error.message)}</div>`;
});
