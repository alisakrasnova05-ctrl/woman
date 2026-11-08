// City suggestions for both trip origin and destination.
(() => {
  const pickers = new Map();

  ['origin', 'destination'].forEach((field) => {
    const input = document.querySelector('#' + field);
    if (!input) return;

    const menu = document.createElement('div');
    menu.className = 'city-suggestions';
    menu.id = field + 'CitySuggestions';
    menu.hidden = true;
    menu.setAttribute('role', 'listbox');
    input.after(menu);

    const status = document.createElement('small');
    status.className = 'city-status';
    status.setAttribute('aria-live', 'polite');
    menu.after(status);
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-controls', menu.id);
    input.setAttribute('aria-expanded', 'false');

    const state = {selected: null, fallback: false, timer: null, controller: null, version: 0};
    pickers.set(field, state);
    const close = () => {
      menu.hidden = true;
      input.setAttribute('aria-expanded', 'false');
    };

    input.addEventListener('input', () => {
      state.selected = null;
      state.fallback = false;
      state.version += 1;
      clearTimeout(state.timer);
      state.controller?.abort();
      close();
      const text = input.value.trim();
      const current = state.version;
      if (text.length < 2) {
        status.textContent = text ? 'Введите минимум две буквы города.' : '';
        return;
      }

      status.textContent = 'Ищем город…';
      state.timer = setTimeout(async () => {
        state.controller = new AbortController();
        const controller = state.controller;
        const timeout = setTimeout(() => controller.abort(), 8000);
        try {
          const response = await fetch('/api/cities?' + new URLSearchParams({name: text}), {signal: controller.signal});
          if (!response.ok) throw Error('search');
          const cities = await response.json();
          if (current !== state.version) return;
          menu.replaceChildren();
          cities.forEach(city => {
            const button = document.createElement('button');
            button.type = 'button';
            button.setAttribute('role', 'option');
            button.textContent = [city.name, city.admin1, city.country].filter(Boolean).join(' · ');
            button.onclick = () => {
              state.selected = city;
              input.value = city.name;
              close();
              status.textContent = [city.admin1, city.country].filter(Boolean).join(' · ');
              input.focus();
            };
            menu.append(button);
          });
          status.textContent = cities.length ? 'Выберите город из списка.' : 'Город не найден. Попробуйте другое название.';
          menu.hidden = !cities.length;
          input.setAttribute('aria-expanded', String(!!cities.length));
        } catch {
          if (current !== state.version) return;
          state.fallback = true;
          status.textContent = 'Поиск недоступен. Можно указать название без координат.';
        } finally {
          clearTimeout(timeout);
        }
      }, 300);
    });

    input.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown' && !menu.hidden) {
        event.preventDefault();
        menu.querySelector('button')?.focus();
      }
      if (event.key === 'Escape') close();
    });
    document.addEventListener('click', event => {
      if (!input.parentElement.contains(event.target)) close();
    });
  });

  window.cityPicker = {
    getSelection(field = 'destination') { return pickers.get(field)?.selected || null; },
    allowFallback(field = 'destination') { return pickers.get(field)?.fallback || false; },
  };
})();