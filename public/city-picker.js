// The search response already includes coordinates; selecting does not geocode twice.
(() => {
  const input = document.querySelector('#destination');
  const menu = document.createElement('div');
  menu.className = 'city-suggestions'; menu.id = 'citySuggestions'; menu.hidden = true;
  menu.setAttribute('role', 'listbox');
  input.after(menu);
  const status = document.createElement('small');
  status.className = 'city-status'; status.setAttribute('aria-live', 'polite'); menu.after(status);
  input.setAttribute('role', 'combobox'); input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', menu.id); input.setAttribute('aria-expanded', 'false');
  let selected = null, fallback = false, timer, controller, version = 0;
  function close() { menu.hidden = true; input.setAttribute('aria-expanded', 'false'); }
  window.cityPicker = { getSelection() { return selected; }, allowFallback() { return fallback; } };
  input.addEventListener('input', () => {
    selected = null; fallback = false; version++; clearTimeout(timer); controller?.abort(); close();
    const text = input.value.trim(), current = version;
    if (text.length < 2) { status.textContent = 'Введите минимум две буквы города.'; return; }
    status.textContent = 'Ищем город…';
    timer = setTimeout(async () => {
      controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      try {
        const response = await fetch('/api/cities?' + new URLSearchParams({name:text}), {signal:controller.signal});
        if (!response.ok) throw Error('search');
        const cities = await response.json();
        if (current !== version) return;
        menu.replaceChildren();
        cities.forEach(city => {
          const button = document.createElement('button'); button.type = 'button'; button.setAttribute('role','option');
          button.textContent = [city.name, city.admin1, city.country].filter(Boolean).join(' · ');
          button.onclick = () => { selected = city; input.value = city.name; close(); status.textContent = [city.admin1,city.country].filter(Boolean).join(' · '); input.focus(); };
          menu.append(button);
        });
        status.textContent = cities.length ? 'Выберите город из списка.' : 'Город не найден. Попробуйте другое название.';
        menu.hidden = !cities.length; input.setAttribute('aria-expanded', String(!!cities.length));
      } catch {
        if (current !== version) return;
        fallback = true; status.textContent = 'Поиск недоступен. Можно создать поездку с названием без координат.';
      } finally { clearTimeout(timeout); }
    }, 300);
  });
  input.addEventListener('keydown', e => { if(e.key==='ArrowDown'&&!menu.hidden){e.preventDefault();menu.querySelector('button')?.focus()} if(e.key==='Escape')close() });
  document.addEventListener('click', e => { if(!input.parentElement.contains(e.target))close() });
})();
