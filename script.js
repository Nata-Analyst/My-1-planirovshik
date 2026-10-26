(() => {
  'use strict';
  const KEY = 'personalTimePlanner.state.v1';
  const MIN = '1900-01-01', MAX = '9999-12-31', MAX_START = '9999-12-25';
  const $ = id => document.getElementById(id);
  const clone = value => JSON.parse(JSON.stringify(value));
  const normalize = value => value.normalize('NFC').trim().replace(/\s+/gu, ' ');
  const comparable = value => normalize(value).toLocaleLowerCase('ru');
  const isoDate = date => `${String(date.getUTCFullYear()).padStart(4, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
  function parseDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const [y,m,d] = value.split('-').map(Number);
    const result = new Date(Date.UTC(y,m-1,d));
    return isoDate(result) === value && value >= MIN && value <= MAX ? result : null;
  }
  const shift = (value, amount) => { const date = parseDate(value); if (!date) return ''; date.setUTCDate(date.getUTCDate() + amount); return isoDate(date); };
  function monday() {
    const now = new Date();
    const local = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    return shift(local, -((parseDate(local).getUTCDay()+6)%7));
  }
  const dateLabel = value => parseDate(value).toLocaleDateString('ru-RU', {timeZone:'UTC',day:'numeric',month:'long',year:'numeric'});
  const timeStamp = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value));
  const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 160;
  const minuteOfDay = value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? Number(value.slice(0,2))*60+Number(value.slice(3)) : null;
  const exactDuration = minutes => `${Math.floor(minutes/60)}:${String(minutes%60).padStart(2,'0')}`;
  const readableDuration = minutes => `${Math.floor(minutes/60)?`${Math.floor(minutes/60)} ч `:''}${minutes%60 || !minutes?`${minutes%60} мин`:''}`.trim();
  const formatNumber = (value,digits=2) => value.toLocaleString('ru-RU',{maximumFractionDigits:digits});
  function parseDuration(text) {
    const value=text.trim();
    if(!value)return {missing:true,issue:'Укажите длительность.'};
    let minutes;
    if(/^\d{1,2}:[0-5]\d$/.test(value)) {
      const [hours,rest]=value.split(':').map(Number);minutes=hours*60+rest;
    } else if(/^(?:\d+(?:[.,]\d{1,4})?|[.,]\d{1,4})$/.test(value)) {
      const hours=Number(value.replace(',','.'));
      if(hours>24)return {issue:'Максимальная длительность — 24 часа.'};
      minutes=Math.round(hours*60);
    } else return {issue:'Введите часы (1,5) или длительность Ч:ММ (1:30).'};
    if(minutes<1)return {issue:'Минимальная длительность — 1 минута.'};
    if(minutes>1440)return {issue:'Максимальная длительность — 24 часа.'};
    return {minutes};
  }
  function intervalBounds(entry) {
    const start=parseDate(entry.date).getTime()/86400000*1440+minuteOfDay(entry.startTime);
    return [start,start+entry.durationMinutes];
  }
  function minutesOnDay(entry,date) {
    if(entry.mode==='duration')return entry.date===date?entry.durationMinutes:0;
    const [start,end]=intervalBounds(entry),dayStart=parseDate(date).getTime()/86400000*1440;
    return Math.max(0,Math.min(end,dayStart+1440)-Math.max(start,dayStart));
  }
  function summarizePeriod(start,tasks,index) {
    const dates=Array.from({length:7},(_,i)=>shift(start,i)),dayMinutes=Array(7).fill(0),byTask=new Map();
    for(let day=0;day<7;day++)for(const entry of index.get(dates[day])??[]) {
      const minutes=minutesOnDay(entry,dates[day]);if(!minutes)continue;
      if(!byTask.has(entry.taskId))byTask.set(entry.taskId,Array(7).fill(0));
      byTask.get(entry.taskId)[day]+=minutes;dayMinutes[day]+=minutes;
    }
    const rows=tasks.filter(task=>byTask.has(task.id)).map(task=>({...task,minutes:byTask.get(task.id),totalMinutes:byTask.get(task.id).reduce((sum,value)=>sum+value,0)}));
    rows.sort((a,b)=>b.totalMinutes-a.totalMinutes || a.name.localeCompare(b.name,'ru') || a.id.localeCompare(b.id));
    return {dates,dayMinutes,rows,totalMinutes:dayMinutes.reduce((sum,value)=>sum+value,0),maxHours:Math.max(16,Math.ceil(Math.max(...dayMinutes)/60/4)*4)};
  }
  function taskColor(id) {
    let hash=2166136261;for(const char of id)hash=Math.imul(hash^char.codePointAt(0),16777619)>>>0;
    return `hsl(${100+hash%65}, ${24+(hash>>>8)%18}%, ${35+(hash>>>16)%25}%)`;
  }
  function parseEntry(form,entries,tasks) {
    const task=tasks.find(item=>item.id===form.taskId);
    if(!task)return {missing:true,issue:'Выберите задачу.'};
    if(task.archived && !entries.some(item=>item.id===form.id))return {issue:'Для новой записи выберите активную задачу.'};
    if(form.comment.length>2000)return {issue:'Комментарий должен быть не длиннее 2000 символов.'};
    let durationMinutes,startTime=null,endTime=null,endsNextDay=false;
    if(form.mode==='duration') {
      const parsed=parseDuration(form.durationText);if(parsed.issue)return parsed;durationMinutes=parsed.minutes;
    } else {
      const start=minuteOfDay(form.startTime),end=minuteOfDay(form.endTime);
      if(start===null || end===null)return {missing:true,issue:'Укажите начало и окончание интервала.'};
      if(start===end)return {issue:'Начало и окончание совпадают.'};
      endsNextDay=end<start;
      if(endsNextDay && form.date===MAX)return {issue:'Окончание выходит за пределы допустимых дат.'};
      durationMinutes=end-start+(endsNextDay?1440:0);startTime=form.startTime;endTime=form.endTime;
    }
    const previous=entries.find(item=>item.id===form.id),stamp=new Date().toISOString();
    const entry={id:form.id,date:form.date,taskId:form.taskId,mode:form.mode,durationMinutes,startTime,endTime,endsNextDay,comment:form.comment,createdAt:previous?.createdAt??form.createdAt,updatedAt:stamp};
    const intervalChanged=!previous || previous.mode!==entry.mode || previous.date!==entry.date || previous.startTime!==entry.startTime || previous.endTime!==entry.endTime;
    if(entry.mode==='interval' && intervalChanged) {
      const [start,end]=intervalBounds(entry);
      const conflict=entries.find(other=>{if(other.id===entry.id || other.mode!=='interval')return false;const [a,b]=intervalBounds(other);return start<b && end>a;});
      if(conflict) return {issue:`Интервал пересекается с записью «${tasks.find(item=>item.id===conflict.taskId).name}», ${conflict.date.split('-').reverse().join('.')}, ${conflict.startTime}–${conflict.endTime}.`};
    }
    if(previous && JSON.stringify({...entry,updatedAt:''})===JSON.stringify({...previous,updatedAt:''}))entry.updatedAt=previous.updatedAt;
    return {entry};
  }
  function validate(data) {
    const fail = () => { throw new Error('Сохранённые данные повреждены. Исходные данные не изменены.'); };
    if (!data || data.schemaVersion !== 1) throw new Error('Неподдерживаемая версия сохранённых данных. Исходные данные не изменены.');
    if (!Number.isSafeInteger(data.revision) || data.revision < 0 || !timeStamp(data.updatedAt) || !Array.isArray(data.tasks) || !Array.isArray(data.entries)) fail();
    const ids = new Set(), names = new Set();
    for (const task of data.tasks) {
      if (!task || !validId(task.id) || ids.has(task.id) || typeof task.name !== 'string' || !normalize(task.name) || task.name.length>120 || normalize(task.name)!==task.name || names.has(comparable(task.name)) || typeof task.archived!=='boolean' || !timeStamp(task.createdAt) || !timeStamp(task.updatedAt)) fail();
      ids.add(task.id); names.add(comparable(task.name));
    }
    const entryIds = new Set(), intervals = [];
    const minute = value => typeof value==='string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? +value.slice(0,2)*60 + +value.slice(3) : null;
    for (const entry of data.entries) {
      if (!entry || !validId(entry.id) || entryIds.has(entry.id) || !ids.has(entry.taskId) || !parseDate(entry.date) || !Number.isInteger(entry.durationMinutes) || entry.durationMinutes<1 || entry.durationMinutes>1440 || typeof entry.comment!=='string' || entry.comment.length>2000 || !timeStamp(entry.createdAt) || !timeStamp(entry.updatedAt)) fail();
      entryIds.add(entry.id);
      if (entry.mode==='duration') { if (entry.startTime!==null || entry.endTime!==null || entry.endsNextDay!==false) fail(); }
      else if (entry.mode==='interval') {
        const start=minute(entry.startTime), end=minute(entry.endTime);
        if (start===null || end===null || start===end || entry.endsNextDay!==(end<start) || entry.durationMinutes!==end-start+(end<start?1440:0) || (entry.endsNextDay && entry.date===MAX)) fail();
        const absolute = parseDate(entry.date).getTime()/86400000*1440+start;
        intervals.push([absolute,absolute+entry.durationMinutes]);
      } else fail();
    }
    intervals.sort((a,b)=>a[0]-b[0]);
    for (let i=1;i<intervals.length;i++) if(intervals[i][0]<intervals[i-1][1]) fail();
    const s=data.settings;
    if (!s || !parseDate(s.periodStart) || s.periodStart>MAX_START || !parseDate(s.sliderAnchorDate) || s.sliderAnchorDate>MAX_START || !Number.isInteger(s.sliderOffsetDays) || Math.abs(s.sliderOffsetDays)>31 || shift(s.sliderAnchorDate,s.sliderOffsetDays)!==s.periodStart || !['days','tasks'].includes(s.chartMode) || typeof s.storageNoticeDismissed!=='boolean') fail();
    return data;
  }
  const initialDate=monday(), now=new Date().toISOString();
  let state={schemaVersion:1,revision:0,updatedAt:now,tasks:[],entries:[],settings:{periodStart:initialDate,sliderAnchorDate:initialDate,sliderOffsetDays:0,chartMode:'days',storageNoticeDismissed:false}};
  let fatal=false, storageIssue='', pending=null, activeTab='planner', deferredTransition=null;
  let saveTimer, navigationTimer, settingsDraft=null;
  const drafts=new Map();
  const entryDrafts=new Map(),openComments=new Set(),openDetails=new Set(),archiveChoices=new Set();
  let pendingApplied={tasks:[],entries:[]};
  let entriesByDay=new Map();
  const uid = () => typeof crypto.randomUUID==='function'?crypto.randomUUID():`id-${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  const toForm = entry => ({...entry,durationText:exactDuration(entry.durationMinutes),startTime:entry.startTime??'',endTime:entry.endTime??''});
  function rebuildEntryIndex() {
    entriesByDay=new Map();
    for(const entry of state.entries) {
      for(const date of [entry.date,...(entry.endsNextDay && entry.endTime!=='00:00'?[shift(entry.date,1)]:[])]) {
        if(!entriesByDay.has(date))entriesByDay.set(date,[]);
        entriesByDay.get(date).push(entry);
      }
    }
  }
  let lastJSON='';
  function error(message, {retry=false,reload=false,discard=false}={}) {
    $('storage-error').hidden=false; $('storage-error-text').textContent=message;
    $('retry-save').hidden=!retry; $('reload-page').hidden=!reload; $('discard-save').hidden=!discard;
  }
  function showStatus() {
    const dirty=drafts.size || entryDrafts.size || $('new-task-name').value.trim() || pending || settingsDraft;
    $('save-status').textContent=fatal?'Изменения заблокированы':storageIssue?'Изменения не сохранены':dirty?'Есть незавершённые изменения':'Все изменения сохранены';
    $('status-dot')?.classList.toggle('dirty',Boolean(dirty));
    $('storage-size').textContent=`Хранение в браузере · ${(2*lastJSON.length/1048576).toLocaleString('ru-RU',{maximumFractionDigits:2})} МиБ`;
    $('size-warning').hidden=2*lastJSON.length<4*1048576;
  }
  function storageFailure(exception) {
    storageIssue=exception.name==='QuotaExceededError'?'quota':'write';
    error(storageIssue==='quota'?'Хранилище браузера заполнено. Последние изменения не сохранены. Можно отменить их и удалить ненужные записи или сократить комментарии.':'Не удалось сохранить изменения в этом браузере.',{retry:true,discard:Boolean(pending)});
    // Keep a failed candidate stable until retry or explicit cancellation.
    if(pending) for(const control of document.querySelectorAll('.task-row input, .task-row button, .entry-row input, .entry-row select, .entry-row textarea, .entry-row button, .add-entry, #new-task-name, #add-task-form button, #dismiss-notice, #chart-days, #chart-tasks')) control.disabled=true;
    showStatus();
  }
  function commit(candidate) {
    if(fatal) return false;
    const before=JSON.stringify({...state,revision:0,updatedAt:''});
    const after=JSON.stringify({...candidate,revision:0,updatedAt:''});
    if(before===after) { pending=null; return true; }
    candidate.revision=state.revision+1; candidate.updatedAt=new Date().toISOString();
    try {
      validate(candidate);
      const json=JSON.stringify(candidate);
      $('save-status').textContent='Сохранение…';
      window.localStorage.setItem(KEY,json);
      state=candidate; lastJSON=json; pending=null; storageIssue='';rebuildEntryIndex();
      $('storage-error').hidden=true; showStatus();renderAnalytics(); return true;
    } catch(exception) { pending=candidate; storageFailure(exception); return false; }
  }
  function load() {
    try {
      const raw=window.localStorage.getItem(KEY);
      if(raw!==null) { state=validate(JSON.parse(raw)); lastJSON=raw; }
    } catch(exception) {
      fatal=true;
      error(exception.name==='SecurityError'?'Хранилище браузера недоступно. Изменения заблокированы.':exception instanceof SyntaxError?'Сохранённые данные повреждены. Исходные данные не изменены.':exception.message);
      return;
    }
    try { const probe=`${KEY}.probe.${Date.now()}`; window.localStorage.setItem(probe,'1'); window.localStorage.removeItem(probe); }
    catch(exception) { if(exception.name==='QuotaExceededError') storageFailure(exception); else {fatal=true;error('Хранилище браузера недоступно. Доступен только просмотр.');} }
  }
  function nameError(value,id=null) {
    const name=normalize(value);
    if(!name) return 'Введите название задачи.';
    if(name.length>120) return 'Название должно быть не длиннее 120 символов.';
    const duplicate=state.tasks.find(task=>task.id!==id && comparable(task.name)===comparable(name));
    if(duplicate) return duplicate.archived?'Такая задача уже есть в архиве. Восстановите её.':'Такая задача уже есть.';
    return '';
  }
  function applyFieldError(input,message,node) { node.textContent=message; input.setAttribute('aria-invalid',String(Boolean(message))); }
  function flushDrafts() {
    clearTimeout(saveTimer);
    if(pending) return false;
    const candidate=clone(state), valid=[],validEntries=[];
    for(const [id,value] of drafts) {
      const input=$(`name-${id}`), issue=nameError(value,id);
      if(input) applyFieldError(input,issue,$(`error-${id}`));
      if(!issue) {const task=candidate.tasks.find(item=>item.id===id),name=normalize(value);if(task.name!==name){task.name=name;task.updatedAt=new Date().toISOString();}valid.push(id);}
    }
    // Validate duplicate names across the batch, not just against saved state.
    const seen=new Set();
    for(const task of candidate.tasks) {const name=comparable(task.name);if(seen.has(name)){for(const id of valid){const input=$(`name-${id}`);if(input)applyFieldError(input,'Такая задача уже есть.',$(`error-${id}`));}return false;}seen.add(name);}
    for(const [id,form] of entryDrafts) {
      const result=parseEntry(form,candidate.entries,candidate.tasks);
      const row=$(`entry-${id}`);if(row)updateEntryRow(row,form,result);
      if(!result.entry)continue;
      const index=candidate.entries.findIndex(item=>item.id===id);
      if(index===-1)candidate.entries.push(result.entry);else candidate.entries[index]=result.entry;
      validEntries.push(id);
    }
    pendingApplied={tasks:valid,entries:validEntries};
    if((valid.length || validEntries.length) && !commit(candidate)) return false;
    for(const id of valid) drafts.delete(id);
    for(const id of validEntries)entryDrafts.delete(id);
    refreshDays();showStatus(); return drafts.size===0 && entryDrafts.size===0;
  }
  function flushSettings() {
    clearTimeout(navigationTimer);
    if(!settingsDraft) return true;
    if(pending) return false;
    const candidate=clone(state); candidate.settings={...candidate.settings,...settingsDraft};
    if(commit(candidate)){settingsDraft=null;showStatus();return true;}
    return false;
  }
  function hasNewDraft() {return Boolean($('new-task-name').value.trim());}
  function attemptTransition(action) {
    flushDrafts(); flushSettings();
    if(drafts.size || entryDrafts.size || pending || hasNewDraft() || settingsDraft) {
      deferredTransition=action; $('transition-guard').hidden=false; $('stay').focus(); return;
    }
    action();
  }
  const element=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;};
  function renderWeek() {
    const s={...state.settings,...settingsDraft}, first=s.periodStart, last=shift(first,6);
    $('period-title').textContent=`${dateLabel(first).replace(' г.','')} — ${dateLabel(last)}`;
    $('period-start').value=first; $('period-start').disabled=fatal;
    $('previous-day').disabled=fatal || first===MIN; $('next-day').disabled=fatal || first===MAX_START;
    $('current-week').disabled=fatal;
    const anchor=parseDate(s.sliderAnchorDate).getTime()/86400000;
    $('period-slider').min=Math.max(-31,parseDate(MIN).getTime()/86400000-anchor);
    $('period-slider').max=Math.min(31,parseDate(MAX_START).getTime()/86400000-anchor);
    $('period-slider').value=s.sliderOffsetDays; $('period-slider').disabled=fatal;
    $('slider-label').textContent=s.sliderOffsetDays===0?'0 · опорная дата':`${s.sliderOffsetDays>0?'+':''}${s.sliderOffsetDays} · ${s.sliderOffsetDays>0?'вперёд':'назад'}`;
    const today=new Date(), todayKey=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
    const fragment=document.createDocumentFragment();
    for(let i=0;i<7;i++) {
      const key=shift(first,i), date=parseDate(key), card=element('article','day-card'+(key===todayKey?' today':''));card.dataset.date=key;
      const header=element('div','day-heading'), title=element('h3','',date.toLocaleDateString('ru-RU',{timeZone:'UTC',weekday:'long'}));
      title.textContent=title.textContent[0].toUpperCase()+title.textContent.slice(1);header.append(title);
      const sub=element('div','day-date',date.toLocaleDateString('ru-RU',{timeZone:'UTC',day:'numeric',month:'long'}));
      if(key===todayKey)sub.append(element('span','today-label','Сегодня'));
      header.append(sub);
      const list=element('div','day-entries');list.dataset.date=key;
      const add=element('button','add-entry secondary','+ Добавить запись');add.disabled=fatal || Boolean(pending);add.addEventListener('click',()=>addEntry(key));
      const footer=element('div','daily-summary');footer.setAttribute('aria-live','polite');
      card.append(header,list,add,footer);
      fragment.append(card);
    }
    $('week-grid').replaceChildren(fragment);
    refreshDays();
  }
  function navigateDate(value,{anchor=true,offset=0,delayed=false}={}) {
    if(fatal || !parseDate(value) || value>MAX_START) {renderWeek();return;}
    const change=()=>{
      settingsDraft={periodStart:value,sliderAnchorDate:anchor?value:state.settings.sliderAnchorDate,sliderOffsetDays:offset};
      openComments.clear();openDetails.clear();renderWeek();showStatus();clearTimeout(navigationTimer);
      if(delayed)navigationTimer=setTimeout(flushSettings,300);else flushSettings();
    };
    if(drafts.size || entryDrafts.size || pending || hasNewDraft()) {attemptTransition(change);$('period-start').value=state.settings.periodStart;} else change();
  }
  function addEntry(date) {
    if(fatal || pending)return;
    const active=state.tasks.some(task=>!task.archived);
    if(!active) {
      const list=[...document.querySelectorAll('.day-entries')].find(node=>node.dataset.date===date);
      let hint=list.querySelector('.no-tasks');
      if(!hint) {hint=element('div','no-tasks');hint.append(element('p','','Добавьте задачу или восстановите задачу из архива.'));const button=element('button','text-button','Открыть справочник');button.addEventListener('click',()=>attemptTransition(()=>switchTab('tasks')));hint.append(button);list.append(hint);}
      return;
    }
    const existing=[...entryDrafts.values()].find(form=>form.date===date && !state.entries.some(entry=>entry.id===form.id));
    if(existing){$(`entry-${existing.id}`).querySelector('select').focus();return;}
    const id=uid();
    openDetails.add(id);
    entryDrafts.set(id,{id,date,taskId:'',mode:'duration',durationText:'',startTime:'',endTime:'',endsNextDay:false,comment:'',createdAt:new Date().toISOString()});
    refreshDays();showStatus();$(`entry-${id}`).querySelector('select').focus();
  }
  function formFor(id) {return entryDrafts.get(id)??toForm(state.entries.find(entry=>entry.id===id));}
  function makeEntryRow(form) {
    const row=element('div','entry-row');row.id=`entry-${form.id}`;row.dataset.entryId=form.id;
    const summary=element('div','entry-summary'),name=element('button','entry-name'),expand=element('button','details-toggle','+');
    name.type=expand.type='button';name.dataset.action='details-name';expand.dataset.action='details';
    const details=element('div','entry-details');details.id=`${form.id}-details`;
    for(const button of [name,expand]){button.setAttribute('aria-controls',details.id);button.addEventListener('click',()=>{
      if(openDetails.has(form.id)){openDetails.delete(form.id);openComments.delete(form.id);}else openDetails.add(form.id);
      updateEntryRow(row,formFor(form.id));
    });}
    row.append(summary,details);
    const field=(labelText,control,key)=>{
      const label=element('label','entry-label',labelText);control.id=`${form.id}-${key}`;label.htmlFor=control.id;control.dataset.field=key;control.setAttribute('aria-describedby',`${form.id}-issue`);details.append(label,control);return control;
    };
    const task=field('Задача',element('select'), 'taskId');
    const archiveLabel=element('label','archive-choice'),archive=element('input');archive.type='checkbox';archive.dataset.action='archive';archive.checked=archiveChoices.has(form.id);archiveLabel.append(archive,document.createTextNode(' Показать архивные задачи'));details.append(archiveLabel);
    const mode=field('Учёт времени',element('select'),'mode');
    for(const [value,text] of [['duration','Часы'],['interval','Интервал']]){const option=element('option','',text);option.value=value;mode.append(option);}
    const duration=field('Длительность',element('input'),'durationText');duration.type='text';duration.placeholder='1,5 или 1:30';duration.inputMode='text';
    const durationLabel=duration.previousElementSibling;durationLabel.classList.add('visually-hidden');duration.setAttribute('aria-label','Затраченное время в часах или Ч:ММ');
    const durationBox=element('div','summary-duration');durationBox.append(durationLabel,duration,element('span','duration-unit','ч'));
    summary.append(name,durationBox,expand);
    const start=field('С',element('input'),'startTime'),end=field('До',element('input'),'endTime');
    for(const input of [start,end]){input.type='time';input.step='60';}
    const modeNote=element('p','entry-hint mode-note');details.append(modeNote);
    const result=element('p','entry-result');result.setAttribute('aria-live','polite');details.append(result);
    const issue=element('p','field-error entry-issue');issue.id=`${form.id}-issue`;issue.setAttribute('aria-live','polite');row.append(issue);
    const commentControls=element('div','comment-controls'),toggle=element('button','comment-toggle','+');toggle.dataset.action='comment';toggle.type='button';toggle.setAttribute('aria-controls',`${form.id}-comment`);
    const commentMark=element('span','comment-mark');commentControls.append(toggle,commentMark);details.append(commentControls);
    const commentLabel=element('label','entry-label comment-label','Комментарий');commentLabel.htmlFor=`${form.id}-comment`;
    const comment=element('textarea','entry-comment');comment.id=`${form.id}-comment`;comment.dataset.field='comment';comment.rows=3;comment.setAttribute('aria-describedby',`${form.id}-issue`);details.append(commentLabel,comment);
    const remove=element('button','delete-entry text-button');remove.dataset.action='delete';details.append(remove);
    for(const control of [task,duration,start,end,comment]) {
      control.addEventListener(control===task?'change':'input',()=>{
        const draft={...formFor(form.id),[control.dataset.field]:control.value};entryDrafts.set(form.id,draft);
        updateEntryRow(row,draft,parseEntry(draft,state.entries,state.tasks));showStatus();clearTimeout(saveTimer);
        if(control===task)flushDrafts();else saveTimer=setTimeout(flushDrafts,1500);
      });
    }
    mode.addEventListener('change',()=>{
      const previous=state.entries.find(entry=>entry.id===form.id),draft={...formFor(form.id)},target=mode.value;
      if(previous && target===previous.mode){const original=toForm(previous);Object.assign(draft,{mode:target,durationText:original.durationText,startTime:original.startTime,endTime:original.endTime});}
      else if(target==='duration') {
        const parsed=parseEntry(draft,state.entries,state.tasks);
        draft.mode=target;draft.durationText=parsed.entry?exactDuration(parsed.entry.durationMinutes):previous?exactDuration(previous.durationMinutes):'';draft.startTime='';draft.endTime='';
      } else {draft.mode=target;draft.startTime='';draft.endTime='';}
      entryDrafts.set(form.id,draft);duration.value=draft.durationText;start.value=draft.startTime;end.value=draft.endTime;
      updateEntryRow(row,draft,parseEntry(draft,state.entries,state.tasks));showStatus();clearTimeout(saveTimer);flushDrafts();
    });
    archive.addEventListener('change',()=>{if(archive.checked)archiveChoices.add(form.id);else archiveChoices.delete(form.id);updateEntryRow(row,formFor(form.id));});
    toggle.addEventListener('click',()=>{if(openComments.has(form.id))openComments.delete(form.id);else openComments.add(form.id);updateEntryRow(row,formFor(form.id));});
    remove.addEventListener('click',()=>{
      if(!state.entries.some(entry=>entry.id===form.id)) {entryDrafts.delete(form.id);openComments.delete(form.id);openDetails.delete(form.id);row.remove();refreshDays();showStatus();return;}
      if(row.querySelector('.delete-confirm'))return;
      const confirmation=element('div','delete-confirm');confirmation.append(element('p','','Удалить эту запись?'));
      const actions=element('div','actions'),yes=element('button','danger','Удалить'),cancel=element('button','secondary','Отмена');
      yes.addEventListener('click',()=>{
        if(pending || fatal)return;
        const candidate=clone(state);candidate.entries=candidate.entries.filter(entry=>entry.id!==form.id);pendingApplied={tasks:[],entries:[form.id]};
        if(commit(candidate)){entryDrafts.delete(form.id);openComments.delete(form.id);openDetails.delete(form.id);refreshDays();showStatus();}
      });cancel.addEventListener('click',()=>{confirmation.remove();remove.focus();});actions.append(yes,cancel);confirmation.append(actions);details.append(confirmation);yes.focus();
    });
    row.addEventListener('focusout',()=>setTimeout(()=>{if(!row.isConnected || row.contains(document.activeElement))return;flushDrafts();if(!entryDrafts.has(form.id)){const saved=state.entries.find(entry=>entry.id===form.id);if(saved)duration.value=exactDuration(saved.durationMinutes);}refreshDays();},0));
    task.value=form.taskId;mode.value=form.mode;duration.value=form.durationText;start.value=form.startTime;end.value=form.endTime;comment.value=form.comment;
    updateEntryRow(row,form);return row;
  }
  function updateEntryRow(row,form,result) {
    // Saved entries have already passed validation. Only drafts need rechecking.
    if(!result)result=entryDrafts.has(form.id)?parseEntry(form,state.entries,state.tasks):{entry:state.entries.find(entry=>entry.id===form.id)};
    const saved=state.entries.some(entry=>entry.id===form.id),select=row.querySelector('[data-field=taskId]');
    const choices=state.tasks.filter(task=>!task.archived || task.id===form.taskId || (saved && archiveChoices.has(form.id)));
    const desired=[['','Выберите задачу'],...choices.map(task=>[task.id,task.name+(task.archived?' · В архиве':'')])];
    if(JSON.stringify([...select.options].map(option=>[option.value,option.textContent]))!==JSON.stringify(desired)) {
      select.replaceChildren(...desired.map(([id,name])=>{const option=element('option','',name);option.value=id;return option;}));
    }
    select.value=form.taskId;
    select.title=state.tasks.find(task=>task.id===form.taskId)?.name??'Выберите задачу';
    row.querySelector('[data-field=mode]').value=form.mode;
    for(const key of ['durationText','startTime','endTime']) {
      const input=row.querySelector(`[data-field=${key}]`),visible=key==='durationText' || form.mode==='interval';input.hidden=!visible;input.previousElementSibling.hidden=!visible;
    }
    row.querySelector('.archive-choice').hidden=!saved;
    row.querySelector('[data-action=delete]').textContent=saved?'Удалить запись':'Отменить добавление';
    const neutral=Boolean(result.missing && !saved),issue=row.querySelector('.entry-issue');issue.textContent=result.issue??'';issue.classList.toggle('neutral',neutral);
    for(const input of row.querySelectorAll('[data-field]'))input.setAttribute('aria-invalid',String(Boolean(result.issue && !neutral)));
    const entry=result.entry;
    const expanded=openDetails.has(form.id);
    row.querySelector('.entry-details').hidden=!expanded;
    const name=row.querySelector('.entry-name'),expand=row.querySelector('[data-action=details]');
    name.textContent=select.title;name.title=select.title;
    for(const button of [name,expand])button.setAttribute('aria-expanded',String(expanded));
    expand.textContent=expanded?'−':'+';expand.setAttribute('aria-label',expanded?'Скрыть подробности задачи':'Показать подробности задачи');
    const duration=row.querySelector('[data-field=durationText]');duration.readOnly=form.mode==='interval';
    duration.title=form.mode==='interval'?'Рассчитано по интервалу. Нажмите +, чтобы изменить время.':'Введите часы, например 1,5, или длительность 1:30';
    if(form.mode==='interval')duration.value=entry?formatNumber(entry.durationMinutes/60):'';
    else if(!entryDrafts.has(form.id) && document.activeElement!==duration && entry)duration.value=formatNumber(entry.durationMinutes/60);
    row.querySelector('.entry-result').textContent=entry?`${entry.endsNextDay?'Всего: ':''}${formatNumber(entry.durationMinutes/60)} ч${entry.durationMinutes%60?` · ${readableDuration(entry.durationMinutes)}`:''}${entry.endsNextDay?` · В этот день: ${readableDuration(minutesOnDay(entry,entry.date))}`:''}`:'';
    const note=row.querySelector('.mode-note');
    note.textContent=entry?.endsNextDay?`До ${entry.endTime} следующего дня (${dateLabel(shift(entry.date,1))}). Без интервала всё время будет учтено в дате записи.`:'';
    const open=openComments.has(form.id),button=row.querySelector('[data-action=comment]');button.textContent=open?'−':'+';button.setAttribute('aria-expanded',String(open));button.setAttribute('aria-label',open?'Скрыть комментарий':'Показать комментарий');
    row.querySelector('.entry-comment').hidden=!open;row.querySelector('.comment-label').hidden=!open;row.querySelector('.comment-mark').textContent=form.comment?'Есть комментарий':'';
    for(const control of row.querySelectorAll('input,select,textarea,button'))control.disabled=fatal || Boolean(pending);
  }
  function refreshDays() {
    for(const card of document.querySelectorAll('.day-card')) {
      const date=card.dataset.date,list=card.querySelector('.day-entries');
      const relevant=entriesByDay.get(date)??[],own=relevant.filter(entry=>entry.date===date);
      const savedIds=new Set(own.map(entry=>entry.id));
      const forms=[...own.map(entry=>entryDrafts.get(entry.id)??toForm(entry)),...[...entryDrafts.values()].filter(form=>form.date===date && !savedIds.has(form.id))];
      forms.sort((a,b)=>{
        const sa=state.entries.find(entry=>entry.id===a.id),sb=state.entries.find(entry=>entry.id===b.id);
        if(!sa || !sb)return Number(!sa)-Number(!sb);
        return Number(sa.mode==='duration')-Number(sb.mode==='duration') || (sa.mode==='interval' && sb.mode==='interval'?sa.startTime.localeCompare(sb.startTime):0) || sa.createdAt.localeCompare(sb.createdAt) || sa.id.localeCompare(sb.id);
      });
      const ids=new Set(forms.map(form=>`entry-${form.id}`));
      for(const row of list.querySelectorAll('.entry-row'))if(!ids.has(row.id))row.remove();
      for(const old of list.querySelectorAll('.continuation,.day-empty,.no-tasks'))old.remove();
      const incoming=relevant.filter(entry=>entry.date!==date);
      for(const entry of incoming) {
        const continuation=element('details','continuation');
        continuation.append(element('summary','',`${state.tasks.find(task=>task.id===entry.taskId).name} · ${formatNumber(minutesOnDay(entry,date)/60)} ч`),element('p','entry-hint',`Продолжение: 00:00–${entry.endTime}. Начало ${dateLabel(entry.date)}`));
        const link=element('button','text-button','К записи');link.addEventListener('click',()=>attemptTransition(()=>{
          if(!$(`entry-${entry.id}`)){const start=entry.date>MAX_START?MAX_START:entry.date;navigateDate(start);}
          openDetails.add(entry.id);const row=$(`entry-${entry.id}`);if(row)updateEntryRow(row,formFor(entry.id));row?.scrollIntoView({block:'center',inline:'nearest'});row?.querySelector('select').focus();
        }));continuation.append(link);list.prepend(continuation);
      }
      // Keep the active editor in place even when the browser window is inactive.
      const focused=list.contains(document.activeElement)?document.activeElement.closest('.entry-row'):null;
      for(const form of forms) {
        let row=$(`entry-${form.id}`);
        if(!row){row=makeEntryRow(form);list.append(row);}else updateEntryRow(row,form);
        if(!focused)list.append(row);
      }
      if(!forms.length && !incoming.length)list.append(element('div','day-empty','Записей пока нет'));
      const minutes=relevant.reduce((sum,entry)=>sum+minutesOnDay(entry,date),0),percent=minutes/960*100;
      const footer=card.querySelector('.daily-summary');footer.replaceChildren();
      const totals=element('div','day-footer');totals.append(element('strong','',`${formatNumber(minutes/60)} ч`),element('span','',`${formatNumber(percent,1)}%`));
      const track=element('div','efficiency-track'),bar=element('div','efficiency-bar');bar.style.width=`${Math.min(100,percent)}%`;track.append(bar);track.setAttribute('role','img');track.setAttribute('aria-label',`Эффективность дня ${formatNumber(percent,1)}%`);footer.append(totals,track);
      card.querySelector('.add-entry').disabled=fatal || Boolean(pending);
    }
    renderAnalytics();
  }
  let analyticsSignature='';
  function renderAnalytics() {
    const start=settingsDraft?.periodStart??state.settings.periodStart,mode=state.settings.chartMode;
    const summary=summarizePeriod(start,state.tasks,entriesByDay);
    const signature=JSON.stringify({start,mode,days:summary.dayMinutes,rows:summary.rows.map(row=>[row.id,row.name,row.archived,row.minutes])});
    $('chart-days').disabled=$('chart-tasks').disabled=fatal || Boolean(pending);
    if(signature===analyticsSignature)return;
    analyticsSignature=signature;
    $('period-hours').textContent=`${formatNumber(summary.totalMinutes/60)} ч`;
    $('period-hours').dataset.minutes=summary.totalMinutes;
    $('period-efficiency').textContent=`${formatNumber(summary.totalMinutes/6720*100,1)}%`;
    for(const [id,value] of [['chart-days','days'],['chart-tasks','tasks']])$(id).setAttribute('aria-pressed',String(mode===value));
    $('analytics-empty').hidden=summary.totalMinutes!==0;
    drawTimeChart(summary,mode);drawSummaryTable(summary);
  }
  function shortDate(value) {return parseDate(value).toLocaleDateString('ru-RU',{timeZone:'UTC',day:'2-digit',month:'2-digit'});}
  function drawTimeChart(summary,mode) {
    const svg=$('time-chart');svg.replaceChildren();svg.dataset.maxHours=summary.maxHours;
    const make=(tag,attributes={},text)=>{const node=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [key,value] of Object.entries(attributes))node.setAttribute(key,value);if(text!==undefined)node.textContent=text;return node;};
    svg.append(make('title',{id:'chart-title'},mode==='days'?'Часы по дням':'Часы по задачам и дням'),make('desc',{id:'chart-description'},'Семь столбцов. Высота — часы, пунктирная линия — 16 часов. Подробные значения приведены в таблице ниже.'));
    const top=28,bottom=282,left=56,right=1060,height=bottom-top,step=(right-left)/7,barWidth=58;
    const y=hours=>bottom-hours/summary.maxHours*height;
    for(let hours=0;hours<=summary.maxHours;hours+=4) {
      const reference=hours===16;
      svg.append(make('line',{x1:left,y1:y(hours),x2:right,y2:y(hours),class:reference?'chart-reference':'chart-gridline',...(reference?{'stroke-dasharray':'6 5'}:{})}),make('text',{x:left-12,y:y(hours)+4,'text-anchor':'end',class:'chart-axis-label'},String(hours)));
      if(reference)svg.append(make('text',{x:right+5,y:y(hours)+4,class:'chart-reference-label'},'16 ч'));
    }
    svg.append(make('text',{x:14,y:16,class:'chart-axis-label'},'Часы'));
    const tooltip=$('chart-tooltip');tooltip.hidden=true;
    function bindTooltip(rect,label) {
      rect.setAttribute('tabindex','0');rect.setAttribute('role','img');rect.setAttribute('aria-label',label);rect.setAttribute('aria-describedby','chart-tooltip');
      const show=()=>{
        tooltip.textContent=label;tooltip.hidden=false;
        const area=$('chart-area').getBoundingClientRect(),box=rect.getBoundingClientRect();
        const width=tooltip.getBoundingClientRect().width;
        tooltip.style.left=`${Math.max(0,Math.min(box.x-area.x+box.width/2-width/2,area.width-width))}px`;
        tooltip.style.top=`${Math.max(0,box.y-area.y-tooltip.getBoundingClientRect().height-8)}px`;
      };
      rect.addEventListener('mouseenter',show);rect.addEventListener('focus',show);
      rect.addEventListener('mouseleave',()=>{if(document.activeElement!==rect)tooltip.hidden=true;});rect.addEventListener('blur',()=>{tooltip.hidden=true;});
      rect.addEventListener('keydown',event=>{if(event.key==='Escape')tooltip.hidden=true;});
    }
    summary.dates.forEach((date,day)=>{
      const x=left+day*step+step/2-barWidth/2,total=summary.dayMinutes[day];
      const group=make('g',{'data-date':date,'data-minutes':total,class:'chart-day'});
      if(mode==='days' && total) {
        const rect=make('rect',{x,y:y(total/60),width:barWidth,height:bottom-y(total/60),rx:4,fill:'#72945c',class:'chart-bar','data-minutes':total});
        bindTooltip(rect,`${dateLabel(date)} · ${formatNumber(total/60)} ч · ${readableDuration(total)}`);group.append(rect);
      } else if(mode==='tasks') {
        let accumulated=0;
        for(const row of summary.rows) {
          const minutes=row.minutes[day];if(!minutes)continue;
          const rect=make('rect',{x,y:y((accumulated+minutes)/60),width:barWidth,height:minutes/60/summary.maxHours*height,fill:taskColor(row.id),stroke:'#fff','stroke-width':'0.7',class:'chart-segment','data-task-id':row.id,'data-minutes':minutes});
          bindTooltip(rect,`${dateLabel(date)} · ${row.name}${row.archived?' (В архиве)':''} · ${formatNumber(minutes/60)} ч · ${readableDuration(minutes)}`);group.append(rect);accumulated+=minutes;
        }
      }
      group.append(make('text',{x:x+barWidth/2,y:y(total/60)-8,'text-anchor':'middle',class:'chart-total'},formatNumber(total/60)));
      group.append(make('text',{x:x+barWidth/2,y:307,'text-anchor':'middle',class:'chart-day-label'},parseDate(date).toLocaleDateString('ru-RU',{weekday:'short',timeZone:'UTC'})),make('text',{x:x+barWidth/2,y:327,'text-anchor':'middle',class:'chart-axis-label'},shortDate(date)));
      svg.append(group);
    });
    const legend=$('chart-legend');legend.replaceChildren();legend.hidden=mode!=='tasks' || !summary.rows.length;
    if(mode==='tasks')for(const row of summary.rows){const item=element('li'),swatch=element('span','legend-swatch');swatch.style.background=taskColor(row.id);swatch.setAttribute('aria-hidden','true');item.dataset.taskId=row.id;item.append(swatch,document.createTextNode(`${row.name}${row.archived?' · В архиве':''} — ${formatNumber(row.totalMinutes/60)} ч`));legend.append(item);}
  }
  function drawSummaryTable(summary) {
    const table=$('tasks-summary'),header=element('tr');
    for(const text of ['Задача',...summary.dates.map(shortDate),'Всего, ч']){const th=element('th','',text);th.scope='col';header.append(th);}
    table.tHead.replaceChildren(header);const body=document.createDocumentFragment();
    for(const task of summary.rows) {
      const row=element('tr');row.dataset.taskId=task.id;const name=element('th','',task.name);name.scope='row';
      if(task.archived)name.append(element('span','table-archive','В архиве'));row.append(name);
      for(const minutes of [...task.minutes,task.totalMinutes]){const cell=element('td','',formatNumber(minutes/60));cell.dataset.minutes=minutes;cell.title=readableDuration(minutes);row.append(cell);}body.append(row);
    }
    table.tBodies[0].replaceChildren(body);const footer=element('tr'),label=element('th','','Всего');label.scope='row';footer.append(label);
    for(const minutes of [...summary.dayMinutes,summary.totalMinutes]){const cell=element('td','',formatNumber(minutes/60));cell.dataset.minutes=minutes;footer.append(cell);}table.tFoot.replaceChildren(footer);
  }
  function renderTasks() {
    $('task-count').textContent=state.tasks.filter(task=>!task.archived).length;
    $('new-task-name').disabled=fatal; $('add-task-form').querySelector('button').disabled=fatal;
    $('tasks-empty').textContent=!state.tasks.length?'Добавьте первую задачу, чтобы записывать время':!state.tasks.some(task=>!task.archived)?'Добавьте задачу или восстановите задачу из архива':'';
    const sorted=[...state.tasks].sort((a,b)=>Number(a.archived)-Number(b.archived)||a.createdAt.localeCompare(b.createdAt));
    const fragment=document.createDocumentFragment();
    for(const task of sorted) {
      const row=element('div','task-row'+(task.archived?' archived':''));row.dataset.taskId=task.id;
      const field=element('div','task-field'), label=element('label','','Название задачи');label.htmlFor=`name-${task.id}`;
      if(task.archived)label.append(element('span','archive-label','В архиве'));
      const input=element('input');input.type='text';input.id=`name-${task.id}`;input.value=drafts.get(task.id)??task.name;input.disabled=fatal;input.setAttribute('aria-describedby',`error-${task.id}`);
      const issue=element('p','field-error');issue.id=`error-${task.id}`;issue.setAttribute('aria-live','polite');
      input.addEventListener('input',()=>{
        if(input.value===state.tasks.find(item=>item.id===task.id).name)drafts.delete(task.id);else drafts.set(task.id,input.value);
        applyFieldError(input,nameError(input.value,task.id),issue);showStatus();clearTimeout(saveTimer);saveTimer=setTimeout(flushDrafts,1500);
      });
      row.addEventListener('focusout',()=>setTimeout(()=>{if(!row.contains(document.activeElement))flushDrafts();},0));
      field.append(label,input,issue);
      const actions=element('div','task-actions'), button=element('button','secondary',task.archived?'Восстановить':'В архив');button.disabled=fatal;
      button.addEventListener('click',()=>{
        if(!flushDrafts() || pending){showStatus();return;}
        if(task.archived) archiveTask(task.id,false);
        else {
          if(row.querySelector('.archive-confirm'))return;
          const confirmation=element('div','archive-confirm');confirmation.append(element('p','','Отправить задачу в архив? История сохранится.'));
          const controls=element('div','actions'), yes=element('button','','В архив'), cancel=element('button','secondary','Отмена');
          yes.addEventListener('click',()=>archiveTask(task.id,true));cancel.addEventListener('click',()=>{confirmation.remove();button.focus();});
          controls.append(yes,cancel);confirmation.append(controls);row.append(confirmation);yes.focus();
        }
      });actions.append(button);row.append(field,actions);fragment.append(row);
    }
    $('task-list').replaceChildren(fragment);
  }
  function archiveTask(id,archived) {
    const candidate=clone(state),task=candidate.tasks.find(item=>item.id===id);task.archived=archived;task.updatedAt=new Date().toISOString();
    if(commit(candidate)){renderTasks();refreshDays();const input=$(`name-${id}`);if(input)input.focus();}
  }
  function switchTab(tab) {
    activeTab=tab;
    openComments.clear();openDetails.clear();refreshDays();
    for(const name of ['planner','tasks']) {const selected=name===tab; $(`tab-${name}`).setAttribute('aria-selected',String(selected));$(`tab-${name}`).tabIndex=selected?0:-1;$(`${name}-panel`).hidden=!selected;}
  }
  $('add-task-form').addEventListener('submit',event=>{
    event.preventDefault();if(fatal || pending)return;
    const input=$('new-task-name'),issue=nameError(input.value);applyFieldError(input,issue,$('new-task-error'));if(issue){input.focus();return;}
    if(!flushDrafts())return;
    const updatedIssue=nameError(input.value);if(updatedIssue){applyFieldError(input,updatedIssue,$('new-task-error'));return;}
    const candidate=clone(state),stamp=new Date().toISOString();
    const id=typeof crypto.randomUUID==='function'?crypto.randomUUID():`task-${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    candidate.tasks.push({id,name:normalize(input.value),archived:false,createdAt:stamp,updatedAt:stamp});
    if(commit(candidate)){input.value='';renderTasks();showStatus();input.focus();}
  });
  $('new-task-name').addEventListener('input',()=>{applyFieldError($('new-task-name'),'',$('new-task-error'));showStatus();});
  for(const tab of ['planner','tasks']) {
    $(`tab-${tab}`).addEventListener('click',()=>attemptTransition(()=>switchTab(tab)));
    $(`tab-${tab}`).addEventListener('keydown',event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const target=event.key==='Home'?'planner':event.key==='End'?'tasks':tab==='planner'?'tasks':'planner';attemptTransition(()=>{switchTab(target);$(`tab-${target}`).focus();});}});
  }
  $('period-start').addEventListener('change',()=>navigateDate($('period-start').value));
  $('previous-day').addEventListener('click',()=>navigateDate(shift(($('period-start').value),-1)));
  $('next-day').addEventListener('click',()=>navigateDate(shift(($('period-start').value),1)));
  $('current-week').addEventListener('click',()=>navigateDate(monday()));
  $('period-slider').addEventListener('input',()=>navigateDate(shift(state.settings.sliderAnchorDate,+$('period-slider').value),{anchor:false,offset:+$('period-slider').value,delayed:true}));
  $('period-slider').addEventListener('change',flushSettings);
  for(const [id,mode] of [['chart-days','days'],['chart-tasks','tasks']])$(id).addEventListener('click',()=>{
    if(fatal || pending || state.settings.chartMode===mode)return;
    const candidate=clone(state);candidate.settings.chartMode=mode;pendingApplied={tasks:[],entries:[]};commit(candidate);
  });
  $('dismiss-notice').addEventListener('click',()=>{if(fatal || pending)return;const candidate=clone(state);candidate.settings.storageNoticeDismissed=true;if(commit(candidate))$('storage-notice').hidden=true;});
  $('stay').addEventListener('click',()=>{$('transition-guard').hidden=true;deferredTransition=null;const id=entryDrafts.keys().next().value;if(id){openDetails.add(id);const row=$(`entry-${id}`);if(row)updateEntryRow(row,formFor(id));}const input=drafts.size?$(`name-${drafts.keys().next().value}`):id?$(`entry-${id}`)?.querySelector('select'):$('new-task-name');input?.focus();});
  function discard() {pending=null;drafts.clear();entryDrafts.clear();openComments.clear();openDetails.clear();settingsDraft=null;$('new-task-name').value='';$('new-task-error').textContent='';$('transition-guard').hidden=true;$('dismiss-notice').disabled=fatal;renderTasks();renderWeek();showStatus();}
  $('discard-transition').addEventListener('click',()=>{const action=deferredTransition;deferredTransition=null;discard();action?.();});
  $('discard-save').addEventListener('click',discard);
  $('retry-save').addEventListener('click',()=>{
    if(pending && commit(clone(pending))) {for(const id of pendingApplied.tasks)drafts.delete(id);for(const id of pendingApplied.entries)entryDrafts.delete(id);settingsDraft=null;$('new-task-name').value='';$('storage-notice').hidden=state.settings.storageNoticeDismissed;$('dismiss-notice').disabled=fatal;renderTasks();renderWeek();showStatus();}
    else if(!pending){try{const probe=`${KEY}.probe.${Date.now()}`;localStorage.setItem(probe,'1');localStorage.removeItem(probe);storageIssue='';$('storage-error').hidden=true;showStatus();}catch(exception){storageFailure(exception);}}
  });
  $('reload-page').addEventListener('click',()=>location.reload());
  window.addEventListener('storage',event=>{if(event.key!==KEY && event.key!==null)return;fatal=true;clearTimeout(saveTimer);clearTimeout(navigationTimer);error('Данные изменены в другой вкладке. Перезагрузите страницу.',{reload:true});renderTasks();renderWeek();showStatus();});
  window.addEventListener('beforeunload',event=>{flushDrafts();flushSettings();if(drafts.size || entryDrafts.size || pending || settingsDraft || hasNewDraft()){event.preventDefault();event.returnValue='';}});
  load();rebuildEntryIndex();renderWeek();renderTasks();$('storage-notice').hidden=state.settings.storageNoticeDismissed || fatal;$('dismiss-notice').disabled=fatal;showStatus();
})();
