/* Keep trip/day context in ordinary links, independently of map/API loading. */
(() => {
  const params=new URLSearchParams(location.search),tripId=params.get('trip');
  const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
  let day=validDate(params.get('date'))?params.get('date'):null;
  function update(date){
    if(validDate(date))day=date;
    const query=new URLSearchParams();
    if(tripId)query.set('trip',tripId);
    if(day)query.set('date',day);
    document.querySelectorAll('[data-trip-screen]').forEach(link=>{
      const screen=link.dataset.tripScreen;
      link.href=tripId?(screen==='calendar'?'/planner?':'/trip?')+query:'/';
      const current=screen==='calendar'?['/planner','/planner.html'].includes(location.pathname):['/trip','/map.html','/index.html'].includes(location.pathname);
      if(current)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');
    });
  }
  window.GliderNavigation={update};
  update();
})();
