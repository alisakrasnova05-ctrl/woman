/* Shared, deterministic scheduling. Dates are civil dates, independent of browser timezone. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.PlanSchedule=api;})(globalThis,()=>{
 const SLOTS=['09:00','14:00','19:00'];
 const validDate=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
 const validTime=t=>/^([01]\d|2[0-3]):[0-5]\d$/.test(t||'');
 const addDays=(date,n)=>new Date(Date.parse(date+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
 function days(start,end){if(!validDate(start)||!validDate(end)||end<start)return [];const n=Math.round((Date.parse(end)-Date.parse(start))/86400000)+1;if(n>3660)throw Error('Для обзора выберите поездку не длиннее 10 лет.');return Array.from({length:n},(_,i)=>addDays(start,i));}
 function hints(text,start,end){
  let date=null,time=null;const iso=text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  const months=['январ','феврал','март','апрел','ма','июн','июл','август','сентябр','октябр','ноябр','декабр'];
  const ru=text.match(/(?:^|\s)(\d{1,2})\s+(январ[а-яё]*|феврал[а-яё]*|март[а-яё]*|апрел[а-яё]*|ма[йя]|июн[а-яё]*|июл[а-яё]*|август[а-яё]*|сентябр[а-яё]*|октябр[а-яё]*|ноябр[а-яё]*|декабр[а-яё]*)(?:\s+(20\d{2}))?/i);
  if(iso)date=iso[1];else if(ru){let year=Number(ru[3]||start?.slice(0,4)||new Date().getFullYear());const m=months.findIndex(p=>ru[2].toLowerCase().startsWith(p))+1;date=`${year}-${String(m).padStart(2,'0')}-${ru[1].padStart(2,'0')}`;if(!ru[3]&&start&&end&&date<start&&end.slice(0,4)>start.slice(0,4))date=(year+1)+date.slice(4);}
  const ordinal=text.match(/(?:первый|первого|второй|второго|третий|третьего|четв[её]ртый|пятый|шестой|седьмой|восьмой|девятый|десятый|\d+(?:-?[йя]|-?ой)?)\s+д(?:ень|ня)/i);
  if(!date&&ordinal&&validDate(start)){const word=ordinal[0].toLowerCase();const names=['перв','втор','трет','четв','пят','шест','седьм','восьм','девят','десят'];const number=parseInt(word)||names.findIndex(n=>word.startsWith(n))+1;date=addDays(start,number-1);}
  const weekdays=[/воскресень/i,/понедельник/i,/вторник/i,/сред[ау]/i,/четверг/i,/пятниц[ау]/i,/суббот[ау]/i];
  const weekday=weekdays.findIndex(p=>p.test(text));
  if(!date&&weekday>=0&&validDate(start)){date=days(start,end).find(d=>new Date(d+'T12:00:00Z').getUTCDay()===weekday);if(!date)throw Error('Указанный день недели не входит в даты поездки.');}
  if(!date&&/послезавтра|завтра|сегодня/i.test(text)&&validDate(start))date=addDays(start,/послезавтра/i.test(text)?2:/завтра/i.test(text)?1:0);
  const clock=text.match(/(?:^|\s|,)(?:в\s*)?([01]?\d|2[0-3]):([0-5]\d)(?=$|\s|[.,;])/i)||text.match(/(?:^|\s)в\s+([01]?\d|2[0-3])(?:\s*(?:час[а-яё]*|утра|вечера)|(?=\s|$))/i);
  if(clock){let h=Number(clock[1]);if(/вечера/i.test(clock[0])&&h<12)h+=12;time=String(h).padStart(2,'0')+':'+(clock[2]||'00');}
  else if(/после обеда/i.test(text))time='14:00';else if(/утром|утро/i.test(text))time='09:00';else if(/вечером|вечер/i.test(text))time='19:00';
  if(date&&!validDate(date))throw Error('В плане указана некорректная дата.');
  return {date,time,dateExplicit:!!date,timeExplicit:!!time};
 }
 const stamp=(date,time)=>Date.parse(date+'T'+time+':00Z')/60000;
 function interval(event){if(!validDate(event.date)||!validTime(event.startTime||event.time))return null;const start=stamp(event.date,event.startTime||event.time);const end=validTime(event.endTime)?stamp(event.endDate||event.date,event.endTime):event.endDate&&event.endDate>event.date?stamp(event.endDate,'23:59')+1:start+60;return [start,Math.max(start+1,end)];}
 function available(event,occupied){const a=interval(event);return a&&!occupied.some(other=>{const b=interval(other);return b&&a[0]<b[1]&&b[0]<a[1];});}
 function place(item,start,end,occupied,preferences={}){
  const tripDays=days(start,end);if(!tripDays.length)throw Error('Сначала подтвердите даты поездки.');
  const fixedDate=preferences.date||null,fixedTime=preferences.time||null;
  if(fixedDate&&!tripDays.includes(fixedDate))throw Error('Дата плана вне поездки. Измените текст или подтвердите другой диапазон.');
  const oldSpan=interval(item);const duration=oldSpan?oldSpan[1]-oldSpan[0]:60;
  for(const date of fixedDate?[fixedDate]:tripDays)for(const time of fixedTime?[fixedTime]:SLOTS){
   const result={...item,date,startTime:time};
   if(item.endTime || (item.endDate&&item.endDate>item.date)){const finish=new Date((stamp(date,time)+duration)*60000).toISOString();result.endDate=finish.slice(0,10);result.endTime=finish.slice(11,16);}else {result.endDate=date;result.endTime='';}
   if((result.endDate||date)<=end&&available(result,occupied))return result;
  }
  throw Error(fixedTime?'Указанное время занято. Измените время или перенесите план на другой день.':'Свободных слотов нет. Перенесите план или расширьте даты поездки.');
 }
 function allocate(items,start,end,occupied=[]){const assigned=[];for(const item of items){const result=place(item,start,end,[...occupied,...assigned],{date:item.dateExplicit?item.date:null,time:item.timeExplicit?item.startTime:null});assigned.push(result);}return assigned;}
 return {SLOTS,validDate,validTime,addDays,days,hints,interval,available,place,allocate};
});
