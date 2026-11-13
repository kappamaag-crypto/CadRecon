import {useState,useEffect,useRef,useMemo} from 'react';
import Editor from './Editor';
import {newProject,newSheet,newId,validateProject,type CadProject,type Entity,type Tool} from './model';
import {auditSheet,scaleSheet,translateEntity} from './geometry';
import {createDxf} from './dxf';
import {createBackup,downloadFile,exportProject,importProject,loadProject,listBackups,restoreBackup,saveProject} from './storage';
import {importDrawing} from './pdf';
import {traceImage} from './vectorize';
import {recognizeText} from './ocr';
type Panel='tools'|'layers'|'properties'|'audit'|'backups';
const TOOLS:{id:Tool;title:string;icon:string;hotkey?:string}[]=[
  {id:'select',title:'Выделение / перенос',icon:'↖',hotkey:'V'},{id:'pan',title:'Перемещение полотна',icon:'✋',hotkey:'H'},
  {id:'line',title:'Отрезок',icon:'╱',hotkey:'L'},{id:'polyline',title:'Полилиния',icon:'〽'},
  {id:'circle',title:'Окружность',icon:'◯',hotkey:'C'},{id:'arc',title:'Дуга (3 точки)',icon:'⌒'},
  {id:'dimension',title:'Размерный объект',icon:'↔',hotkey:'D'},{id:'axis',title:'Осевая линия',icon:'┈'},
  {id:'leader',title:'Выноска',icon:'➤'},{id:'hatch',title:'Замкнутый контур / заливка',icon:'▨'},
  {id:'text',title:'Надпись',icon:'T',hotkey:'T'},{id:'table',title:'Таблица',icon:'▦'},
  {id:'stamp',title:'Основная надпись',icon:'▤'},
  {id:'measure',title:'Измерить расстояние',icon:'📏',hotkey:'M'},
  {id:'calibrate',title:'Калибровка по известному размеру',icon:'⊞'}
];
function slug(s:string){return s.replace(/[^\p{L}\p{N}._-]/gu,'_');}
export default function App(){
 const [project,setProject]=useState<CadProject>(newProject);
 const [sheetIndex,setSheetIndex]=useState(0),[tool,setTool]=useState<Tool>('select'),[selected,setSelected]=useState<string|null>(null),[panel,setPanel]=useState<Panel>('tools');
 const [source,setSource]=useState(true),[compare,setCompare]=useState(false),[snap,setSnap]=useState(true),[grid,setGrid]=useState(false),[busy,setBusy]=useState(''),[status,setStatus]=useState('Загрузите PDF или скан, чтобы начать.'),[ocrText,setOcrText]=useState('');
 const [backups,setBackups]=useState<{key:string;time:number;name:string}[]>([]),[loaded,setLoaded]=useState(false);
 const input=useRef<HTMLInputElement>(null),jsonInput=useRef<HTMLInputElement>(null),undo=useRef<CadProject[]>([]),redo=useRef<CadProject[]>([]);
 const sheet=project.sheets[Math.min(sheetIndex,project.sheets.length-1)]||project.sheets[0];
 function apply(update:(p:CadProject)=>CadProject){setProject(prev=>{const next=update(prev);if(next===prev)return prev;undo.current.push(prev);if(undo.current.length>35)undo.current.shift();redo.current=[];return {...next,updated:new Date().toISOString()};});}
 function undoAction(){if(!undo.current.length)return;const next=undo.current.pop()!;redo.current.push(project);setProject(next);setSelected(null);}
 function redoAction(){if(!redo.current.length)return;const next=redo.current.pop()!;undo.current.push(project);setProject(next);setSelected(null);}
 function changeSheet(fn:(s:typeof sheet)=>typeof sheet){apply(p=>({...p,sheets:p.sheets.map((s,i)=>i===sheetIndex?fn(s):s)}));}
 function addEntities(es:Entity[]){if(!es.length)return;changeSheet(s=>({...s,entities:[...s.entities,...es]}));setStatus('Добавлено объектов: '+es.length);}
 function modifyEntity(e:Entity){changeSheet(s=>({...s,entities:s.entities.map(x=>x.id===e.id?e:x)}));}
 function deleteSelected(){if(!selected)return;const e=sheet.entities.find(e=>e.id===selected);const layer=project.layers.find(l=>l.name===e?.layer);if(layer?.locked){setStatus('Слой заблокирован');return;}changeSheet(s=>({...s,entities:s.entities.filter(e=>e.id!==selected)}));setSelected(null);}
 useEffect(()=>{loadProject().then(p=>{if(p){setProject(p);setStatus('Локальный проект восстановлен');}}).catch(e=>setStatus('Хранилище недоступно: '+e)).finally(()=>setLoaded(true));},[]);
 useEffect(()=>{if(!loaded)return;const t=setTimeout(()=>saveProject(project).catch(e=>setStatus('Не удалось сохранить проект локально: '+e)),1400);return()=>clearTimeout(t);},[project,loaded]);
 useEffect(()=>{function key(ev:KeyboardEvent){const el=ev.target as HTMLElement;if(['INPUT','TEXTAREA','SELECT'].includes(el?.tagName)||busy)return;if((ev.ctrlKey||ev.metaKey)&&ev.key.toLowerCase()==='z'){ev.preventDefault();undoAction();}else if((ev.ctrlKey||ev.metaKey)&&ev.key.toLowerCase()==='y'){ev.preventDefault();redoAction();}else if((ev.key==='Delete'||ev.key==='Backspace')&&selected){ev.preventDefault();deleteSelected();}else if(!ev.ctrlKey&&!ev.metaKey){const found=TOOLS.find(t=>t.hotkey?.toLowerCase()===ev.key.toLowerCase());if(found)setTool(found.id);}}
 window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[project,selected,busy]);
 async function handleDrawing(files:FileList|null){if(!files?.length)return;setBusy('Импорт документа…');try{const nextSheets:CadProject['sheets']=[];for(const f of Array.from(files)){const parts=await importDrawing(f,setBusy);nextSheets.push(...parts);}await createBackup(project);apply(p=>({...p,name:p.name==='Новый проект'?files[0].name:p.name,sheets:[...(p.sheets.length===1&&!p.sheets[0].entities.length&&!p.sheets[0].image?[]:p.sheets),...nextSheets]}));setSheetIndex(project.sheets.length===1&&!project.sheets[0].entities.length&&!project.sheets[0].image?0:project.sheets.length);setSelected(null);setStatus('Импортировано листов: '+nextSheets.length+'. Векторные элементы PDF требуют проверки.');}catch(e){setStatus('Ошибка импорта: '+String(e));}finally{setBusy('');if(input.current)input.current.value='';}}
 async function handleProject(files:FileList|null){if(!files?.length)return;setBusy('Открытие проекта…');try{const p=await importProject(files[0]);await createBackup(project);setProject(p);undo.current=[];redo.current=[];setSheetIndex(0);setSelected(null);setStatus('Проект открыт: '+p.name);}catch(e){setStatus('Ошибка проекта: '+String(e));}finally{setBusy('');if(jsonInput.current)jsonInput.current.value='';}}
 async function vectorize(){setBusy('Обработка скана…');try{const r=await traceImage(sheet);addEntities(r.entities);setStatus(r.note);}catch(e){setStatus('Обводка: '+String(e));}finally{setBusy('');}}
 async function runOcr(){setBusy('Распознавание текста…');try{const r=await recognizeText(sheet,setBusy);setOcrText(r.text);addEntities(r.entities);setStatus('OCR: '+r.entities.length+' строк. Проверьте каждую надпись.');}catch(e){setStatus('OCR: '+String(e));}finally{setBusy('');}}
 function exportDxf(){if(!sheet.calibrated&&!window.confirm('Масштаб листа не подтверждён. Экспортировать DXF с условными единицами?'))return;
  try{downloadFile(createDxf(sheet,project),slug(project.name)+'_'+slug(sheet.name)+'.dxf','application/dxf');setStatus('DXF экспортирован. Проверьте его в целевой CAD-системе.');}catch(e){setStatus('Ошибка DXF: '+e);}}
 async function showBackups(){try{setBackups(await listBackups());setPanel('backups');}catch(e){setStatus('Резервные копии: '+e);}}
 async function restore(key:string){if(!window.confirm('Восстановить эту копию? Текущий проект предварительно будет сохранён.'))return;try{await createBackup(project);const p=await restoreBackup(key);setProject(p);setSheetIndex(0);setSelected(null);setStatus('Резервная копия восстановлена');}catch(e){setStatus('Восстановление: '+e);}}
 function newDocument(){if(!window.confirm('Создать новый проект? Текущий останется в резервной копии.'))return;createBackup(project).catch(()=>{});setProject(newProject());setSheetIndex(0);setSelected(null);undo.current=[];redo.current=[];}
 const selection=sheet.entities.find(e=>e.id===selected);
 const issues=useMemo(()=>auditSheet(sheet,project),[sheet,project]);
 const counts=useMemo(()=>sheet.entities.reduce((acc,e)=>(acc[e.kind]=(acc[e.kind]||0)+1,acc),{} as Record<string,number>),[sheet]);
 return <div className="app">
  <header className="topbar">
    <div className="brand"><span className="brandicon">⌗</span><div><strong>CadRecon</strong><small>ИНЖЕНЕРНЫЙ 2D РЕДАКТОР</small></div></div>
    <div className="project-name"><input aria-label="Название проекта" title="Название проекта" value={project.name} onChange={e=>apply(p=>({...p,name:e.target.value}))}/><span className="save-mark">● локально</span></div>
    <div className="top-actions">
      <input ref={input} type="file" accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff,application/pdf,image/*" multiple hidden onChange={e=>handleDrawing(e.target.files)}/>
      <input ref={jsonInput} type="file" accept=".json,.cadrecon.json" hidden onChange={e=>handleProject(e.target.files)}/>
      <button onClick={()=>input.current?.click()} className="primary">＋ Загрузить PDF / скан</button>
      <button title="Сохранить проект в JSON" onClick={()=>exportProject(project)}>↓ JSON</button>
      <button title="Открыть проект JSON" onClick={()=>jsonInput.current?.click()}>↑ JSON</button>
      <button className="primary outline" onClick={exportDxf}>↓ DXF</button>
    </div>
  </header>
  <nav className="quickbar"><button onClick={newDocument}>Новый</button><button onClick={()=>{changeSheet(s=>s);apply(p=>({...p,sheets:[...p.sheets,newSheet('Лист '+(p.sheets.length+1))]}));setSheetIndex(project.sheets.length);}}>＋ Лист</button><button disabled={!undo.current.length} onClick={undoAction}>↶ Отмена</button><button disabled={!redo.current.length} onClick={redoAction}>↷ Повтор</button><span className="vr"/>
    <label><input type="checkbox" checked={snap} onChange={e=>setSnap(e.target.checked)}/> Привязка</label>
    <label><input type="checkbox" checked={grid} onChange={e=>setGrid(e.target.checked)}/> Сетка</label>
    <label><input type="checkbox" checked={source} onChange={e=>{setSource(e.target.checked);setCompare(false);}}/> Подложка</label>
    <label><input type="checkbox" checked={compare} onChange={e=>setCompare(e.target.checked)}/> До / после</label>
    <span className="spacer"/><button onClick={()=>setTool('calibrate')} className={!sheet.calibrated?'warn':''}>{sheet.calibrated?'✓ Калиброван':'⚠ Масштаб не установлен'}</button>
  </nav>
  <div className="workspace">
    <aside className="toolrail">{TOOLS.map(t=><button key={t.id} className={tool===t.id?'active':''} onClick={()=>setTool(t.id)} title={t.title+(t.hotkey?' ['+t.hotkey+']':'')} aria-label={t.title}>{t.icon}</button>)}</aside>
    <section className="drawing">
      <div className="sheetnav"><div className="sheet-tabs">{project.sheets.map((s,i)=><button key={s.id} className={sheetIndex===i?'active':''} onClick={()=>{setSheetIndex(i);setSelected(null);}} title={s.name}>{s.name.length>26?s.name.slice(0,24)+'…':s.name}</button>)}</div><span className="meta">{sheet.entities.length.toLocaleString('ru-RU')} объектов · {Math.round(sheet.width)} × {Math.round(sheet.height)} {sheet.calibrated?'мм':'ед.'}</span></div>
      <Editor key={sheet.id} sheet={sheet} project={project} tool={tool} selected={selected} onSelect={setSelected} onCreate={e=>addEntities([e])} onMove={(e,d)=>modifyEntity(translateEntity(e,d))} onCalibrate={factor=>{changeSheet(s=>scaleSheet(s,factor));setStatus('Лист откалиброван. Проверьте дополнительные контрольные размеры.');}} onMessage={setStatus} source={source} compare={compare} grid={grid} snap={snap}/>
      <div className="statusbar"><span className={busy?'pulse':''}>{busy||status}</span><span className="status-right">Esc — отмена · Enter — завершить контур · Del — удалить · Ctrl+Z — назад</span></div>
    </section>
    <aside className="sidebar">
      <div className="panel-tabs">{(['tools','layers','properties','audit','backups'] as Panel[]).map((x,i)=><button key={x} title={['Инструменты','Слои','Свойства','Проверка','Резерв'][i]} onClick={()=>x==='backups'?showBackups():setPanel(x)} className={panel===x?'active':''}>{['⌘','☷','⚙','✓','▣'][i]}</button>)}</div>
      <div className="panelcontent">
      {panel==='tools'&&<><h3>Обработка документа</h3><p className="muted">Векторный PDF импортируется со штрихами. Для скана доступны автоматическая обводка и OCR; результат требует проверки.</p><div className="stack"><button className="action" onClick={vectorize} disabled={!sheet.image||!!busy}>⌁ Автообводка линий</button><button className="action" onClick={runOcr} disabled={!sheet.image||!!busy}>Aa Распознать текст (RU/EN)</button><button className="action" onClick={()=>setTool('calibrate')}>⊞ Калибровать по размеру</button><button className="action" onClick={()=>setTool('measure')}>↔ Измерить расстояние</button></div><h3>Состав листа</h3><div className="statgrid">{Object.entries(counts).map(([key,n])=><div key={key}><strong>{n}</strong><small>{key}</small></div>)}</div>{!!ocrText&&<><h3>Распознанный текст</h3><textarea rows={7} readOnly value={ocrText} aria-label="OCR текст"/><button onClick={()=>navigator.clipboard.writeText(ocrText)}>Копировать OCR</button></>}<p className="notice">Сканированная геометрия и OCR не считаются точными до проверки размеров и объектов.</p></>}
      {panel==='layers'&&<><h3>Слои</h3><p className="muted">Цвет, видимость и блокировка каждого типа CAD-объектов.</p><div className="layerlist">{project.layers.map(l=><div className="layer" key={l.name}><span className="swatch" style={{background:l.color}}/><span className="layername">{l.name}</span><button title="Видимость" onClick={()=>apply(p=>({...p,layers:p.layers.map(x=>x.name===l.name?{...x,visible:!x.visible}:x)}))}>{l.visible?'◉':'○'}</button><button title="Блокировка" onClick={()=>apply(p=>({...p,layers:p.layers.map(x=>x.name===l.name?{...x,locked:!x.locked}:x)}))}>{l.locked?'🔒':'▢'}</button></div>)}</div><button className="action" onClick={()=>{const name=window.prompt('Название нового слоя');if(!name?.trim()||project.layers.some(l=>l.name===name.trim()))return;apply(p=>({...p,layers:[...p.layers,{name:name.trim(),color:'#60a5fa',visible:true,locked:false}]}));}}>＋ Добавить слой</button></>}
      {panel==='properties'&&<><h3>Свойства объекта</h3>{selection?<div className="stack">
        <div className="property-type"><span>Тип</span><strong>{selection.kind}</strong></div>
        <label>Слой<select value={selection.layer} onChange={e=>modifyEntity({...selection,layer:e.target.value})}>{project.layers.map(l=><option key={l.name}>{l.name}</option>)}</select></label>
        <label>Источник <input value={selection.origin} disabled/></label>
        <label className="check"><input type="checkbox" checked={selection.verified} onChange={e=>modifyEntity({...selection,verified:e.target.checked})}/> Проверен по оригиналу</label>
        {['text','leader','dimension','table','stamp'].includes(selection.kind)&&<label>Текст <textarea value={selection.text||''} onChange={e=>modifyEntity({...selection,text:e.target.value})} rows={3}/></label>}
        {selection.size!==undefined&&<label>Высота текста <input type="number" step=".1" value={selection.size} onChange={e=>modifyEntity({...selection,size:Number(e.target.value)||1})}/></label>}
        {selection.offset!==undefined&&<label>Отступ размерной линии <input type="number" value={selection.offset} onChange={e=>modifyEntity({...selection,offset:Number(e.target.value)||0})}/></label>}
        {selection.radius!==undefined&&<label>Радиус <input type="number" min=".001" value={selection.radius} onChange={e=>modifyEntity({...selection,radius:Math.max(.001,Number(e.target.value)||1)})}/></label>}
        {(selection.kind==='table'||selection.kind==='stamp')&&<><label>Строки <input type="number" min="1" max="50" value={selection.rows||3} onChange={e=>modifyEntity({...selection,rows:Math.max(1,Math.round(Number(e.target.value)||1))})}/></label><label>Столбцы <input type="number" min="1" max="50" value={selection.cols||3} onChange={e=>modifyEntity({...selection,cols:Math.max(1,Math.round(Number(e.target.value)||1))})}/></label><label>Ширина <input type="number" value={selection.width||120} onChange={e=>modifyEntity({...selection,width:Number(e.target.value)||1})}/></label><label>Высота <input type="number" value={selection.height||60} onChange={e=>modifyEntity({...selection,height:Number(e.target.value)||1})}/></label></>}
        {selection.points.slice(0,12).map((pt,i)=><div className="xy" key={i}><span>P{i+1}</span><label>X<input type="number" step=".01" value={Number(pt.x.toFixed(3))} onChange={ev=>modifyEntity({...selection,points:selection.points.map((p,j)=>j===i?{...p,x:Number(ev.target.value)||0}:p)})}/></label><label>Y<input type="number" step=".01" value={Number(pt.y.toFixed(3))} onChange={ev=>modifyEntity({...selection,points:selection.points.map((p,j)=>j===i?{...p,y:Number(ev.target.value)||0}:p)})}/></label></div>)}
        <button className="danger" onClick={deleteSelected}>Удалить объект</button></div>:<p className="muted">Выберите объект инструментом ↖. Можно изменить координаты, текст, размер, слой и статус проверки.</p>}</>}
      {panel==='audit'&&<><h3>Контроль чертежа</h3><div className="stack">{issues.map((i,n)=><div key={n} className={'issue '+i.severity}><strong>{i.severity==='warning'?'⚠ Предупреждение':'ℹ Сведения'}</strong><p>{i.message}</p></div>)}</div><h3>Проверка исходника</h3><p className="muted">Включите «До / после» для сравнения. Подтвердите масштаб минимум по двум независимым размерам. Отметьте проверенные элементы в их свойствах.</p><button className="action" onClick={()=>setCompare(true)}>◫ Открыть сравнение</button><p className="notice">Аудит не заменяет нормоконтроль и инженерную проверку чертежей КМ/КМД.</p></>}
      {panel==='backups'&&<><h3>Резервные копии</h3><p className="muted">До восьми версий сохраняются в браузере. Экспорт JSON необходим для защиты от очистки данных сайта.</p><button className="action" onClick={async()=>{await createBackup(project);setBackups(await listBackups());setStatus('Резервная копия сохранена');}}>＋ Создать копию</button>{backups.map(b=><div className="backup" key={b.key}><strong>{b.name}</strong><small>{new Date(b.time).toLocaleString('ru-RU')}</small><button onClick={()=>restore(b.key)}>Восстановить</button></div>)}<button onClick={()=>exportProject(project)}>Скачать JSON на диск</button></>}
      </div>
    </aside>
  </div>
  <footer className="footer"><span>CadRecon · локальная обработка PDF и сканов · данные не отправляются на сервер</span><span>DXF / JSON · Без гарантии точности без проверки</span></footer>
 </div>;
}