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
  let selected = load('travelhub-selected-day', tripId ? '' : dateKey(today));
  let rangeStart = load('travelhub-trip-start', '');
  let rangeEnd = load('travelhub-trip-end', '');
  let notes = load('travelhub-day-notes', {});
  let tripEvents = [], tripPoints = [], tripTransfers = [], tripCity = null;
  let addingPlan=false, plannerReady=false, singleDayMode=false;
  let ticketDbPromise;
  const draftKey=storageKey('travelhub-day-notes');
  const committedKey=storageKey('travelhub-day-notes-committed');
  let committed=load('travelhub-day-notes-committed',null);
  let dirty=committed===null?Object.values(notes).some(rows=>rows.length):JSON.stringify(notes)!==JSON.stringify(committed);
  let savingNotes=false;
  let leavingPlanner=false;
  window.addEventListener('pageshow',()=>{leavingPlanner=false;});
  window.addEventListener('beforeunload',event=>{if(dirty&&!leavingPlanner){event.preventDefault();event.returnValue='';}});
  function prepareInternalNavigation(){
    try{
      localStorage.setItem(draftKey,JSON.stringify(notes));
      localStorage.setItem(storageKey('glider-plan-text'),$('#plansText').value);
    }catch{
      if((dirty||$('#plansText').value.trim())&&!confirm('Не удалось сохранить черновик на устройстве. Выйти без сохранения изменений?'))return false;
    }
    leavingPlanner=true;
    return true;
  }
  function navigateInternal(url){if(prepareInternalNavigation())location.assign(url);}
  document.addEventListener('click',event=>{
    const link=event.target.closest('a[href]');
    if(!link||event.defaultPrevented||event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey||link.hasAttribute('download')||(link.target&&link.target!=='_self'))return;
    const url=new URL(link.href,location.href);
    if(url.origin!==location.origin||!['/','/trip','/planner','/map.html','/index.html','/planner.html','/home.html'].includes(url.pathname)||link.getAttribute('href').startsWith('#'))return;
    if(url.pathname===location.pathname&&url.search===location.search&&url.hash)return;
    if(!prepareInternalNavigation())event.preventDefault();
  });

  const yearOptions = [];
  for (let year = 1900; year <= 2100; year += 1) yearOptions.push(`<option value="${year}">${year}</option>`);
  $('#yearSelect').innerHTML = yearOptions.join('');

  let rangePending = false;
  let rangeSelecting = !(rangeStart && rangeEnd);
  let savedStart = rangeStart, savedEnd = rangeEnd;
  let saving = false, saveError = '';
  async function saveRange(start, end) {
    if (saving || savingNotes || addingPlan) return;
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
      rangePending = false; saving = false;
      if(!saveError)rangeSelecting=!(savedStart&&savedEnd);
      renderCalendar();renderNotes();
      if (saveError && !savedStart && !savedEnd) rangeSelecting = true;
    }
  }

  function renderCalendar() {
    $('#calendarTitle').textContent = `${headingMonths[view.getMonth()]} ${view.getFullYear()}`;
    $('#monthSelect').value = String(view.getMonth());
    $('#yearSelect').value = String(view.getFullYear());
    const count = rangeStart && rangeEnd ? Math.round((parseDate(rangeEnd)-parseDate(rangeStart))/86400000)+1 : 0;
    const formatDay = key => parseDate(key).toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric'});
    const rangeComplete = rangeStart && rangeEnd && rangeEnd >= rangeStart;
    $('#rangeHint').textContent = saveError || (saving ? 'Сохраняем даты…' : rangePending ? 'Выберите дату окончания или нажмите на ту же дату ещё раз для однодневной поездки' : rangeComplete ? `${rangeStart===savedStart&&rangeEnd===savedEnd?'Поездка':'Выбрано'}: ${formatDay(rangeStart)}${rangeStart === rangeEnd ? '' : ' — ' + formatDay(rangeEnd)} (${count} ${plural(count,'день','дня','дней')})` : 'Даты поездки не выбраны');
    $('#rangePrompt').hidden = !!rangeComplete;
    $('#rangePromptMessage').textContent = rangePending ? 'Начало выбрано. Теперь укажите дату окончания.' : 'Нажмите дату начала, затем дату окончания поездки.';
    $('#startRangeBtn').textContent = rangePending ? 'Выбрать окончание' : 'Выбрать диапазон';
    const busy=saving||savingNotes||addingPlan;
    for(const id of ['rangeModeBtn','singleModeBtn','startRangeBtn','resetDatesBtn'])$('#'+id).disabled=busy;
    $('#confirmDatesBtn').disabled=busy||!rangeComplete||(rangeStart===savedStart&&rangeEnd===savedEnd);
    $('#openSelectedDayBtn').disabled=busy||(!selected&&!savedStart);
    $('#parsePlansBtn').disabled=!plannerReady||busy||!savedStart||!savedEnd;
    $('#clearDatesBtn').disabled=busy||!savedStart;
    $('#rangeModeBtn').setAttribute('aria-pressed',String(!singleDayMode));$('#singleModeBtn').setAttribute('aria-pressed',String(singleDayMode));
    $('#resetDatesBtn').disabled = busy || (!savedStart && !rangeStart);
    let progress = document.querySelector('#journalProgress');
    if (!progress) {progress=document.createElement('div');progress.id='journalProgress';progress.className='journal-progress';document.querySelector('.calendar-card').append(progress);}
    const total = savedStart && savedEnd ? Math.round((parseDate(savedEnd)-parseDate(savedStart))/86400000)+1 : 0;
    let filled=0;
    for(let i=0;i<total;i++) {const date=parseDate(savedStart);date.setDate(date.getDate()+i);const key=dateKey(date);if(tripEvents.some(e=>e.date<=key && (e.endDate || e.date)>=key)) filled++;}
    progress.innerHTML = total>0 ? `<span class="journal-progress-track" style="--progress:${filled/total*100}%">${GliderIcons.icon('glider')}</span><span>Дни с сохранёнными событиями: ${filled} из ${total}</span>` : '';

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
      if(inside&&(rangeStart!==savedStart||rangeEnd!==savedEnd))classes.push('range-preview');
      if (planRecords().some(row => row.date <= key && (row.note.endDate || row.date) >= key)) classes.push('has-plans');
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
    renderOverview();
  }

  function plural(number, one, few, many) {
    const mod100 = number % 100;
    if (mod100 >= 11 && mod100 <= 14) return many;
    const mod10 = number % 10;
    return mod10 === 1 ? one : mod10 >= 2 && mod10 <= 4 ? few : many;
  }

  function chooseDay(key) {
    if (saving || savingNotes || addingPlan) return;
    saveError = '';
    if (rangeSelecting) {
      if (rangePending && !singleDayMode) {
        rangeEnd = key;
        if (rangeEnd < rangeStart) [rangeStart, rangeEnd] = [rangeEnd, rangeStart];
        rangePending = false;
        // Keep the candidate range local until explicit confirmation.
      } else {
        rangeStart = key; rangeEnd = singleDayMode?key:''; rangePending = !singleDayMode;
      }
    }
    selected = key;
    try{localStorage.setItem(storageKey('travelhub-selected-day'), JSON.stringify(selected));}catch{}
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
    dirty=true;
    renderCalendar();
    try {localStorage.setItem(draftKey, JSON.stringify(notes));$('#daySaveStatus').textContent='Есть несохранённые изменения. Черновик сохранён на устройстве.';}catch{$('#daySaveStatus').textContent='Не удалось сохранить черновик на устройстве. Сохраните события перед выходом.';}
  }

  function createTicketId() {
    const unique = window.crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return `${tripId || 'default'}:${unique}`;
  }

  function renderNotes() {
    renderSavedContent();
    const rangeComplete = savedStart && savedEnd && savedEnd >= savedStart;
    $('#addEventBtn').disabled = !rangeComplete || !selected;
    $('#saveDayBtn').disabled = !rangeComplete || !selected;
    if (!rangeComplete || !selected) {
      $('#notesTitle').textContent = rangeComplete ? 'Выберите день поездки' : 'Сначала выберите диапазон';
      $('#selectedDateLabel').textContent = selected ? parseDate(selected).toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric'}) : '';
      $('#notesRows').innerHTML = '';
      $('#emptyNotes').hidden = false;
      $('#emptyNotes').querySelector('strong').textContent = rangeComplete ? 'Выберите день в календаре' : 'Отметьте начало и конец поездки';
      $('#emptyNotes').querySelector('span:not(.empty-icon)').textContent = rangeComplete ? 'Нажмите на день поездки, чтобы добавить заметки' : 'После этого можно будет добавлять события и заметки';
      $('#eventCount').textContent = '';
      return;
    }
    const date = parseDate(selected);
    $('#selectedDateLabel').textContent = `${date.getDate()} ${monthNames[date.getMonth()]} ${date.getFullYear()}`;
    $('#notesTitle').textContent = 'Заметки на день';
    $('#emptyNotes').querySelector('strong').textContent = 'Пока здесь пусто';
    $('#emptyNotes').querySelector('span:not(.empty-icon)').textContent = 'Добавьте время и место, которые хотите посетить';
    const items = notes[selected] || [];
    $('#notesRows').innerHTML = items.map((item, index) => `
      <div class="note-row" data-index="${index}">
        <input type="time" aria-label="Время начала события" value="${escapeAttr(item.startTime || item.time || '')}" data-field="startTime">
        <input type="time" aria-label="Время окончания события" value="${escapeAttr(item.endTime || '')}" data-field="endTime">
        <input type="text" aria-label="Событие и место" placeholder="Например, музей или прогулка по набережной" value="${escapeAttr(item.title || '')}" data-field="title">
        <details class="day-note-details"><summary>Описание и место</summary><label>Тип<select data-field="type">${Object.entries({excursion:'Экскурсия',stay:'Проживание',restaurant:'Ресторан',meeting:'Встреча',walking:'Прогулка',other:'Другое'}).map(([key,label])=>`<option value="${key}" ${(item.type||'other')===key?'selected':''}>${label}</option>`).join('')}</select></label><label>Описание<textarea data-field="description">${escapeAttr(item.description||'')}</textarea></label><label>Точка маршрута<select data-field="pointId"><option value="">${item.place ? escapeAttr(item.place.name)+' — найдено на карте' : 'Без точки'}</option>${tripPoints.map(p=>`<option value="${escapeAttr(p.id)}" ${item.pointId===p.id?'selected':''}>${escapeAttr(p.name)}</option>`).join('')}</select></label></details>
        <div class="ticket-cell ${item.ticket ? 'has-ticket' : ''}">
          <input class="ticket-file-input" type="file" accept=".pdf,image/jpeg,image/png" aria-label="Выбрать файл билета" tabindex="-1">
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
      row.querySelectorAll('[data-field]').forEach((input) => input.addEventListener('input', () => {
        const current = notes[rowDate] || [];
        current[rowIndex][input.dataset.field] = input.value;
        if(['startTime','endTime'].includes(input.dataset.field))current[rowIndex].schedule={...current[rowIndex].schedule,timeExplicit:true};
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
        if(!['application/pdf','image/jpeg','image/png'].includes(file.type)||file.size>10*1024*1024){alert('Выберите билет PDF, JPG или PNG размером до 10 МБ.');fileInput.value='';return;}
        const attachmentId = createTicketId();
        try {
          if (['image/jpeg', 'image/png'].includes(file.type)) {
            try {
            const formData = new FormData();
            formData.append('photos', file);
            const response = await fetch('/api/uploads', { method: 'POST', body: formData });
            const uploaded = await response.json();
            if (!response.ok) throw new Error(uploaded.error || 'Не удалось загрузить изображение билета.');
            if (!(notes[rowDate] || []).includes(note)) return;
            const oldId = note.ticket?.id;
            note.ticket = { url: uploaded[0].url, name: file.name, type: file.type, size: file.size };
            persistNotes();
            if (oldId) removeTicketFile(oldId).catch(() => {});
            renderNotes();
            return;
            } catch { /* Keep a local draft when the upload is unavailable; retry on Save. */ }
          }
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
          if(attachment.url){window.open(attachment.url,'_blank','noopener');return;}
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
    window.GliderNavigation?.update(selected||savedStart);
    if(tripId) document.querySelectorAll('a.map-link,a.map-action').forEach(link=>{
      if(new URL(link.href,location.href).pathname==='/trip') link.href='/trip?'+new URLSearchParams({trip:tripId,date:selected});
    });
    const events = planRecords().map(row=>({...row.note,date:row.date,id:row.note.id||'draft:'+row.note.dayNoteId})).filter(event => event.date === selected ||
      (event.endDate && event.date < selected && event.endDate >= selected))
      .sort((a,b) => (a.date+'T'+a.startTime).localeCompare(b.date+'T'+b.startTime));
    const eventHtml = events.map(event => {
      const point = tripPoints.find(p => p.id === event.pointId);
      return `<li><a href="/trip?${new URLSearchParams({trip:tripId,date:selected,event:event.id})}">${GliderIcons.icon(event.type || "other")} <strong>${escapeAttr(event.startTime || '')} — ${escapeAttr(event.title)}</strong></a>${point ? ` · ${escapeAttr(point.name)}` : ''}${event.description ? `<p>${escapeAttr(event.description)}</p>` : ''}</li>`;
    }).join('');
    $('#savedTripContent').innerHTML = tripId ?
      `<details open><summary>Планы на выбранный день (${events.length})</summary>${eventHtml ? `<ul>${eventHtml}</ul>` : '<p>На этот день сохранённых событий нет.</p>'}</details>
       <details><summary>Сохранённые точки маршрута (${tripPoints.length})</summary><ul>${tripPoints.map(point => `<li>${escapeAttr(point.name)}</li>`).join('')}</ul></details>` : '';
  }

  function escapeAttr(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  function noteRows() {
    return Object.entries(notes).flatMap(([date,rows])=>rows.map(note=>({date,note,key:'note:'+(note.dayNoteId ||= createTicketId())})));
  }
  function planRecords() {
    const rows=noteRows(), imported=new Set(rows.map(row=>row.note.originalEventId).filter(Boolean));
    return [...tripEvents.filter(event=>event.source!=='day-notes'&&!imported.has(event.id)).map(event=>({date:event.date,note:event,key:'event:'+event.id})),...rows];
  }
  function occupiedExcept(keys=[]) {
    return [...planRecords().filter(row=>!keys.includes(row.key)).map(row=>({...row.note,date:row.date})),...tripTransfers];
  }
  function selectPlanDay(key) {
    selected=key;const day=parseDate(key);view=new Date(day.getFullYear(),day.getMonth(),1);
    try{localStorage.setItem(storageKey('travelhub-selected-day'),JSON.stringify(selected));}catch{}
    renderCalendar();renderNotes();
  }
  const placeCacheKey=storageKey('glider-place-search-v1');
  let placeCache={};try{placeCache=JSON.parse(localStorage.getItem(placeCacheKey))||{};}catch{}
  const placePending=new Map();
  const validPlace=place=>place&&typeof place.name==='string'&&Number.isFinite(place.lat)&&Number.isFinite(place.lng)&&Math.abs(place.lat)<=90&&Math.abs(place.lng)<=180;
  async function findPlaces(query,refresh=false){
    if(!query)return {place:null,candidates:[],status:'not_found'};
    const key=JSON.stringify([query.trim().toLocaleLowerCase('ru'),tripCity]);
    const cached=placeCache[key];
    if(!refresh&&cached&&Date.now()-cached.at<(cached.result?.status==='not_found'?60000:86400000)&&Array.isArray(cached.result?.candidates))return cached.result;
    if(placePending.has(key))return placePending.get(key);
    const request=(async()=>{
      // Submit-driven debounce: typing does not send plans to an external service.
      await new Promise(resolve=>setTimeout(resolve,500));
      try{
        const response=await fetch('/api/trips/'+encodeURIComponent(tripId)+'/places',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query,refresh}),signal:AbortSignal.timeout(18000)});
        if(!response.ok)throw Error('Place search unavailable');
        const result=await response.json();
        result.candidates=Array.isArray(result.candidates)?result.candidates.filter(validPlace).slice(0,6):[];
        if(!validPlace(result.place))result.place=null;
        if(result.cacheable&&(result.candidates.length||result.status==='not_found')){
          placeCache[key]={at:Date.now(),result};
          placeCache=Object.fromEntries(Object.entries(placeCache).sort((a,b)=>b[1].at-a[1].at).slice(0,80));
          try{localStorage.setItem(placeCacheKey,JSON.stringify(placeCache));}catch{}
        }
        return result;
      }catch{return {place:null,candidates:[],status:'unavailable'};}
    })();
    placePending.set(key,request);
    try{return await request;}finally{placePending.delete(key);}
  }
  function placeCaption(place){
    if(!place)return '';
    const city=place.city||'';
    const distance=Number.isFinite(place.distanceKm)&&place.inCity!==true&&(!city||city!==tripCity?.name)?` · ${Math.round(place.distanceKm)} км от центра поездки`:'';
    return (place.name===city?place.name:[place.name,city].filter(Boolean).join(' — '))+distance;
  }
  function placeControls(row){
    const note=row.note,place=note.place||tripPoints.find(point=>point.id===note.pointId),candidates=(note.placeCandidates||[]).filter(validPlace);
    const label=place?`<p class="plan-place">${GliderIcons.icon('pin')} ${escapeAttr(placeCaption(place))}</p>`:`<small class="place-missing">${candidates.length?'Выберите место из вариантов':note.placeSearchStatus==='unavailable'?'Поиск недоступен — план сохранён без места':note.placeSearchStatus==='skipped'?'Место не указано':'Место не найдено'}</small>`;
    const choices=candidates.length?`<details class="place-choices" ${place?'':'open'}><summary>${place?'Изменить место':'Варианты места'}</summary>${candidates.map((candidate,index)=>`<button type="button" class="place-choice ${candidate.inCity?'recommended':''}" data-select-place="${escapeAttr(row.key)}" data-candidate="${index}" ${savingNotes||addingPlan?'disabled':''}><strong>${escapeAttr(placeCaption(candidate))}</strong>${candidate.inCity?'<small>Рекомендуется · город поездки</small>':''}<span>${escapeAttr(candidate.address||candidate.type||'')}</span></button>`).join('')}<button type="button" class="place-skip" data-skip-place="${escapeAttr(row.key)}" ${savingNotes||addingPlan?'disabled':''}>Оставить без места</button></details>`:'';
    return label+choices+(!place&&!candidates.length?`<button type="button" class="place-retry" data-retry-place="${escapeAttr(row.key)}" ${savingNotes||addingPlan?'disabled':''}>Найти место ещё раз</button>`:'');
  }
  function editablePlan(key){
    const row=planRecords().find(row=>row.key===key);if(!row)return null;
    if(key.startsWith('event:')){
      const note={...row.note,originalEventId:row.note.id,dayNoteId:createTicketId()};
      (notes[row.date]||=[]).push(note);return note;
    }
    return row.note;
  }
  function selectPlace(key,index){
    if(savingNotes||addingPlan)return;
    const row=planRecords().find(row=>row.key===key),candidate=index===null?null:row?.note.placeCandidates?.[index];
    if(!row||(index!==null&&!validPlace(candidate)))return;
    const note=editablePlan(key);note.place=candidate;note.pointId=null;
    note.placeSearchStatus=candidate?'matched':'skipped';if(!candidate)note.placeCandidates=[];
    persistNotes();renderNotes();
    $('#scheduleStatus').textContent=candidate?'Место выбрано: '+placeCaption(candidate):'План оставлен без места.';
  }
  function renderOverview() {
    const container=$('#tripOverview');if(!container)return;
    const days=PlanSchedule.days(savedStart,savedEnd);
    $('#redistributeBtn').disabled=savingNotes||addingPlan||!days.length;
    if(!days.length){container.innerHTML='<p class="overview-empty">Подтвердите даты поездки — здесь появятся все её дни и свободные слоты.</p>';return;}
    const records=planRecords();
    const outside=[...new Set(records.flatMap(r=>[r.date,r.note.endDate||r.date]).filter(d=>PlanSchedule.validDate(d)&&!days.includes(d)))].sort();
    container.innerHTML=[...days,...outside].map(date=>{
      const number=days.indexOf(date)+1;
      const entries=records.filter(r=>r.date<=date&&(r.note.endDate||r.date)>=date).sort((a,b)=>(a.note.startTime||'').localeCompare(b.note.startTime||''));
      const free=PlanSchedule.SLOTS.filter(startTime=>PlanSchedule.available({date,startTime},occupiedExcept()));
      const options=days.map(d=>`<option value="${d}" ${d===date?'selected':''}>${escapeAttr(parseDate(d).toLocaleDateString('ru-RU',{day:'numeric',month:'long'}))}</option>`).join('');
      return `<article class="overview-day ${selected===date?'is-selected':''} ${number?'':'outside-trip'}" data-drop-day="${date}"><h3><button type="button" data-open-plan-day="${date}">${number?'День '+number:'Вне диапазона'} · ${escapeAttr(parseDate(date).toLocaleDateString('ru-RU',{day:'numeric',month:'long'}))}</button></h3>${entries.length?entries.map(row=>{
        const note=row.note;
        return `<div class="overview-plan" draggable="${!savingNotes&&!addingPlan}" data-plan-key="${escapeAttr(row.key)}"><div class="overview-plan-copy">${GliderIcons.icon(note.type||'other')}<time>${escapeAttr(note.startTime||'Время не указано')}</time><strong>${escapeAttr(note.title)}</strong></div>${placeControls(row)}${row.key.startsWith('note:')?'<small class="draft-label">План календаря</small>':''}<div class="plan-move"><label>Перенести на<select aria-label="Новый день для ${escapeAttr(note.title)}">${options}</select></label><button class="today-button" type="button" data-move-plan="${escapeAttr(row.key)}" ${savingNotes||addingPlan?'disabled':''}>Перенести</button></div></div>`;
      }).join(''):`<p class="free-slot">${free.length?'Свободно':'Занято перемещениями'} <span>${free.join(' · ')}</span></p>`}</article>`;
    }).join('');
    container.querySelectorAll('[data-select-place]').forEach(button=>button.onclick=()=>selectPlace(button.dataset.selectPlace,Number(button.dataset.candidate)));
    container.querySelectorAll('[data-skip-place]').forEach(button=>button.onclick=()=>selectPlace(button.dataset.skipPlace,null));
    container.querySelectorAll('[data-retry-place]').forEach(button=>button.onclick=async()=>{
      if(savingNotes||addingPlan)return;
      const row=planRecords().find(row=>row.key===button.dataset.retryPlace);if(!row)return;
      const note=editablePlan(row.key);addingPlan=true;persistNotes();renderCalendar();
      try{const result=await findPlaces(note.placeName||note.title,true);note.place=result.place;note.placeCandidates=result.candidates;note.placeSearchStatus=result.status;note.pointId=null;persistNotes();}
      finally{addingPlan=false;renderNotes();renderCalendar();}
    });
    container.querySelectorAll('[data-open-plan-day]').forEach(button=>button.onclick=()=>selectPlanDay(button.dataset.openPlanDay));
    container.querySelectorAll('[data-move-plan]').forEach(button=>button.onclick=()=>movePlan(button.dataset.movePlan,button.closest('.overview-plan').querySelector('select').value));
    container.querySelectorAll('[draggable=true]').forEach(card=>card.addEventListener('dragstart',event=>{event.dataTransfer.setData('application/x-glider-plan',card.dataset.planKey);event.dataTransfer.effectAllowed='move';}));
    document.querySelectorAll('[data-drop-day],#calendarGrid [data-day]').forEach(day=>{
      day.addEventListener('dragover',event=>{if(event.dataTransfer.types.includes('application/x-glider-plan'))event.preventDefault();});
      day.addEventListener('drop',event=>{event.preventDefault();event.stopPropagation();const key=event.dataTransfer.getData('application/x-glider-plan');if(key)movePlan(key,day.dataset.dropDay||day.dataset.day);});
    });
  }
  function movePlan(key,date) {
    if(savingNotes||addingPlan)return;
    try {
      const row=planRecords().find(r=>r.key===key);if(!row)return;
      let moved;
      try {moved=PlanSchedule.place({...row.note,date:row.date},savedStart,savedEnd,occupiedExcept([key]),{date,time:row.note.startTime||null});}
      catch {moved=PlanSchedule.place({...row.note,date:row.date},savedStart,savedEnd,occupiedExcept([key]),{date});}
      if(key.startsWith('note:'))notes[row.date]=notes[row.date].filter(note=>note!==row.note);
      else {moved.originalEventId=row.note.id;moved.dayNoteId=createTicketId();}
      moved.schedule={...row.note.schedule,dateExplicit:true,timeExplicit:!!row.note.schedule?.timeExplicit&&moved.startTime===row.note.startTime};
      (notes[date]||=[]).push(moved);selected=date;persistNotes();selectPlanDay(date);
      $('#scheduleStatus').textContent=`План перенесён: ${parseDate(date).toLocaleDateString('ru-RU',{day:'numeric',month:'long'})}, ${moved.startTime} — ${moved.title}`;
    }catch(error){$('#scheduleStatus').textContent=error.message;}
  }
  $('#redistributeBtn').addEventListener('click',()=>{
    if(savingNotes||addingPlan)return;
    try {
      const automatic=noteRows().filter(r=>r.note.schedule?.automatic).sort((a,b)=>(Number(!!b.note.schedule.dateExplicit)+Number(!!b.note.schedule.timeExplicit))-(Number(!!a.note.schedule.dateExplicit)+Number(!!a.note.schedule.timeExplicit)));
      const assigned=PlanSchedule.allocate(automatic.map(r=>({...r.note,date:r.date,dateExplicit:r.note.schedule.dateExplicit,timeExplicit:r.note.schedule.timeExplicit})),savedStart,savedEnd,occupiedExcept(automatic.map(r=>r.key)));
      const old=new Set(automatic.map(r=>r.note));for(const date of Object.keys(notes))notes[date]=notes[date].filter(n=>!old.has(n));
      for(const item of assigned)(notes[item.date]||=[]).push(item);
      persistNotes();renderNotes();$('#scheduleStatus').textContent=assigned.length?'Расписание пересобрано. Указанные даты и время сохранены.':'Автоматически распределённых планов пока нет.';
    }catch(error){$('#scheduleStatus').textContent=error.message+' Прежнее расписание сохранено.';}
  });

  const planTextKey=storageKey('glider-plan-text');
  try {$('#plansText').value=localStorage.getItem(planTextKey)||'';}catch{}
  $('#plansText').addEventListener('input',()=>{try{localStorage.setItem(planTextKey,$('#plansText').value);}catch{$('#plansStatus').textContent='Не удалось сохранить текст на устройстве. Не закрывайте страницу до разбора.';}});
  $('#parsePlansBtn').addEventListener('click',async()=>{
    const text=$('#plansText').value.trim();
    if(addingPlan||savingNotes)return;
    if(!tripId||!text||!savedStart||!savedEnd){$('#plansStatus').textContent='Подтвердите даты поездки и напишите план.';return;}
    const button=$('#parsePlansBtn');addingPlan=true;button.disabled=true;button.textContent='Разбираем и распределяем…';button.setAttribute('aria-busy','true');$('#plansStatus').textContent='Определяем место и свободный слот…';
    try {
      const hint=PlanSchedule.hints(text,savedStart,savedEnd);let result,offline=false;
      try {
        const response=await fetch('/api/trips/'+encodeURIComponent(tripId)+'/parse-plans',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text,date:savedStart,searchPlaces:false}),signal:AbortSignal.timeout(35000)});
        result=await response.json();if(!response.ok)throw Error(result.error||'Не удалось разобрать планы');
      }catch(error){offline=true;result={items:[{title:text,placeName:text,date:hint.date||savedStart,startTime:hint.time||'',dateExplicit:hint.dateExplicit,timeExplicit:hint.timeExplicit,type:/кафе|ужин|ресторан/i.test(text)?'restaurant':/музей|кремль|парк/i.test(text)?'excursion':'other',description:text,place:null}]};}
      if(!offline)for(const item of result.items||[]){
        if(item.place===undefined&&!Array.isArray(item.placeCandidates)){const found=await findPlaces(item.placeName||item.title);item.place=found.place;item.placeCandidates=found.candidates;item.placeSearchStatus=found.status;}
      }
      const fresh=(result.items||[]).filter(item=>!noteRows().some(row=>row.note.planInput===text&&row.note.planTitle===item.title));
      const assigned=PlanSchedule.allocate(fresh,savedStart,savedEnd,occupiedExcept());
      for(const item of assigned){
        const note={...item,dayNoteId:createTicketId(),planInput:text,planTitle:item.title,schedule:{automatic:true,dateExplicit:item.dateExplicit===true,timeExplicit:item.timeExplicit===true},description:[item.description,item.placeName&&!item.place&&!item.placeCandidates?.length?'Место: '+item.placeName+' (место не найдено)':''].filter(Boolean).join('\n')};
        (notes[item.date]||=[]).push(note);
      }
      if(assigned[0]){selected=assigned[0].date;const day=parseDate(selected);view=new Date(day.getFullYear(),day.getMonth(),1);}
      persistNotes();renderNotes();
      $('#plansStatus').textContent=assigned.length?assigned.map(item=>`План распределён: ${parseDate(item.date).toLocaleDateString('ru-RU',{day:'numeric',month:'long'})}, ${item.startTime} — ${item.title}${!item.place?(item.placeCandidates?.length?' (выберите место из вариантов)':' (место не найдено)'):''}`).join('; ')+(offline?' Текст обработан локально.':''):'Этот план уже добавлен.';
      $('#plansText').value='';try{localStorage.setItem(planTextKey,'');}catch{}
    }catch(error){$('#plansStatus').textContent=error.message+' Текст плана сохранён — исправьте его или измените даты поездки.';}
    finally {addingPlan=false;button.textContent='Добавить план';button.setAttribute('aria-busy','false');renderCalendar();}
  });
  $('#plansText').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();$('#parsePlansBtn').click();}});

  $('#saveDayBtn').addEventListener('click',async()=>{
    if(savingNotes||addingPlan)return;
    if(!savedStart||!savedEnd){$('#daySaveStatus').textContent='Сначала выберите диапазон поездки в календаре.';return;}
    if(!tripId){$('#daySaveStatus').textContent='Откройте календарь конкретного путешествия с главной страницы.';return;}
    const events=[];
    for(const [date,rows] of Object.entries(notes))for(const note of rows){
      if(!note.title?.trim() || !(note.startTime||note.time)){$('#daySaveStatus').textContent='Заполните название и время начала всех событий, включая другие дни. Либо удалите пустые строки.';return;}
      note.dayNoteId=note.dayNoteId||createTicketId();
      events.push({dayNoteId:note.dayNoteId,title:note.title,type:note.type||'other',date,startTime:note.startTime||note.time,endTime:note.endTime||'',endDate:note.endDate||date,description:note.description||'',pointId:note.pointId||null,bookingUrl:note.bookingUrl||'',ticket:note.ticket||null,place:note.place||null,placeName:note.placeName||'',schedule:note.schedule||null,originalEventId:note.originalEventId||null});
    }
    persistNotes();savingNotes=true;$('#saveDayBtn').disabled=true;$('#saveDayBtn').textContent='Сохраняем…';
    const controls=[...$('#notesRows').querySelectorAll('input,textarea,select,button'),$('#addEventBtn')];controls.forEach(el=>el.disabled=true);
    try{
      // Local files remain recoverable on failure. Upload before committing event metadata.
      for(const entry of events){
        if(!entry.ticket || entry.ticket.url)continue;
        const stored=await getTicketFile(entry.ticket.id);
        if(!stored?.file)throw Error('Файл билета не найден. Прикрепите его заново.');
        const form=new FormData();form.append('attachments',stored.file,entry.ticket.name);
        const upload=await fetch('/api/uploads',{method:'POST',body:form,signal:AbortSignal.timeout(30000)});
        const result=await upload.json();if(!upload.ok)throw Error(result.error||'Не удалось загрузить билет');
        entry.ticket={...entry.ticket,...result[0]};
        const note=Object.values(notes).flat().find(note=>note.dayNoteId===entry.dayNoteId);
        if(note)note.ticket=entry.ticket;
        persistNotes();
      }
      const response=await fetch('/api/trips/'+encodeURIComponent(tripId)+'/day-events',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({events}),signal:AbortSignal.timeout(15000)});
      const result=await response.json();if(!response.ok)throw Error(result.error||(result.errors||[]).join(', ')||'Не удалось сохранить события');
      committed=JSON.parse(JSON.stringify(notes));
      try{localStorage.setItem(committedKey,JSON.stringify(committed));localStorage.setItem('glider-trips-updated',JSON.stringify({tripId,at:Date.now()}));}catch{}
      dirty=false;$('#daySaveStatus').textContent='Сохранено. Открываем карту…';
      location.href='/trip?'+new URLSearchParams({trip:tripId,date:selected});
    }catch(error){$('#daySaveStatus').textContent='Не удалось сохранить: '+error.message+'. Черновик остался на устройстве.';}
    finally{savingNotes=false;$('#saveDayBtn').disabled=false;$('#saveDayBtn').textContent='Сохранить и перейти к карте';controls.forEach(el=>el.disabled=false);}
  });


  $('#resetDatesBtn').addEventListener('click',()=>{rangeSelecting=true;rangePending=false;rangeStart='';rangeEnd='';renderCalendar();});
  $('#clearDatesBtn').addEventListener('click',()=>saveRange('',''));
  $('#confirmDatesBtn').addEventListener('click',()=>{if(rangeStart&&rangeEnd)saveRange(rangeStart,rangeEnd);});
  $('#openSelectedDayBtn').addEventListener('click',()=>{if(tripId&&(selected||savedStart))navigateInternal('/trip?'+new URLSearchParams({trip:tripId,date:selected||savedStart}));});
  $('#startRangeBtn').addEventListener('click',()=>{rangeSelecting=true;$('#calendarGrid').focus();});
  for(const [id,single] of [['rangeModeBtn',false],['singleModeBtn',true]])$("#"+id).addEventListener('click',()=>{singleDayMode=single;rangeSelecting=true;rangePending=false;rangeStart='';rangeEnd='';renderCalendar();});
  $('#prevMonth').addEventListener('click', () => { view = new Date(view.getFullYear(), view.getMonth() - 1, 1); renderCalendar(); });
  $('#nextMonth').addEventListener('click', () => { view = new Date(view.getFullYear(), view.getMonth() + 1, 1); renderCalendar(); });
  function changeCalendarMonth() {
    view = new Date(Number($('#yearSelect').value), Number($('#monthSelect').value), 1);
    renderCalendar();
  }
  $('#monthSelect').addEventListener('change', changeCalendarMonth);
  $('#yearSelect').addEventListener('change', changeCalendarMonth);

  $('#addEventBtn').addEventListener('click', () => {
    notes[selected] = [...(notes[selected] || []), {dayNoteId:createTicketId(),startTime:'',endTime:'',title:''}];
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
      [tripPoints, tripEvents, tripTransfers] = await Promise.all(['points','events','transfers'].map(async resource => {
        const result = await fetch('/api/'+resource+'?'+new URLSearchParams({tripId}));
        if(!result.ok) throw Error('Не удалось загрузить содержимое поездки. Попробуйте обновить страницу.');
        return result.json();
      }));
      tripCity=trip.city||{name:trip.destination||trip.title};
      const managed=tripEvents.filter(e=>e.source==='day-notes');
      // The map is allowed to edit or delete calendar-created events. When
      // there is no unsaved local draft, refresh the planner from the server
      // so a later calendar save cannot restore stale event values.
      if(!dirty){
        notes={};
        for(const event of managed){
          (notes[event.date]||=[]).push({
            ...event,
            startTime:event.startTime||'',
            endTime:event.endTime||'',
            dayNoteId:event.dayNoteId,
          });
        }
        for(const rows of Object.values(notes)) rows.sort((a,b)=>(a.startTime||'').localeCompare(b.startTime||''));
        committed=JSON.parse(JSON.stringify(notes));
        try{
          localStorage.setItem(draftKey,JSON.stringify(notes));
          localStorage.setItem(committedKey,JSON.stringify(committed));
        }catch{}
        dirty=false;
      }
      $('.intro h1').textContent = trip.title;
      document.title = `${trip.title} — календарь · Traveler's Glider`;
      rangeStart = trip.startDate || '';
      rangeEnd = trip.endDate || '';
      rangeSelecting = !(rangeStart && rangeEnd);
      savedStart = rangeStart; savedEnd = rangeEnd;
      document.querySelectorAll('.map-link,.map-action').forEach(link => {
        if (link.getAttribute('href') === '/trip') link.href = '/trip?' + new URLSearchParams({trip:tripId});
      });
      const m = Number(params.get('month')), y = Number(params.get('year'));
      const start = trip.startDate ? parseDate(trip.startDate) : today;
      const month = Number.isInteger(m) && m >= 1 && m <= 12 ? m : (trip.month || start.getMonth()+1);
      const year = Number.isInteger(y) && y >= 1900 && y <= 2100 ? y : (trip.year || start.getFullYear());
      view = trip.startDate ? new Date(start.getFullYear(), start.getMonth(), 1) : new Date(year, month - 1, 1);
      const requestedDay=params.get('date');
      if(PlanSchedule.validDate(requestedDay)){selected=requestedDay;const day=parseDate(selected);view=new Date(day.getFullYear(),day.getMonth(),1);try{localStorage.setItem(storageKey('travelhub-selected-day'),JSON.stringify(selected));}catch{}}
      else if (!rangeStart || !rangeEnd || !localStorage.getItem(storageKey('travelhub-selected-day'))) selected = '';
    } else {
      const selectedDate = parseDate(selected);
      view = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
    }
    plannerReady=true;renderCalendar();
    renderNotes();
  }
  let refreshing=false;
  async function refreshFromServer(){
    if(dirty||saving||savingNotes||addingPlan||refreshing||!plannerReady||rangePending||rangeStart!==savedStart||rangeEnd!==savedEnd)return;
    refreshing=true;
    try{await init();}catch{ /* Keep the current screen and drafts when offline. */ }
    finally{refreshing=false;}
  }
  window.addEventListener('focus',refreshFromServer);
  window.addEventListener('storage',event=>{if(event.key==='glider-trips-updated')refreshFromServer();});
  init().catch(error => {
    $('.intro-copy').textContent = error.message;
    $('#addEventBtn').disabled = true;
  });
})();
