(() => {
  const $ = (selector) => document.querySelector(selector);
  const today = new Date();
  const params = new URLSearchParams(location.search);
  const tripId = params.get('trip');
  const storageKey = key => tripId ? `${key}:${tripId}` : key;
  const dateKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const parseDate = (key) => new Date(`${key}T12:00:00`);
  const monthNames = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  const headingMonths = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
  const load = (key, fallback) => { try { return JSON.parse(localStorage.getItem(storageKey(key))) || fallback; } catch { return fallback; } };
  let view = new Date(today.getFullYear(), today.getMonth(), 1);
  let selected = load('travelhub-selected-day', dateKey(today));
  let rangeStart = load('travelhub-trip-start', '');
  let rangeEnd = load('travelhub-trip-end', '');
  let notes = load('travelhub-day-notes', {});
  let tripEvents = [], tripPoints = [];
  let ticketDbPromise;

  const yearOptions = [];
  for (let year = 1900; year <= 2100; year += 1) yearOptions.push(`<option value="${year}">${year}</option>`);
  $('#yearSelect').innerHTML = yearOptions.join('');

  let rangePending = false;
  let savedStart = rangeStart, savedEnd = rangeEnd;
  let saving = false, saveError = '';
  async function saveRange(start, end) {
    if (saving) return;
    saving = true; saveError = ''; renderCalendar();
    try {
      if (tripId) {
        const response = await fetch('/api/trips/'+encodeURIComponent(tripId), {
          method:'PATCH',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({startDate:start || null,endDate:end || null})
        });
        if(!response.ok) throw Error('Не удалось сохранить даты. Прежние даты сохранены; повторите выбор при восстановлении сети.');
      }
      savedStart = start; savedEnd = end;
      try {
        localStorage.setItem(storageKey('travelhub-trip-start'), JSON.stringify(start));
        localStorage.setItem(storageKey('travelhub-trip-end'), JSON.stringify(end));
        localStorage.setItem('glider-trips-updated', JSON.stringify({tripId,at:Date.now()}));
      } catch { /* Server remains the source of truth if storage is unavailable. */ }
    } catch(error) { saveError = error.message; }
    finally {
      rangeStart = savedStart; rangeEnd = savedEnd;
      rangePending = false; saving = false; renderCalendar();
    }
  }

  function renderCalendar() {
    $('#calendarTitle').textContent = `${headingMonths[view.getMonth()]} ${view.getFullYear()}`;
    $('#monthSelect').value = String(view.getMonth());
    $('#yearSelect').value = String(view.getFullYear());
    const count = rangeStart && rangeEnd ? Math.round((parseDate(rangeEnd)-parseDate(rangeStart))/86400000)+1 : 0;
    const formatDay = key => parseDate(key).toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric'});
    $('#rangeHint').textContent = saveError || (saving ? 'Сохраняем даты…' : rangePending ? 'Выберите дату окончания или нажмите на ту же дату ещё раз для однодневной поездки' : rangeStart && rangeEnd ? `Поездка: ${formatDay(rangeStart)}${rangeStart === rangeEnd ? '' : ' — ' + formatDay(rangeEnd)} (${count} ${plural(count,'день','дня','дней')})` : 'Даты поездки не выбраны');
    $('#resetDatesBtn').disabled = saving || (!savedStart && !rangeStart);
    const first = new Date(view.getFullYear(), view.getMonth(), 1);
    const offset = (first.getDay() + 6) % 7;
    const start = new Date(view.getFullYear(), view.getMonth(), 1 - offset);
    const cells = [];
    for (let i = 0; i < 42; i += 1) {
      const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const key = dateKey(day);
      const validRange = rangeStart && rangeEnd && rangeEnd >= rangeStart;
      const inside = validRange && key >= rangeStart && key <= rangeEnd;
      const classes = ['calendar-day'];
      if (day.getMonth() !== view.getMonth()) classes.push('outside');
      if (inside) classes.push('in-trip');
      if (key === rangeStart && rangeStart) classes.push('range-start');
      if (key === rangeEnd && rangeEnd && rangeEnd !== rangeStart && validRange) classes.push('range-end');
      if (key === selected) classes.push('selected-day');
      if (key === dateKey(today)) classes.push('today');
      cells.push(`<button type="button" class="${classes.join(' ')}" ${saving ? 'disabled' : ''} role="gridcell" aria-label="${day.getDate()} ${monthNames[day.getMonth()]} ${day.getFullYear()}" aria-pressed="${key === selected}" data-day="${key}">${day.getDate()}</button>`);
    }
    $('#calendarGrid').innerHTML = cells.join('');
    $('#calendarGrid').querySelectorAll('[data-day]').forEach((button) => {
      button.addEventListener('click', () => chooseDay(button.dataset.day));
    });
    if (rangeStart && rangeEnd && rangeEnd >= rangeStart) {
      const count = Math.round((parseDate(rangeEnd) - parseDate(rangeStart)) / 86400000) + 1;
      $('#tripLength').textContent = `${count} ${plural(count, 'день', 'дня', 'дней')}`;
    } else if (rangeStart) $('#tripLength').textContent = 'Выберите конец поездки';
    else $('#tripLength').textContent = 'Даты не выбраны';
  }

  function plural(number, one, few, many) {
    const mod100 = number % 100;
    if (mod100 >= 11 && mod100 <= 14) return many;
    const mod10 = number % 10;
    return mod10 === 1 ? one : mod10 >= 2 && mod10 <= 4 ? few : many;
  }

  function chooseDay(key) {
    if (saving) return;
    saveError = '';
    if (rangePending) {
      rangeEnd = key;
      if (rangeEnd < rangeStart) [rangeStart, rangeEnd] = [rangeEnd, rangeStart];
      rangePending = false;
      saveRange(rangeStart, rangeEnd);
    } else { rangeStart = key; rangeEnd = ''; rangePending = true; }
    selected = key;
    localStorage.setItem(storageKey('travelhub-selected-day'), JSON.stringify(selected));
    const date = parseDate(key);
    if (date.getMonth() !== view.getMonth() || date.getFullYear() !== view.getFullYear()) {
      view = new Date(date.getFullYear(), date.getMonth(), 1);
    }
    renderCalendar();
    renderNotes();
  }

  function openTicketDb() {
    if (!window.indexedDB) return Promise.reject(new Error('Хранилище файлов недоступно в этом браузере.'));
    if (!ticketDbPromise) {
      ticketDbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open('travelhub-ticket-files', 1);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains('files')) request.result.createObjectStore('files', { keyPath: 'id' });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('Не удалось открыть хранилище билетов.'));
      });
    }
    return ticketDbPromise;
  }

  async function saveTicketFile(id, file) {
    const db = await openTicketDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('files', 'readwrite');
      transaction.objectStore('files').put({ id, name: file.name, type: file.type, file });
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error('Не удалось сохранить билет.'));
      transaction.onabort = () => reject(transaction.error || new Error('Не удалось сохранить билет.'));
    });
  }

  async function getTicketFile(id) {
    const db = await openTicketDb();
    return new Promise((resolve, reject) => {
      const request = db.transaction('files', 'readonly').objectStore('files').get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error('Не удалось открыть билет.'));
    });
  }

  async function removeTicketFile(id) {
    if (!id) return;
    const db = await openTicketDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('files', 'readwrite');
      transaction.objectStore('files').delete(id);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error('Не удалось удалить билет.'));
      transaction.onabort = () => reject(transaction.error || new Error('Не удалось удалить билет.'));
    });
  }

  function persistNotes() {
    localStorage.setItem(storageKey('travelhub-day-notes'), JSON.stringify(notes));
  }

  function createTicketId() {
    const unique = window.crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return `${tripId || 'default'}:${unique}`;
  }

  function renderNotes() {
    renderSavedContent();
    const date = parseDate(selected);
    $('#selectedDateLabel').textContent = `${date.getDate()} ${monthNames[date.getMonth()]} ${date.getFullYear()}`;
    $('#notesTitle').textContent = 'Заметки на день';
    const items = notes[selected] || [];
    $('#notesRows').innerHTML = items.map((item, index) => `
      <div class="note-row" data-index="${index}">
        <input type="time" aria-label="Время начала события" value="${escapeAttr(item.startTime || item.time || '')}" data-field="startTime">
        <input type="time" aria-label="Время окончания события" value="${escapeAttr(item.endTime || '')}" data-field="endTime">
        <input type="text" aria-label="Событие и место" placeholder="Например, музей или прогулка по набережной" value="${escapeAttr(item.title || '')}" data-field="title">
        <div class="ticket-cell ${item.ticket ? 'has-ticket' : ''}">
          <input class="ticket-file-input" type="file" accept=".pdf,image/*" aria-label="Выбрать файл билета" tabindex="-1">
          <button class="ticket-pick" type="button" title="${item.ticket ? 'Заменить билет' : 'Прикрепить билет'}" aria-label="${item.ticket ? 'Заменить билет' : 'Прикрепить билет'}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 12.5 7.1-7.1a3.5 3.5 0 0 1 5 5L10 20.5a5 5 0 0 1-7.1-7.1L13 3.3"/></svg><span>${item.ticket ? '' : 'Прикрепить'}</span></button>
          ${item.ticket ? `<button class="ticket-download" type="button" title="Скачать: ${escapeAttr(item.ticket.name)}">${escapeAttr(item.ticket.name)}</button><button class="ticket-remove" type="button" aria-label="Удалить билет" title="Удалить билет">×</button>` : ''}
        </div>
        <button type="button" class="delete-note" aria-label="Удалить событие" title="Удалить">×</button>
      </div>`).join('');
    $('#emptyNotes').hidden = items.length > 0;
    $('#eventCount').textContent = items.length ? `${items.length} ${plural(items.length, 'событие', 'события', 'событий')}` : '';
    $('#notesRows').querySelectorAll('.note-row').forEach((row) => {
      const rowDate = selected;
      const rowIndex = Number(row.dataset.index);
      row.querySelectorAll('input').forEach((input) => input.addEventListener('input', () => {
        const current = notes[rowDate] || [];
        current[rowIndex][input.dataset.field] = input.value;
        notes[rowDate] = current;
        persistNotes();
        $('#eventCount').textContent = `${current.length} ${plural(current.length, 'событие', 'события', 'событий')}`;
      }));
      row.querySelector('.delete-note').addEventListener('click', () => {
        const [removed] = notes[rowDate].splice(rowIndex, 1);
        removeTicketFile(removed?.ticket?.id).catch(() => {});
        persistNotes();
        renderNotes();
      });
      const fileInput = row.querySelector('.ticket-file-input');
      row.querySelector('.ticket-pick').addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', async () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        const note = (notes[rowDate] || [])[rowIndex];
        if (!note) return;
        const attachmentId = createTicketId();
        try {
          await saveTicketFile(attachmentId, file);
          if (!(notes[rowDate] || []).includes(note)) {
            await removeTicketFile(attachmentId);
            return;
          }
          const oldId = note.ticket?.id;
          note.ticket = { id: attachmentId, name: file.name, type: file.type, size: file.size };
          persistNotes();
          if (oldId) removeTicketFile(oldId).catch(() => {});
          renderNotes();
        } catch (error) {
          alert(error.message || 'Не удалось прикрепить билет.');
          fileInput.value = '';
        }
      });
      row.querySelector('.ticket-download')?.addEventListener('click', async () => {
        const attachment = notes[rowDate]?.[rowIndex]?.ticket;
        if (!attachment) return;
        try {
          const stored = await getTicketFile(attachment.id);
          if (!stored?.file) throw new Error('Файл билета не найден. Прикрепите его ещё раз.');
          const objectUrl = URL.createObjectURL(stored.file);
          const link = document.createElement('a');
          link.href = objectUrl;
          link.download = stored.name || attachment.name;
          link.click();
          setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
        } catch (error) {
          alert(error.message || 'Не удалось скачать билет.');
        }
      });
      row.querySelector('.ticket-remove')?.addEventListener('click', async () => {
        const note = notes[rowDate]?.[rowIndex];
        if (!note?.ticket) return;
        await removeTicketFile(note.ticket.id).catch(() => {});
        delete note.ticket;
        persistNotes();
        renderNotes();
      });
    });
  }

  function renderSavedContent() {
    const events = tripEvents.filter(event => event.date === selected ||
      (event.endDate && event.date < selected && event.endDate >= selected))
      .sort((a,b) => (a.date+'T'+a.startTime).localeCompare(b.date+'T'+b.startTime));
    const eventHtml = events.map(event => {
      const point = tripPoints.find(p => p.id === event.pointId);
      return `<li><strong>${escapeAttr(event.startTime || '')} — ${escapeAttr(event.title)}</strong>${point ? ` · ${escapeAttr(point.name)}` : ''}${event.description ? `<p>${escapeAttr(event.description)}</p>` : ''}</li>`;
    }).join('');
    $('#savedTripContent').innerHTML = tripId ?
      `<details open><summary>События поездки на выбранный день (${events.length})</summary>${eventHtml ? `<ul>${eventHtml}</ul>` : '<p>На этот день сохранённых событий нет.</p>'}</details>
       <details><summary>Точки маршрута (${tripPoints.length})</summary><ul>${tripPoints.map(point => `<li>${escapeAttr(point.name)}</li>`).join('')}</ul></details>` : '';
  }

  function escapeAttr(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  $('#resetDatesBtn').addEventListener('click', () => saveRange('', ''));
  $('#prevMonth').addEventListener('click', () => { view = new Date(view.getFullYear(), view.getMonth() - 1, 1); renderCalendar(); });
  $('#nextMonth').addEventListener('click', () => { view = new Date(view.getFullYear(), view.getMonth() + 1, 1); renderCalendar(); });
  function changeCalendarMonth() {
    view = new Date(Number($('#yearSelect').value), Number($('#monthSelect').value), 1);
    renderCalendar();
  }
  $('#monthSelect').addEventListener('change', changeCalendarMonth);
  $('#yearSelect').addEventListener('change', changeCalendarMonth);

  $('#addEventBtn').addEventListener('click', () => {
    notes[selected] = [...(notes[selected] || []), { startTime: '', endTime: '', title: '' }];
    persistNotes();
    renderNotes();
    $('#notesRows .note-row:last-child input[type="time"]').focus();
  });

  async function init() {
    if (tripId) {
      const response = await fetch('/api/trips');
      if (!response.ok) throw Error('Не удалось загрузить путешествие.');
      const trips = await response.json();
      const trip = trips.find(item => item.id === tripId);
      if (!trip) {
        $('.intro-copy').textContent = 'Путешествие не найдено. Возвращаемся на главную…';
        $('#addEventBtn').disabled = true;
        sessionStorage.setItem('trip-navigation-message','Путешествие не найдено');
        setTimeout(() => location.replace('/'), 1500);
        return;
      }
      [tripPoints, tripEvents] = await Promise.all(['points','events'].map(async resource => {
        const result = await fetch('/api/'+resource+'?'+new URLSearchParams({tripId}));
        if(!result.ok) throw Error('Не удалось загрузить содержимое поездки. Попробуйте обновить страницу.');
        return result.json();
      }));
      $('.intro h1').textContent = trip.title;
      document.title = `${trip.title} — календарь`;
      rangeStart = trip.startDate || '';
      rangeEnd = trip.endDate || '';
      savedStart = rangeStart; savedEnd = rangeEnd;
      document.querySelectorAll('.map-link,.map-action').forEach(link => {
        if (link.getAttribute('href') === '/trip') link.href = '/trip?' + new URLSearchParams({trip:tripId});
      });
      const m = Number(params.get('month')), y = Number(params.get('year'));
      const start = trip.startDate ? parseDate(trip.startDate) : today;
      const month = Number.isInteger(m) && m >= 1 && m <= 12 ? m : (trip.month || start.getMonth()+1);
      const year = Number.isInteger(y) && y >= 1900 && y <= 2100 ? y : (trip.year || start.getFullYear());
      view = trip.startDate ? new Date(start.getFullYear(), start.getMonth(), 1) : new Date(year, month - 1, 1);
      if (!localStorage.getItem(storageKey('travelhub-selected-day'))) selected = dateKey(view);
    } else {
      const selectedDate = parseDate(selected);
      view = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
    }
    renderCalendar();
    renderNotes();
  }
  init().catch(error => {
    $('.intro-copy').textContent = error.message;
    $('#addEventBtn').disabled = true;
  });
})();
