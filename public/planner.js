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

  const yearOptions = [];
  for (let year = 1900; year <= 2100; year += 1) yearOptions.push(`<option value="${year}">${year}</option>`);
  $('#yearSelect').innerHTML = yearOptions.join('');

  function saveRange() {
    localStorage.setItem(storageKey('travelhub-trip-start'), JSON.stringify(rangeStart));
    localStorage.setItem(storageKey('travelhub-trip-end'), JSON.stringify(rangeEnd));
  }

  function renderCalendar() {
    $('#calendarTitle').textContent = `${headingMonths[view.getMonth()]} ${view.getFullYear()}`;
    $('#monthSelect').value = String(view.getMonth());
    $('#yearSelect').value = String(view.getFullYear());
    $('#tripStartInput').value = rangeStart;
    $('#tripEndInput').value = rangeEnd;
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
      cells.push(`<button type="button" class="${classes.join(' ')}" role="gridcell" aria-label="${day.getDate()} ${monthNames[day.getMonth()]} ${day.getFullYear()}" aria-pressed="${key === selected}" data-day="${key}">${day.getDate()}</button>`);
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
    selected = key;
    localStorage.setItem(storageKey('travelhub-selected-day'), JSON.stringify(selected));
    const date = parseDate(key);
    if (date.getMonth() !== view.getMonth() || date.getFullYear() !== view.getFullYear()) {
      view = new Date(date.getFullYear(), date.getMonth(), 1);
    }
    renderCalendar();
    renderNotes();
  }

  function updateTripRange() {
    rangeStart = $('#tripStartInput').value;
    rangeEnd = $('#tripEndInput').value;
    if (rangeStart && rangeEnd && rangeEnd < rangeStart) {
      [rangeStart, rangeEnd] = [rangeEnd, rangeStart];
    }
    saveRange();
    renderCalendar();
  }

  function renderNotes() {
    const date = parseDate(selected);
    $('#selectedDateLabel').textContent = `${date.getDate()} ${monthNames[date.getMonth()]} ${date.getFullYear()}`;
    $('#notesTitle').textContent = 'Заметки на день';
    const items = notes[selected] || [];
    $('#notesRows').innerHTML = items.map((item, index) => `
      <div class="note-row" data-index="${index}">
        <input type="time" aria-label="Время начала события" value="${escapeAttr(item.startTime || item.time || '')}" data-field="startTime">
        <input type="time" aria-label="Время окончания события" value="${escapeAttr(item.endTime || '')}" data-field="endTime">
        <input type="text" aria-label="Событие и место" placeholder="Например, музей или прогулка по набережной" value="${escapeAttr(item.title || '')}" data-field="title">
        <button type="button" class="delete-note" aria-label="Удалить событие" title="Удалить">×</button>
      </div>`).join('');
    $('#emptyNotes').hidden = items.length > 0;
    $('#eventCount').textContent = items.length ? `${items.length} ${plural(items.length, 'событие', 'события', 'событий')}` : '';
    $('#notesRows').querySelectorAll('.note-row').forEach((row) => {
      row.querySelectorAll('input').forEach((input) => input.addEventListener('input', () => {
        const current = notes[selected] || [];
        current[Number(row.dataset.index)][input.dataset.field] = input.value;
        notes[selected] = current;
        localStorage.setItem(storageKey('travelhub-day-notes'), JSON.stringify(notes));
        $('#eventCount').textContent = `${current.length} ${plural(current.length, 'событие', 'события', 'событий')}`;
      }));
      row.querySelector('.delete-note').addEventListener('click', () => {
        notes[selected].splice(Number(row.dataset.index), 1);
        localStorage.setItem(storageKey('travelhub-day-notes'), JSON.stringify(notes));
        renderNotes();
      });
    });
  }

  function escapeAttr(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  $('#prevMonth').addEventListener('click', () => { view = new Date(view.getFullYear(), view.getMonth() - 1, 1); renderCalendar(); });
  $('#nextMonth').addEventListener('click', () => { view = new Date(view.getFullYear(), view.getMonth() + 1, 1); renderCalendar(); });
  function changeCalendarMonth() {
    view = new Date(Number($('#yearSelect').value), Number($('#monthSelect').value), 1);
    renderCalendar();
  }
  $('#monthSelect').addEventListener('change', changeCalendarMonth);
  $('#yearSelect').addEventListener('change', changeCalendarMonth);
  $('#tripStartInput').addEventListener('change', updateTripRange);
  $('#tripEndInput').addEventListener('change', updateTripRange);
  $('#todayBtn').addEventListener('click', () => { view = new Date(today.getFullYear(), today.getMonth(), 1); chooseDay(dateKey(today)); });
  $('#addEventBtn').addEventListener('click', () => {
    notes[selected] = [...(notes[selected] || []), { startTime: '', endTime: '', title: '' }];
    localStorage.setItem(storageKey('travelhub-day-notes'), JSON.stringify(notes));
    renderNotes();
    $('#notesRows .note-row:last-child input[type="time"]').focus();
  });

  async function init() {
    if (tripId) {
      const response = await fetch('/api/trips');
      if (!response.ok) throw Error('Не удалось загрузить путешествие.');
      const trips = await response.json();
      const trip = trips.find(item => item.id === tripId);
      if (!trip) throw Error('Путешествие не найдено. Вернитесь на главную.');
      $('.intro h1').textContent = trip.title;
      document.title = `${trip.title} — календарь`;
      rangeStart = rangeStart || trip.startDate;
      rangeEnd = rangeEnd || trip.endDate;
      document.querySelectorAll('.map-link,.map-action').forEach(link => {
        if (link.getAttribute('href') === '/trip') link.href = '/trip?' + new URLSearchParams({trip:tripId});
      });
      const m = Number(params.get('month')), y = Number(params.get('year'));
      const month = Number.isInteger(m) && m >= 1 && m <= 12 ? m : trip.month;
      const year = Number.isInteger(y) && y >= 1900 && y <= 2100 ? y : trip.year;
      view = new Date(year, month - 1, 1);
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
