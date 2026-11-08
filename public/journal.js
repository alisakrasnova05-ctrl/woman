/* Presentation enhancements only; no application data is written here. */
(() => {
  const icon = name => window.GliderIcons.icon(name);
  const decorate = root => {
    root.querySelectorAll('.trip-card:not([data-journal]),.timeline-item:not([data-journal]),.note-row:not([data-journal])').forEach((el,i) => {
      el.dataset.journal=''; el.style.setProperty('--journal-order',Math.min(i,7)); el.classList.add('journal-enter');
      el.addEventListener('animationend',()=>el.classList.remove('journal-enter'),{once:true});
    });
    root.querySelectorAll('.empty-notes .empty-icon,.length-icon').forEach(el => {
      if(!el.querySelector('svg')) el.innerHTML=icon('glider');
    });
    root.querySelectorAll('button').forEach(button => {
      const busy=button.disabled && /Сохраня|Загруз|Разбира/.test(button.textContent);
      if(button.getAttribute('aria-busy')!==String(busy)) button.setAttribute('aria-busy',String(busy));
    });
  };
  decorate(document);
  let scheduled=false;
  const observer=new MutationObserver(records=>{
    if(!records.some(r=>r.type==='childList')) return;
    if(!scheduled){scheduled=true;requestAnimationFrame(()=>{scheduled=false;decorate(document);});}
  });
  observer.observe(document.body,{childList:true,subtree:true});
  const grid=document.querySelector('#calendarGrid');
  ['prevMonth','nextMonth','monthSelect','yearSelect'].forEach(id=>{
    document.getElementById(id)?.addEventListener(id.includes('Select')?'change':'click',()=>{
      grid?.classList.remove('month-arriving');
      requestAnimationFrame(()=>grid?.classList.add('month-arriving'));
    });
  });
  // The existing save flow navigates immediately; carry its visual receipt to the map.
  const status=document.querySelector('#daySaveStatus');
  if(status) new MutationObserver(()=>{
    if(status.textContent.startsWith('Сохранено.')) try{sessionStorage.setItem('glider-visual-receipt','1');}catch{}
  }).observe(status,{childList:true});
  try {
    if(location.pathname==='/trip' && sessionStorage.getItem('glider-visual-receipt')){
      sessionStorage.removeItem('glider-visual-receipt');
      const toast=document.createElement('div');toast.className='journal-toast';toast.setAttribute('role','status');
      toast.innerHTML=icon('check')+'<span>Сохранено. Маршрут готов к полёту.</span>';document.body.append(toast);
      setTimeout(()=>toast.remove(),3500);
    }
  }catch{}
})();
