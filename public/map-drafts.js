/* Read-only preview of calendar drafts. Server writes still require explicit Save. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./plan-schedule'));else root.MapDrafts=factory(root.PlanSchedule);})(globalThis,Schedule=>{
 function overlay(points,events,notes,committed,tripId){
  if(!notes||Array.isArray(notes)||typeof notes!=='object'||JSON.stringify(notes)===JSON.stringify(committed))return {points,events,active:false};
  const rows=Object.entries(notes).flatMap(([date,list])=>Array.isArray(list)?list.filter(n=>n&&typeof n==='object').map(note=>({date,note})):[]);
  if(committed===null && !rows.length)return {points,events,active:false};
  const imported=new Set(rows.map(r=>r.note.originalEventId).filter(Boolean));
  const previewPoints=[...points],previewEvents=events.filter(e=>e.source!=='day-notes'&&!imported.has(e.id));
  for(const {date,note} of rows){
   const id=note.id||'draft:'+note.dayNoteId;let pointId=note.pointId||null;
   if(!pointId&&note.place&&Number.isFinite(note.place.lat)&&Number.isFinite(note.place.lng)&&Math.abs(note.place.lat)<=90&&Math.abs(note.place.lng)<=180){
    pointId='draft-point:'+note.dayNoteId;
    previewPoints.push({...note.place,id:pointId,tripId,name:note.place.name,lat:note.place.lat,lng:note.place.lng,_draft:true});
   }
   if(Schedule.validDate(date)&&Schedule.validTime(note.startTime||note.time)&&note.title?.trim())previewEvents.push({...note,id,tripId,date,pointId,startTime:note.startTime||note.time,startAt:new Date(date+'T'+(note.startTime||note.time)).toISOString(),endAt:Schedule.validTime(note.endTime)?new Date((note.endDate||date)+'T'+note.endTime).toISOString():null,_draft:true,source:'day-notes'});
  }
  return {points:previewPoints,events:previewEvents,active:true};
 }
 return {overlay};
});
