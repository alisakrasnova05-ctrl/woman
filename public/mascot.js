/* Visual companion only. No trip data, API requests or navigation are modified. */
(() => {
  'use strict';
  const svgNS='http://www.w3.org/2000/svg';
  const screen=document.querySelector('.page-shell')?'calendar':document.querySelector('#map')?'map':'home';
  document.body.dataset.gliderScreen=screen;
  const sprite=new Map();
  function fox(pose, className='fox-illustration') {
    const svg=document.createElementNS(svgNS,'svg');
    svg.setAttribute('viewBox','0 0 120 112');svg.setAttribute('aria-hidden','true');
    svg.classList.add(className);paint(svg,pose);return svg;
  }
  function paint(svg,pose) {
    svg.dataset.pose=pose;
    const symbol=sprite.get(pose);
    if(symbol) svg.replaceChildren(...[...symbol.childNodes].map(node=>node.cloneNode(true)));
    else {const use=document.createElementNS(svgNS,'use');use.setAttribute('href','/fox.svg#'+pose);svg.replaceChildren(use);}
  }
  document.querySelectorAll('.brand-mark').forEach(mark=>mark.replaceChildren(fox('sit')));
  const row=document.createElement('aside');row.className='glider-companion';row.setAttribute('aria-label','Лисёнок — спутник путешествия');
  const copy=document.createElement('div');copy.className='glider-companion-copy';
  const heading=document.createElement('strong'),message=document.createElement('span');
  copy.append(heading,message);
  const companion=fox(screen==='home'?'wave':'map','glider-fox');row.append(copy,companion);
  document.querySelector('header')?.after(row);
  let resetTimer,locked=false;
  function pose(name,title,text,temporary=false) {
    if(locked&&!temporary)return;
    if(companion.dataset.pose!==name)paint(companion,name);
    if(heading.textContent!==title)heading.textContent=title;
    if(message.textContent!==text)message.textContent=text;
    if(temporary){locked=true;clearTimeout(resetTimer);resetTimer=setTimeout(()=>{locked=false;context();},5000);}
  }
  function context() {
    if(screen==='home')return pose('wave','Куда отправимся?','Большие истории начинаются с маленького плана.');
    if(screen==='calendar') {
      const hasPlans=!!document.querySelector('.overview-plan');
      return pose(hasPlans?'map':'sit','Собираем впечатления',hasPlans?'У каждого дня — своя маленькая история.':'Выберите дни — и найдём место для ваших планов.');
    }
    const history=document.querySelector('#historyToggle')?.getAttribute('aria-pressed')==='true';
    const selected=document.querySelector('.event.selected,.transfer-card.selected,.marker-selected');
    if(history)return pose('sleep','Листаем историю',document.querySelector('#historyPosition')?.textContent||'Вспомним путешествие день за днём.');
    const title=document.querySelector('.event.selected .event-title')?.textContent?.trim();
    pose(selected?'point':'map',selected?'Место в вашей истории':'Держим курс',title||'Выбирайте события в ленте и точки на карте.');
  }
  const seenText=new WeakMap();
  function decorate() {
    const icons=window.GliderIcons;
    if(icons) {
      const actions={'#addPointBtn':'pin','#addBtn':'other','#addTransferBtn':'car','#locateBtn':'pin'};
      for(const [selector,name] of Object.entries(actions)) {
        const button=document.querySelector(selector);
        if(button&&!button.querySelector('svg')) {
          button.textContent=button.textContent.replace(/^[＋+↔◎]\s*/, '');
          button.insertAdjacentHTML('afterbegin',icons.icon(name));
        }
      }
      document.querySelectorAll('[data-delete-event],[data-delete-transfer]').forEach(button=>{
        if(!button.querySelector('svg')){button.innerHTML=icons.icon('trash');button.setAttribute('aria-label','Удалить');}
      });
      document.querySelectorAll('.sight-card-art:not([data-fox-art])').forEach(art=>{
        art.dataset.foxArt='';art.innerHTML=icons.icon('excursion');
      });
    }

    document.querySelectorAll('#trips > .empty:not([data-fox-empty])').forEach(empty=>{
      empty.dataset.foxEmpty='';
      const old=empty.querySelector('.empty-scene')||empty.firstElementChild;
      const scene=document.createElement('div');scene.className='empty-scene';scene.append(fox('suitcase'));
      if(old&&old.tagName==='DIV')old.replaceWith(scene);else empty.prepend(scene);
    });
    document.querySelectorAll('.journal-toast:not([data-fox-toast])').forEach(toast=>{
      toast.dataset.foxToast='';toast.prepend(fox('happy'));
      pose('happy','Сохранено!','Всё на месте. Можно отправляться за впечатлениями.',true);
    });
    document.querySelectorAll('#daySaveStatus,#scheduleStatus,#parseStatus,#plansStatus,.error').forEach(el=>{
      const text=el.textContent.trim();if(seenText.get(el)===text)return;seenText.set(el,text);
      if(!text)return;
      if(/не удалось|ошибк|недоступ|не получилось/i.test(text))pose('sad','Не всё получилось с первого раза','Проверьте сообщение рядом с формой — лисёнок подождёт.',true);
      else if(/сохранено|план распределён|добавлен/i.test(text))pose('happy','План на месте!','Ещё одно впечатление в вашем журнале.',true);
    });
    context();
  }
  let frame=0;
  const observer=new MutationObserver(records=>{
    if(records.every(r=>row.contains(r.target)||r.target.closest?.('.brand-mark,.empty-scene,.journal-toast[data-fox-toast]')))return;
    if(!frame)frame=requestAnimationFrame(()=>{frame=0;decorate();});
  });
  observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class','aria-pressed','open']});
  // Successful map form saves close their dialog; validation failures keep it open.
  document.querySelectorAll('dialog form').forEach(form=>{
    let submitted=false;
    form.addEventListener('submit',()=>{submitted=true;});
    form.closest('dialog').addEventListener('close',()=>{
      if(submitted&&!form.querySelector('.error')?.textContent.trim())pose('happy','Сохранено!','Новая страница вашей истории готова.',true);
      submitted=false;
    });
    form.querySelectorAll('button[type=button]').forEach(button=>button.addEventListener('click',()=>{if(/отмена|закрыть|×/i.test(button.textContent))submitted=false;}));
  });
  // Native cross-document View Transitions interpolate the shared fox. Browsers
  // without support get an arrival animation; ordinary links never wait for it.
  const hasNativeFlight='onpagereveal' in window && 'onpageswap' in window;
  try {
    const stamp=Number(sessionStorage.getItem('glider-fox-flight'));
    sessionStorage.removeItem('glider-fox-flight');
    if(stamp&&Date.now()-stamp<15000&&!hasNativeFlight)companion.classList.add('is-arriving');
  }catch{}
  document.addEventListener('click',event=>{
    if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
    const link=event.target.closest('a[href]');if(!link||link.target==='_blank'||link.hasAttribute('download'))return;
    const url=new URL(link.href,location.href);
    if(url.origin!==location.origin||url.pathname===location.pathname&&url.search===location.search)return;
    try{sessionStorage.setItem('glider-fox-flight',String(Date.now()));}catch{}
    if(!hasNativeFlight){companion.classList.add('is-leaving');setTimeout(()=>companion.classList.remove('is-leaving'),500);}
  });
  window.addEventListener('pageshow',()=>companion.classList.remove('is-leaving'));
  // Inline the local sprite for CSS blink/tail animation (external-use fallback
  // is already visible while it loads). Only trusted, repo-owned SVG is parsed.
  fetch('/fox.svg').then(r=>{if(!r.ok)throw Error();return r.text();}).then(text=>{
    const doc=new DOMParser().parseFromString(text,'image/svg+xml');
    doc.querySelectorAll('symbol').forEach(symbol=>sprite.set(symbol.id,symbol));
    document.querySelectorAll('.glider-fox,.fox-illustration').forEach(svg=>paint(svg,svg.dataset.pose));
  }).catch(()=>{});
  decorate();
})();
