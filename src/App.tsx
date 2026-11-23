import {useState,useEffect,useRef,useMemo} from 'react';
import Editor from './Editor';
import CadPalette from './CadPalette';
import ReconstructionPanel from './ReconstructionPanel';
import {assessRecognitionQuality} from './recognitionQuality';
import {proposeTraceNoiseCleanup} from './traceCleanup';
import ArchivePanel from './ArchivePanel';
import {projectReportXlsx} from './xlsxExport';
import {auditScanGeometry,scanReviewCSV} from './scanReview';
import {newProject,newSheet,newId,validateProject,type CadProject,type Entity,type Tool} from './model';
import {auditSheet,scaleSheet,translateEntity,mergeAutoLines} from './geometry';
import {createDxf} from './dxf';
import {createZip,downloadZip} from './zip';
import {applyStampFields,inventoryCSV,weldsCSV,findingsCSV,compareSpecification,specificationCSV,type SpecificationRow,type StampFields} from './archiveFeatures';
import {createBackup,downloadFile,exportProject,importProject,loadProject,listBackups,restoreBackup,saveProject} from './storage';
import {importDrawing} from './pdf';
import {traceImage} from './vectorize';
import {recognizeText,preloadOcrModels} from './ocr';
import {recognizeBrowserAccurate,uniqueCandidates} from './browserAccurate';
import {validateAdvancedEndpoint} from './advanced';
import {recognizeOnline} from './online';
import type {OperationResult} from './cadOperations';
import {repairPdfText} from './textRepair';
import {ESKD_SYMBOLS,detectESKDLabels} from './eskd';
import {reconstructDimensionChains} from './dimensions';
import {proposeAutoDimensions} from './dimensionTools';
import {cropOcrRegion,placeOcrRegionReadings,type SheetRect} from './ocrRegion';
import {evaluateOcrAccuracy,type OcrMeasurement,type OcrGolden} from './ocrMetrics';
import {parseGeometryReference,measureGeometryAgainstReference,
  type GeometryMeasurement} from './geometryMetrics';
import {arrayEntity} from './geometryTransform';
import {lineFromCoordinates,orientedLineAtPoint,tangentFromPoint,pointOnCurve} from './cadConstructions';
import {centerAxes,circleDimensionLeader} from './cadAnnotations';
import {dimensionsAlongPolyline} from './cadDimensionSeries';
import {measureCadEntity,inspectCadTopology} from './cadMeasurements';
import {rotateCadEntity,scaleCadEntity,moveCadEntity,shearCadEntity,
  polarArrayCad,alignCadLine} from './affineCad';
import type {EskdType} from './model';
type Panel='reconstruct'|'tools'|'layers'|'properties'|'audit'|'backups'|'recognition'|'archive';
const TOOLS:{id:Tool;title:string;icon:string;hotkey?:string}[]=[
  {id:'select',title:'Выделение / перенос',icon:'↖',hotkey:'V'},{id:'pan',title:'Перемещение полотна',icon:'✋',hotkey:'H'},
  {id:'point',title:'Точка',icon:'·',hotkey:'P'},
  {id:'construction-h',title:'Вспомогательная горизонталь (не печатается)',icon:'━'},
  {id:'construction-v',title:'Вспомогательная вертикаль (не печатается)',icon:'┃'},
  {id:'construction-line',title:'Вспомогательная наклонная (2 точки)',icon:'╱'},
  {id:'construction-bisector',title:'Вспомогательная биссектриса (3 точки)',icon:'⋱'},
  {id:'line',title:'Отрезок',icon:'╱',hotkey:'L'},
  {id:'line-dashed',title:'Штриховая линия (DASHED)',icon:'┄'},{id:'polyline',title:'Полилиния',icon:'〽'},
  {id:'rectangle',title:'Прямоугольник',icon:'▭',hotkey:'R'},
  {id:'rect-center',title:'Прямоугольник по центру и углу',icon:'▣'},
  {id:'polygon-inscribed',title:'Правильный многоугольник — вписанный',icon:'⬡'},
  {id:'polygon-circumscribed',title:'Правильный многоугольник — описанный',icon:'⬟'},
  {id:'trim',title:'Подрезать линию по границе',icon:'✂'},{id:'extend',title:'Продлить линию до границы',icon:'↗'},
  {id:'offset',title:'Параллельный отрезок (OFFSET)',icon:'⇢'},
  {id:'break',title:'Разорвать прямой отрезок (BREAK)',icon:'⊣'},
  {id:'join',title:'Соединить линии и полилинии (JOIN)',icon:'⤴',hotkey:'J'},
  {id:'stretch',title:'Переместить вершину (STRETCH)',icon:'⤢'},
  {id:'mirror',title:'Зеркальная копия (MIRROR)',icon:'◀'},
  {id:'chamfer',title:'Фаска двух линий',icon:'◩'},{id:'fillet',title:'Сопряжение двух линий',icon:'⌒'},
  {id:'circle',title:'Окружность: центр и радиус',icon:'◯',hotkey:'C'},
  {id:'circle-3pt',title:'Окружность по 3 точкам',icon:'◉'},
  {id:'ellipse',title:'Эллипс: центр и две оси',icon:'⬭'},
  {id:'bezier',title:'Кубическая кривая Безье (4 точки)',icon:'〰'},
  {id:'arc',title:'Дуга: центр, начало и конец',icon:'⌒'},
  {id:'arc-3pt',title:'Дуга по 3 точкам на кривой',icon:'◠'},
  {id:'dimension',title:'Размер по двум точкам',icon:'↔',hotkey:'D'},
  {id:'dimension-h',title:'Горизонтальный размер',icon:'↔'},
  {id:'dimension-v',title:'Вертикальный размер',icon:'↕'},
  {id:'dimension-3pt',title:'Размер с размещением (3 точки)',icon:'⇤'},
  {id:'axis',title:'Осевая линия',icon:'┈'},
  {id:'leader',title:'Выноска',icon:'➤'},{id:'hatch',title:'Замкнутый контур / заливка',icon:'▨'},
  {id:'text',title:'Надпись',icon:'T',hotkey:'T'},
  {id:'technical-requirements',title:'Технические требования с нумерацией',icon:'№'},
  {id:'table',title:'Таблица',icon:'▦'},
  {id:'stamp',title:'Основная надпись',icon:'▤'},
  {id:'eskd',title:'Обозначения ЕСКД',icon:'⌗'},
  {id:'measure',title:'Измерить расстояние',icon:'📏',hotkey:'M'},
  {id:'measure-angle',title:'Измерить угол между двумя LINE',icon:'∠'},
  {id:'dimension-angle',title:'Угловой размер по двум LINE (дуга и текст)',icon:'∡'},
  {id:'ocr-region',title:'OCR выделенной области (2 угла)',icon:'▧'},
  {id:'calibrate',title:'Калибровка по известному размеру',icon:'⊞'}
];
function slug(s:string){return s.replace(/[^\p{L}\p{N}._-]/gu,'_');}
export default function App(){
 const [project,setProject]=useState<CadProject>(newProject);
 const [sheetIndex,setSheetIndex]=useState(0),[tool,setTool]=useState<Tool>('select'),[selected,setSelected]=useState<string|null>(null),[panel,setPanel]=useState<Panel>('reconstruct');
 const [symbolType,setSymbolType]=useState<EskdType>('weld'),[symbolText,setSymbolText]=useState('6');
 const [onlineUrl,setOnlineUrl]=useState('http://127.0.0.1:8766'),[onlineToken,setOnlineToken]=useState('');
 const [modelsReady,setModelsReady]=useState(false);
 const [sidebarWide,setSidebarWide]=useState(false),[sidebarCollapsed,setSidebarCollapsed]=useState(false);
 const [reviewType,setReviewType]=useState<'geometry'|'text'|'semantic'>('semantic');
 const [reviewPage,setReviewPage]=useState(0);
 const [focusTarget,setFocusTarget]=useState<{id:string;token:number}|undefined>();
 const [recognitionMode,setRecognitionMode]=useState<'auto'|'hybrid'>('auto');
 const [ocrMode,setOcrMode]=useState<'standard'|'enhanced'>('enhanced');
 const [ocrLanguages,setOcrLanguages]=useState<'rus+eng'|'rus'|'eng'>('rus+eng');
 const [ocrVertical,setOcrVertical]=useState(false);
 const [ocrBenchmark,setOcrBenchmark]=useState<{sheetId:string;result:OcrMeasurement}|null>(null);
 const [geometryBenchmark,setGeometryBenchmark]=useState<{sheetId:string;result:GeometryMeasurement}|null>(null);
 const onlineController=useRef<AbortController|null>(null);
 const localController=useRef<AbortController|null>(null);
 const [localBusy,setLocalBusy]=useState(false);
 const [source,setSource]=useState(true),[compare,setCompare]=useState(false),[snap,setSnap]=useState(true),[grid,setGrid]=useState(false),[busy,setBusy]=useState(''),[status,setStatus]=useState('Загрузите PDF или скан, чтобы начать.'),[ocrText,setOcrText]=useState('');
 const [backups,setBackups]=useState<{key:string;time:number;name:string}[]>([]),[loaded,setLoaded]=useState(false);
 const input=useRef<HTMLInputElement>(null),jsonInput=useRef<HTMLInputElement>(null),undo=useRef<CadProject[]>([]),redo=useRef<CadProject[]>([]);
 const sheet=project.sheets[Math.min(sheetIndex,project.sheets.length-1)]||project.sheets[0];
 function apply(update:(p:CadProject)=>CadProject){setProject(prev=>{const next=update(prev);if(next===prev)return prev;undo.current.push(prev);if(undo.current.length>35)undo.current.shift();redo.current=[];return {...next,updated:new Date().toISOString()};});}
 function undoAction(){if(!undo.current.length)return;const next=undo.current.pop()!;redo.current.push(project);setProject(next);setSelected(null);}
 function redoAction(){if(!redo.current.length)return;const next=redo.current.pop()!;undo.current.push(project);setProject(next);setSelected(null);}
 function changeSheet(fn:(s:typeof sheet)=>typeof sheet){apply(p=>({...p,sheets:p.sheets.map((s,i)=>i===sheetIndex?fn(s):s)}));}
 function addEntities(es:Entity[]){if(!es.length)return;changeSheet(s=>({...s,entities:[...s.entities,...es]}));setStatus('Добавлено объектов: '+es.length);}
 function addToOriginalSheet(id:string,es:Entity[]){if(!es.length)return;apply(p=>p.sheets.some(x=>x.id===id)?({...p,sheets:p.sheets.map(x=>x.id===id?{...x,entities:[...x.entities,...es]}:x)}):p);}
 function modifyEntity(e:Entity,explicitReview=false){const edited=explicitReview?e:{...e,verified:false,reason:'Объект изменён: требуется повторная проверка по оригиналу'};changeSheet(s=>({...s,entities:s.entities.map(x=>x.id===e.id?edited:x)}));}
 function applyOperation(result:OperationResult){
  const ids=new Set(result.replacements.map(e=>e.id));
  const deleted=new Set(result.removals||[]);
  changeSheet(s=>({...s,entities:[
    ...s.entities.filter(e=>!deleted.has(e.id)).map(e=>ids.has(e.id)?result.replacements.find(x=>x.id===e.id)!:e),
    ...result.additions]}));
  setSelected(null);
  setStatus('CAD: изменено '+result.replacements.length+' объектов, добавлено '+result.additions.length+
    ', удалено '+deleted.size+'. Проверьте размеры и геометрию.');
 }
 async function closeSheet(index:number){
   if(busy){setStatus('Дождитесь завершения обработки перед закрытием листа.');return;}
   const target=project.sheets[index];if(!target)return;
   const last=project.sheets.length===1;
   const question='Закрыть лист «'+target.name+'»?\n'+
     (last?'Будет открыт новый пустой лист.':'Лист будет удалён из текущего проекта.')+
     '\nПеред закрытием создаётся резервная копия; действие можно отменить (Ctrl+Z).';
   if(!window.confirm(question))return;
   try{await createBackup(project);}
   catch(e){setStatus('Лист НЕ закрыт: резервное копирование не удалось: '+String(e));return;}
   apply(p=>{
     const sheets=p.sheets.filter(s=>s.id!==target.id);
     return sheets.length?{...p,sheets}:{...p,sheets:[newSheet()]};
   });
   setSheetIndex(current=>index<current?current-1:Math.min(current,Math.max(0,project.sheets.length-2)));
   setSelected(null);setFocusTarget(undefined);
   setStatus('Лист «'+target.name+'» закрыт. Ctrl+Z — вернуть. Резервная копия сохранена.');
 }
 function transformSelected(kind:'rotate'|'scale'|'move'|'shear'|'polar'){
   const source=sheet.entities.find(e=>e.id===selected);
   if(!source){setStatus('CAD: сперва выделите один примитив.');return;}
   const pivot=source.center||source.points[0];
   if(!pivot){setStatus('CAD: у объекта нет опорной точки.');return;}
   const variants={
     rotate:['Поворот вокруг опорной точки ('+pivot.x.toFixed(1)+'; '+pivot.y.toFixed(1)+'), угол в градусах','45'],
     scale:['Масштабирование относительно опорной точки. Коэффициент >0','1.5'],
     move:['Точный перенос ΔX;ΔY (единицы листа, не обязательно мм)','20;10'],
     shear:['Деформация сдвигом по X относительно опорной точки, коэффициент (-5..5)','0.3'],
     polar:['Круговой массив: количество (2–64); угол разворота (0..360); центр X; центр Y',
       '6;360;'+pivot.x.toFixed(2)+';'+pivot.y.toFixed(2)],
   } as const;
   const raw=window.prompt(variants[kind][0],variants[kind][1]);
   if(raw===null)return;
   const fields=raw.split(';').map(s=>s.trim());
   const numbers=fields.map(s=>s?Number(s.replace(',','.')):NaN);
   if((kind==='move'&&numbers.length!==2)||(kind==='polar'&&numbers.length!==4)||
     (kind!=='move'&&kind!=='polar'&&numbers.length!==1)||
     !numbers.every(Number.isFinite)){
     setStatus('CAD: неправильные числа. Для нескольких значений используйте «;».');return;
   }
   const op=kind==='rotate'?rotateCadEntity(source,pivot,numbers[0]):
     kind==='scale'?scaleCadEntity(source,pivot,numbers[0]):
     kind==='move'?moveCadEntity(source,numbers[0],numbers[1]):
     kind==='shear'?shearCadEntity(source,pivot,numbers[0]):
     polarArrayCad(source,{x:numbers[2],y:numbers[3]},numbers[0],numbers[1]);
   if(!op){
     setStatus('CAD: неподдерживаемая геометрия или недопустимые параметры. Окружности и дуги нельзя деформировать сдвигом.');return;
   }
   if(kind==='polar'&&!window.confirm('Создать '+op.additions.length+' новых объектов кругового массива? Оригинал сохранится.'))return;
   applyOperation(op);
 }
 function alignSelected(axis:'horizontal'|'vertical'){
   const source=sheet.entities.find(e=>e.id===selected);
   if(!source)return;
   const operation=alignCadLine(source,axis);
   if(!operation){setStatus('Выравнивание поддерживает один обычный прямой LINE.');return;}
   applyOperation(operation);
 }
 function constructSelected(kind:'coordinates'|'parallel'|'perpendicular'|'tangent-left'|'tangent-right'|'point-on-curve'){
   const source=sheet.entities.find(e=>e.id===selected);
   const missing=kind!=='coordinates'&&!source;
   if(missing){setStatus('Построение: сначала выделите опорную линию, окружность или кривую.');return;}
   const defaults={
     coordinates:'0;0;100;0',
     parallel:'20;20;100;0',
     perpendicular:'20;20;100;0',
     'tangent-left':'150;100',
     'tangent-right':'150;100',
     'point-on-curve':'0.5',
   };
   const prompts={
     coordinates:'Точный отрезок: X1;Y1;X2;Y2 (единицы листа)',
     parallel:'Параллельный LINE: X начала;Y начала;длина;реверс (0 или 1)',
     perpendicular:'Перпендикулярный LINE: X начала;Y начала;длина;реверс (0 или 1)',
     'tangent-left':'Касательная к окружности: X;Y внешней точки, решение слева',
     'tangent-right':'Касательная к окружности: X;Y внешней точки, решение справа',
     'point-on-curve':'Точка на выбранной кривой: параметр t от 0 до 1',
   };
   const raw=window.prompt(prompts[kind],defaults[kind]);
   if(raw===null)return;
   const parts=raw.split(';').map(v=>v.trim());
   const values=parts.map(v=>v?Number(v.replace(',','.')):NaN);
   const expected=kind==='coordinates'||kind==='parallel'||kind==='perpendicular'?4:
     kind==='point-on-curve'?1:2;
   if(values.length!==expected||!values.every(Number.isFinite)){
     setStatus('Построение: нужны '+expected+' числовых значения через «;» (для дробей используйте точку).');return;
   }
   const e=kind==='coordinates'?lineFromCoordinates(values[0],values[1],values[2],values[3]):
     kind==='parallel'||kind==='perpendicular'?
       orientedLineAtPoint(source!,{x:values[0],y:values[1]},kind,
         values[2],values[3]===1):
     kind==='tangent-left'||kind==='tangent-right'?
       tangentFromPoint(source!,{x:values[0],y:values[1]},
         kind==='tangent-left'?'left':'right'):
       pointOnCurve(source!,values[0]);
   if(!e){setStatus('Построение: геометрия или параметры недопустимы. Касательная требует внешней точки вне окружности.');return;}
   addEntities([e]);
   setStatus('CAD: создано точное геометрическое построение. Оно не является постоянной параметрической связью.');
 }
 function makeRectangularArray(){
   const source=sheet.entities.find(e=>e.id===selected);
   if(!source){setStatus('ARRAY: сначала выделите объект инструментом «Выделение».');return;}
   const raw=window.prompt('Прямоугольный массив: столбцы; строки; шаг X; шаг Y (единицы листа)','3;2;40;30');
   if(raw===null)return;
   const values=raw.split(';').map(v=>Number(v.trim().replace(',','.')));
   if(values.length!==4){setStatus('ARRAY: нужно ровно 4 значения через «;».');return;}
   const result=arrayEntity(source,values[0],values[1],values[2],values[3]);
   if(!result){setStatus('ARRAY: допустимы 1–20 строк/столбцов и максимум 100 объектов, ненулевые шаги; поддерживаются POINT/LINE/POLYLINE/CIRCLE.');return;}
   if(!window.confirm('Создать '+result.additions.length+' независимых CAD-копий? Исходный объект останется без изменений; отмена Ctrl+Z.'))return;
   applyOperation(result);
 }
 function createDimensionSeries(mode:'chain'|'baseline'){
   const source=sheet.entities.find(e=>e.id===selected);
   if(source?.kind!=='polyline'){
     setStatus('Размерная серия: выберите открытую или замкнутую полилинию со списком вершин.');return;
   }
   const proposed=dimensionsAlongPolyline(source,sheet,mode);
   if(!proposed){setStatus('Размерная серия: требуется полилиния из 3–40 различных вершин.');return;}
   if(!window.confirm('Создать '+proposed.length+' неподтверждённых '+(mode==='chain'?'цепных':'базовых')+
     ' размеров по узлам полилинии? Эти размеры НЕ обновляются автоматически при редактировании.'))return;
   addEntities(proposed);
   setStatus('Создано '+proposed.length+' предварительных размеров по '+
     (mode==='chain'?'цепочке':'общей базе')+'. Нужна проверка расположения и значений.');
 }
 function annotateCircle(kind:'radius'|'diameter'|'axes'){
   const selectedCircle=sheet.entities.find(e=>e.id===selected);
   if(!selectedCircle||selectedCircle.kind!=='circle'){
     setStatus('Размер окружности и центровые оси: сначала выделите окружность.');return;
   }
   if(kind==='axes'){
     const axes=centerAxes(selectedCircle,sheet.entities);
     if(!axes.length){setStatus('Оси окружности: уже существуют или геометрия некорректна.');return;}
     addEntities(axes);
     setStatus('Добавлено две оси окружности. Не экспортировать, пока не проверено назначение.');
     return;
   }
   const d=circleDimensionLeader(selectedCircle,sheet,kind);
   if(!d){setStatus('Размер окружности: некорректная геометрия.');return;}
   addEntities([d]);
   setStatus('Создана выноска '+(kind==='radius'?'радиуса':'диаметра')+
     '. Не является ассоциативным CAD-размером; сверьте число с оригиналом.');
 }
 function makeAutoDimensions(mode:'selected'|'all'){
   const targets=mode==='selected'?
     sheet.entities.filter(e=>e.id===selected):
     sheet.entities.filter(e=>e.kind==='line'||e.kind==='circle');
   const review=proposeAutoDimensions(sheet,targets);
   if(!review.additions.length){
     setStatus('Авторазмер: подходящих объектов без готового связанного размера нет.');
     return;
   }
   const message='Создать '+review.additions.length+' неподтверждённых размеров? '+
     (sheet.calibrated?'Числа основаны только на текущей калиброванной CAD-геометрии.':
       'Лист НЕ калиброван: числовые значения заменяются знаком «?».')+
     '\nПроверьте каждый результат по оригиналу. '+(review.limited?'Не более 200 за операцию.':'');
   if(!window.confirm(message))return;
   addEntities(review.additions);
   setStatus('Авторазмер: создано '+review.additions.length+
     ' кандидатов. '+(sheet.calibrated?'Проверьте геометрию и масштаб.':'Сначала установите масштаб по известному размеру.'));
 }
 function cleanupTraceNoise(){
   const review=proposeTraceNoiseCleanup(sheet.entities);
   if(!review.eligible){
     setStatus('Автообводка: явных кандидатов шума по трём строгим признакам не найдено. Непроверенные линии сохранены.');
     return;
   }
   const message='Очистка шумовых гипотез W3: найдено '+review.eligible+
     ' из '+review.examined+' автоотрезков.\n'+review.reason+
     '\nУдалить ТОЛЬКО эти неподтверждённые сплошные кандидаты? Можно отменить Ctrl+Z.';
   if(!window.confirm(message))return;
   const ids=new Set(review.ids);
   changeSheet(s=>({...s,entities:s.entities.filter(e=>!ids.has(e.id))}));
   setSelected(null);
   setStatus('Удалено явно слабых автоотрезков: '+review.eligible+
     '. Штриховые/осевые, PDF, подтверждённые и ручные объекты сохранены. Отмена: Ctrl+Z.');
 }
 function deleteSelected(){if(!selected)return;const e=sheet.entities.find(e=>e.id===selected);const layer=project.layers.find(l=>l.name===e?.layer);if(layer?.locked){setStatus('Слой заблокирован');return;}changeSheet(s=>({...s,entities:s.entities.filter(e=>e.id!==selected)}));setSelected(null);}
 useEffect(()=>{loadProject().then(p=>{if(p){setProject(p);setStatus('Локальный проект восстановлен');}}).catch(e=>setStatus('Хранилище недоступно: '+e)).finally(()=>setLoaded(true));},[]);
 useEffect(()=>{if(!loaded)return;const t=setTimeout(()=>saveProject(project).catch(e=>setStatus('Не удалось сохранить проект локально: '+e)),1400);return()=>clearTimeout(t);},[project,loaded]);
 useEffect(()=>{function key(ev:KeyboardEvent){
    if((ev.ctrlKey||ev.metaKey)&&ev.key.toLowerCase()==='k'&&!busy){
      ev.preventDefault();setPanel('tools');setSidebarCollapsed(false);
      requestAnimationFrame(()=>document.getElementById('cad-command-search')?.focus());
      return;
    }
    const el=ev.target as HTMLElement;
    if(['INPUT','TEXTAREA','SELECT'].includes(el?.tagName)||busy)return;if((ev.ctrlKey||ev.metaKey)&&ev.key.toLowerCase()==='z'){ev.preventDefault();undoAction();}else if((ev.ctrlKey||ev.metaKey)&&ev.key.toLowerCase()==='y'){ev.preventDefault();redoAction();}else if((ev.key==='Delete'||ev.key==='Backspace')&&selected){ev.preventDefault();deleteSelected();}else if(!ev.ctrlKey&&!ev.metaKey){const found=TOOLS.find(t=>t.hotkey?.toLowerCase()===ev.key.toLowerCase());if(found)setTool(found.id);}}
 window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[project,selected,busy]);
 async function handleDrawing(files:FileList|null){if(!files?.length)return;const pendingFiles=Array.from(files);const firstName=pendingFiles[0].name;setBusy('Импорт документа…');try{const nextSheets:CadProject['sheets']=[];for(const f of pendingFiles){const parts=await importDrawing(f,setBusy);nextSheets.push(...parts);}await createBackup(project);apply(p=>({...p,name:p.name==='Новый проект'?firstName:p.name,sheets:[...(p.sheets.length===1&&!p.sheets[0].entities.length&&!p.sheets[0].image?[]:p.sheets),...nextSheets]}));setSheetIndex(project.sheets.length===1&&!project.sheets[0].entities.length&&!project.sheets[0].image?0:project.sheets.length);setSelected(null);
  const warnings=nextSheets.flatMap(sheet=>sheet.importWarnings||[]);
  if(warnings.length){
    setPanel('reconstruct');
    setStatus('Импортировано листов: '+nextSheets.length+'. ⚠ Неполный импорт: '+warnings.slice(0,2).join('; '));
  }else {setPanel('reconstruct');setStatus('Импортировано листов: '+nextSheets.length+'. Векторные элементы PDF требуют проверки.');}
 }catch(e){setStatus('Ошибка импорта: '+String(e));}finally{setBusy('');if(input.current)input.current.value='';}}
 async function handleProject(files:FileList|null){if(!files?.length)return;setBusy('Открытие проекта…');try{const p=await importProject(files[0]);await createBackup(project);setProject(p);undo.current=[];redo.current=[];setSheetIndex(0);setSelected(null);setStatus('Проект открыт: '+p.name);}catch(e){setStatus('Ошибка проекта: '+String(e));}finally{setBusy('');if(jsonInput.current)jsonInput.current.value='';}}
 async function vectorize(){
   if(localController.current)return;
   const ctrl=new AbortController(),sheetId=sheet.id;localController.current=ctrl;setLocalBusy(true);
   setBusy('Обработка скана в полном разрешении…');
   try{
     const r=await traceImage(sheet,12,setBusy,'detailed',ctrl.signal);
     if(ctrl.signal.aborted)return;
     addToOriginalSheet(sheetId,r.entities);setStatus(r.note);
   }catch(e){setStatus(ctrl.signal.aborted?'Обводка отменена пользователем.':'Обводка: '+String(e));}
   finally{localController.current=null;setLocalBusy(false);setBusy('');}
 }
 async function prepareBrowserOcr(){
   setBusy('Загрузка OCR-моделей RU/EN на компьютер пользователя…');
   try{
     await preloadOcrModels(setBusy);
     setModelsReady(true);
     setStatus('Языковые модели RU/EN готовы в браузере. Сохранение на будущие сеансы зависит от кэша браузера.');
   }catch(e){setStatus('Не удалось загрузить языковые модели OCR: '+String(e)+'. Проверьте интернет и настройки браузера.');}
   finally{setBusy('');}
 }
 async function browserAccurateProcessing(){
   if(localController.current)return;
   if(!sheet.image){setStatus('Сначала загрузите PDF или скан.');return;}
   const ctrl=new AbortController(),sheetId=sheet.id;
   localController.current=ctrl;setLocalBusy(true);
   setBusy('Точная реконструкция непосредственно в браузере…');
   try{
     const result=await recognizeBrowserAccurate(sheet,setBusy,ctrl.signal,recognitionMode,ocrLanguages,ocrVertical);
     if(ctrl.signal.aborted)return;
     addToOriginalSheet(sheetId,result.entities);
     if(result.ocrText)setOcrText(result.ocrText);
     setReviewType(result.scanned?'geometry':'semantic');setReviewPage(0);
     setPanel('recognition');
     setStatus(result.note+(result.warnings.length?' Предупреждения: '+result.warnings.slice(0,2).join('; '):''));
   }catch(e){setStatus(ctrl.signal.aborted?'Распознавание отменено.':'Браузерное распознавание: '+String(e)+'. Попробуйте обводку и OCR по отдельности.');}
   finally{localController.current=null;setLocalBusy(false);setBusy('');}
 }
 async function onlineProcessing(){
   if(!sheet.image){setStatus('Сначала загрузите PDF или скан');return;}
   let url:string;
   try{url=validateAdvancedEndpoint(onlineUrl);}catch(e){setStatus('Ultra: '+e);return;}
   if(!onlineToken.trim()){setStatus('Ultra: введите токен локального модуля.');return;}
   if(!window.confirm('Усиленная обработка на ЭТОМ компьютере: '+url+
     '\nЭто дополнительный локальный пакет, который пользователь устанавливает самостоятельно. '
     +'Внешний сервер CadRecon не используется. Продолжить?'))return;
   const controller=new AbortController();onlineController.current=controller;
   setBusy('Ultra локально: обработка на этом компьютере…');
   try{
     const result=await recognizeOnline(sheet,url,onlineToken,setBusy,controller.signal);
     addEntities(result.entities);setStatus(result.note);setPanel('recognition');
   }catch(e){setStatus('Ultra локально: '+String(e)+'. Проверьте установку локального пакета, токен и доступ к 127.0.0.1.');}
   finally{onlineController.current=null;setBusy('');}
 }
 function repairImportedPdfText(){
  let changed=0;
  changeSheet(s=>({...s,entities:s.entities.map(e=>{
    if(e.kind!=='text'||e.origin!=='pdf'||!e.text)return e;
    const fix=repairPdfText(e.text);
    if(!fix.changed)return e;
    changed++;return {...e,text:fix.text,reason:fix.reason,confidence:fix.confidence,verified:false};
  })}));
  setStatus('Исправлено надписей с предполагаемой ошибкой кодировки: '+changed+
    '. Проверьте текст по оригиналу.');
 }
 async function mergeLines(){
  if(!window.confirm('Удалить только перекрывающиеся автоматические LINE? Разрывы не соединяются, ручные и проверенные объекты сохраняются. Перед применением сделайте резервную копию.'))return;
  try{await createBackup(project);const result=mergeAutoLines(sheet.entities,Math.max(.7,Math.min(sheet.width,sheet.height)/3000));
    if(result.removed)changeSheet(s=>({...s,entities:result.entities}));
    setStatus('Убрано геометрически перекрывающихся автоотрезков: '+result.removed+'. Разрывы не соединялись; проверьте результат.');
  }catch(e){setStatus('Объединение линий: '+e);}
 }
 async function runSemanticRecognition(){
   if(localController.current)return;
   if(!sheet.image&&!sheet.entities.length){setStatus('Сначала загрузите чертёж.');return;}
   const ctrl=new AbortController(),sheetId=sheet.id;
   localController.current=ctrl;setLocalBusy(true);
   setBusy('Восстановление размерных цепочек и обозначений ЕСКД…');
   try{
     let source=sheet.entities;
     if(!source.some(e=>e.kind==='text'&&e.origin!=='manual')&&sheet.image){
       setBusy('OCR: распознавание надписей...');
       const o=await recognizeText(sheet,setBusy,ctrl.signal,
         {mode:'enhanced',languages:ocrLanguages,detectVertical:ocrVertical,maxRetries:35});
       if(ctrl.signal.aborted)return;
       source=[...source,...o.entities];setOcrText(o.text);
     }
     if(!source.some(e=>e.kind==='line'&&e.origin!=='manual')&&sheet.image){
       setBusy('Анализ линий, выносок и цепочек...');
       const v=await traceImage(sheet,12,setBusy,'detailed',ctrl.signal);
       if(ctrl.signal.aborted)return;
       source=[...source,...v.entities];
     }
     if(ctrl.signal.aborted)return;
     setBusy('Анализ размерных цепочек и ЕСКД...');
     const extracted=source.filter(e=>!sheet.entities.some(old=>old.id===e.id));
     const recognized=reconstructDimensionChains({...sheet,entities:source});
     const symbols=detectESKDLabels(source);
     const existing=new Set(sheet.entities.filter(e=>e.sourceId).map(e=>e.sourceId+'|'+e.kind));
     const newDims=recognized.dimensions.filter(e=>!existing.has(e.sourceId+'|'+e.kind));
     const newSymbols=symbols.filter(e=>!existing.has(e.sourceId+'|'+e.kind));
     const fresh=[...extracted,...newDims,...newSymbols];
     if(ctrl.signal.aborted)return;
     if(fresh.length)addToOriginalSheet(sheetId,fresh);
     setReviewType('semantic');setReviewPage(0);setPanel('recognition');
     setStatus('Автоанализ: '+newDims.length+' размерных объектов, '+newSymbols.length+
       ' обозначений ЕСКД, '+recognized.chains.length+
       ' цепочек. Все требуют проверки.');
   }catch(err){
     setStatus(ctrl.signal.aborted?'Автоанализ отменён.':
       'Ошибка семантического распознавания: '+String(err));
   }finally{
     localController.current=null;setLocalBusy(false);setBusy('');
   }
 }
 async function measureOcrAccuracy(file:File|null){
   if(!file)return;
   if(!sheet.image){setStatus('OCR эталон: откройте лист со сканом.');return;}
   if(file.size>500000){setStatus('OCR эталон: файл больше 500 КБ. Используйте отдельные листы.');return;}
   const source=sheet;
   try{
     const raw=JSON.parse(await file.text()) as unknown;
     if(!Array.isArray(raw)||raw.length>2000||raw.some(row=>{
       if(!row||typeof row!=='object')return true;
       const e=row as Record<string,unknown>;
       return typeof e.id!=='string'||typeof e.text!=='string'||e.text.length>1000||
         !['x0','y0','x1','y1'].every(k=>typeof e[k]==='number'&&Number.isFinite(e[k]));
     }))throw new Error('ожидается массив не более 2000 строк {id,text,x0,y0,x1,y1}');
     const img=new Image();img.src=source.image!;await img.decode();
     if(!img.naturalWidth||!img.naturalHeight)throw new Error('подложка не загружена');
     const sx=img.naturalWidth/source.width,sy=img.naturalHeight/source.height;
     const recognized=source.entities
       .filter(e=>e.kind==='text'&&e.origin==='ocr'&&e.bbox)
       .map(e=>({text:e.text||'',x0:e.bbox!.x0*sx,x1:e.bbox!.x1*sx,
         y0:e.bbox!.y0*sy,y1:e.bbox!.y1*sy}));
     const result=evaluateOcrAccuracy(raw as OcrGolden[],recognized);
     setOcrBenchmark({sheetId:source.id,result});
     setStatus('OCR эталон: выполнено сравнение '+raw.length+' размеченных надписей с '+
       recognized.length+' OCR-кандидатами. Это локальная оценка, не инженерное подтверждение.');
   }catch(error){setStatus('OCR эталон: '+String(error));}
 }
 async function downloadGeometryTemplate(){
    if(!sheet.image){setStatus('Геометрический эталон: сначала откройте чертёж.');return;}
    try{
      const img=new Image();img.src=sheet.image;await img.decode();
      const template={version:1,reviewed:false,scope:'partial',imageWidth:img.naturalWidth,
        imageHeight:img.naturalHeight,lines:[],circles:[]};
      downloadFile(JSON.stringify(template,null,2),'CadRecon-geometry-reference-template.json','application/json');
      setStatus('Скачана пустая разметка в исходных пикселях. Добавьте проверенные LINE/CIRCLE и выставьте reviewed=true только после инженерной проверки.');
    }catch(err){setStatus('Эталон геометрии: '+String(err));}
  }
  async function measureGeometryAccuracy(file:File|null){
    if(!file)return;
    if(!sheet.image){setStatus('Эталон геометрии: сначала откройте чертёж.');return;}
    if(file.size>500000){setStatus('Эталон геометрии: файл JSON больше 500 КБ.');return;}
    const source=sheet;
    try{
      const reference=parseGeometryReference(JSON.parse(await file.text()) as unknown);
      const img=new Image();img.src=source.image!;await img.decode();
      if(img.naturalWidth!==reference.imageWidth||img.naturalHeight!==reference.imageHeight)
        throw new Error('размеры эталона '+reference.imageWidth+'×'+reference.imageHeight+
          ' не совпадают с подложкой '+img.naturalWidth+'×'+img.naturalHeight);
      const result=measureGeometryAgainstReference(reference,source.entities,
        {width:source.width,height:source.height});
      setGeometryBenchmark({sheetId:source.id,result});
      setPanel('recognition');
      setStatus('Локальное сравнение геометрии: '+result.expectedLines+
        ' LINE и '+result.expectedCircles+' CIRCLE. Область разметки: '+
        (reference.scope==='partial'?'частичная':'полная')+
        '. Пиксельные метрики не являются точностью в мм.');
    }catch(error){setStatus('Эталон геометрии: '+String(error));}
  }
  async function recognizeArea(rect:SheetRect){
   if(localController.current){setStatus('OCR области: предыдущая обработка ещё выполняется.');return;}
   const ctrl=new AbortController(),sheetId=sheet.id;
   localController.current=ctrl;setLocalBusy(true);
   setBusy('OCR выделенной области: подготовка фрагмента…');
   try{
     const cropped=await cropOcrRegion(sheet,rect);
     if(ctrl.signal.aborted)return;
     const result=await recognizeText(cropped.sheet,setBusy,ctrl.signal,{
       mode:ocrMode,languages:ocrLanguages,detectVertical:ocrVertical,maxRetries:60,
     });
     if(ctrl.signal.aborted)return;
     const shifted=placeOcrRegionReadings(result.entities,cropped.offset);
     apply(p=>{
       const original=p.sheets.find(s=>s.id===sheetId);
       if(!original)return p;
       const fresh=uniqueCandidates(original.entities,shifted);
       return fresh.length?{...p,sheets:p.sheets.map(s=>s.id===sheetId?
         {...s,entities:[...s.entities,...fresh]}:s)}:p;
     });
     setOcrText(result.text);setReviewType('text');setReviewPage(0);setPanel('recognition');
     setStatus('OCR области: найдено '+shifted.length+' строк, размер '+
       cropped.pixels.width+'×'+cropped.pixels.height+' пикселей. '+
       (result.diagnostics?.conflicts?'Есть неоднозначные символы: '+result.diagnostics.conflicts+'. ':'')+
       'Сверьте текст по оригиналу; повторные надписи не добавляются.');
   }catch(e){
     setStatus(ctrl.signal.aborted?'OCR области отменён.':'OCR области: '+String(e));
   }finally{
     localController.current=null;setLocalBusy(false);setBusy('');setTool('select');
   }
 }
 async function runOcr(){
   if(localController.current)return;
   const ctrl=new AbortController(),sheetId=sheet.id;localController.current=ctrl;setLocalBusy(true);
   setBusy('Распознавание текста…');
   try{
     const r=await recognizeText(sheet,setBusy,ctrl.signal,
       {mode:ocrMode,languages:ocrLanguages,detectVertical:ocrVertical,maxRetries:60});
     if(ctrl.signal.aborted)return;
     setOcrText(r.text);
     // On repeated runs never append the same recognized OCR text again.
     // Keep existing manual/verified edits and only add genuinely new labels.
     apply(p=>{
       const original=p.sheets.find(s=>s.id===sheetId);
       if(!original)return p;
       const fresh=uniqueCandidates(original.entities,r.entities);
       return fresh.length?{...p,sheets:p.sheets.map(s=>s.id===sheetId?
         {...s,entities:[...s.entities,...fresh]}:s)}:p;
     });
     setReviewType('text');setReviewPage(0);setPanel('recognition');
     const d=r.diagnostics;
     setStatus('OCR: '+r.entities.length+' строк; '+
       (d?d.retried+' повторных проверок, '+d.duplicates+' дублей убрано, '+
         d.conflicts+' расхождений отмечено. ':'')+
       (r.warnings?.length?r.warnings.join('; ')+' ':'')+
       'Проверьте надписи и размеры по оригиналу.');
   }catch(e){setStatus(ctrl.signal.aborted?'OCR отменён.':'OCR: '+String(e));}
   finally{localController.current=null;setLocalBusy(false);setBusy('');}
 }
 function exportAllDxf(){
   const uncalibrated=project.sheets.filter(s=>!s.calibrated);
   const unverified=project.sheets.reduce((n,s)=>n+s.entities.filter(e=>!e.verified).length,0);
   const warnings:string[]=[];
   if(uncalibrated.length)warnings.push('Некалиброванных листов: '+uncalibrated.length+'. Экспорт с условными единицами.');
   if(unverified)warnings.push('Непроверенных геометрических, текстовых и ЕСКД-объектов: '+unverified+'. Инженерная точность не подтверждена.');
   if(warnings.length&&!window.confirm(warnings.join('\n')+'\nВыгрузить DXF для проверки в CAD?'))return;
   try{
     const files:Array<{name:string;data:string|Uint8Array}>=project.sheets.map((s,i)=>({name:String(i+1).padStart(2,'0')+'_'+slug(s.name)+'.dxf',data:createDxf(s,project)}));
     downloadZip(createZip(files),slug(project.name)+'_all_DXF.zip');
     setStatus('Архив '+files.length+' DXF-листов сохранён');
   }catch(e){setStatus('Ошибка пакетного DXF: '+e);}
 }
 function exportDxf(){
  const unverified=sheet.entities.filter(e=>!e.verified).length;
  const warnings:string[]=[];
  if(!sheet.calibrated)warnings.push('Масштаб листа не подтверждён: DXF будет экспортирован в условных единицах.');
  if(unverified)warnings.push('Непроверенных объектов: '+unverified+'. Проверьте их по оригиналу и контрольным размерам.');
  if(warnings.length&&!window.confirm(warnings.join('\n')+'\nПродолжить экспорт DXF?'))return;
  try{downloadFile(createDxf(sheet,project),slug(project.name)+'_'+slug(sheet.name)+'.dxf','application/dxf');setStatus('DXF экспортирован. Проверьте его в целевой CAD-системе.');}catch(e){setStatus('Ошибка DXF: '+e);}}
 async function showBackups(){try{setBackups(await listBackups());setPanel('backups');}catch(e){setStatus('Резервные копии: '+e);}}
 async function restore(key:string){if(!window.confirm('Восстановить эту копию? Текущий проект предварительно будет сохранён.'))return;try{await createBackup(project);const p=await restoreBackup(key);setProject(p);setSheetIndex(0);setSelected(null);setStatus('Резервная копия восстановлена');}catch(e){setStatus('Восстановление: '+e);}}
 function newDocument(){if(!window.confirm('Создать новый проект? Текущий останется в резервной копии.'))return;createBackup(project).catch(()=>{});setProject(newProject());setSheetIndex(0);setSelected(null);undo.current=[];redo.current=[];}
 function focusEntity(si:number,id:string,edit=false){
   if(!project.sheets[si]?.entities.some(e=>e.id===id)){
     setStatus('Объект не найден в текущем проекте');return;
   }
   setSheetIndex(si);
   setSelected(id);
   setTool('select');
   setFocusTarget({id,token:Date.now()+Math.random()});
   if(edit)setPanel('properties');
 }
 function importSpecification(rows:SpecificationRow[]){
   apply(p=>({...p,specification:rows.map(r=>({...r}))}));
 }
 function applyStamp(data:StampFields,scope:'current'|'all'){
   apply(p=>applyStampFields(p,data,scope,sheetIndex));
   setStatus('Штамп заполнен в '+(scope==='all'?'проекте':'текущем листе')+
     '. Объекты остались непроверенными; используйте Undo при ошибке.');
 }
 function exportPackage(){
   const safe=(text:string)=>slug(text).slice(0,75)||'CadRecon';
   const warn=project.sheets.reduce((n,s)=>n+s.entities.filter(e=>!e.verified).length,0);
   const files:Array<{name:string;data:string|Uint8Array}>=project.sheets.map((s,i)=>({
     name:'DXF/'+String(i+1).padStart(2,'0')+'_'+safe(s.name)+'.dxf',
     data:createDxf(s,project),
   }));
   files.push({name:'Отчеты/Объекты.csv',data:inventoryCSV(project)});
   files.push({name:'Отчеты/Диагностика_топологии_W3.csv',data:scanReviewCSV(auditScanGeometry(project))});
   files.push({name:'Отчеты/Сводный_отчет.xlsx',data:projectReportXlsx(project)});
   files.push({name:'Отчеты/Сварные_обозначения.csv',data:weldsCSV(project)});
   if(project.specification?.length){
     files.push({name:'Отчеты/Спецификация.csv',data:specificationCSV(project.specification)});
     files.push({name:'Отчеты/Сверка_позиций.csv',data:findingsCSV(compareSpecification(project,project.specification))});
   }
   const json=JSON.stringify(project);
   const included=json.length<30_000_000;
   if(included)files.push({name:'Проект/Исходные_данные.cadrecon.json',data:json});
   else files.push({name:'Проект/ВАЖНО_размер_проекта.txt',data:
     'JSON с растровыми подложками не включён: размер больше 30 МБ. Скачайте резервную копию JSON отдельно в верхней панели.'});
   // 2D PDF->DXF only: no empty 3D/STEP/SolidWorks folders.
   for(const [folder,description] of [
     ['Печать/PDF','Для исходных 2D PDF, вложенных вручную.'],
     ['Архив','Для проверенных версий и истории 2D проекта.'],
   ]){
     files.push({name:folder+'/ИНСТРУКЦИЯ.txt',data:description+
       '\nCadRecon не создавал эти нативные файлы автоматически.\n'});
   }
   files.push({name:'README.txt',data:[
      'CadRecon — архив локального проекта.','Хостинг: GitHub Pages. Исходная КД на сервер не загружалась.',
      'Проект: '+project.name,'Листов: '+project.sheets.length,'Непроверенных CAD-кандидатов: '+warn,
      'Некалиброванных листов: '+project.sheets.filter(s=>!s.calibrated).length,
      'DXF только для инженерной проверки; без калибровки единицы условные.',
      'Отчёты об объектах, сварке и позициях не являются автоматическим нормоконтролем.',
      'Диагностика W3: потенциальные разрывы и слабые штрихи требуют проверки исходного изображения. Единицы зазоров условные.',
      'Отсутствие позиций не доказывает ошибку PDF: возможны пропуски распознавания.',
      'CadRecon работает только с PDF/сканами и 2D DXF; 3D/STEP/SOLIDWORKS исключены.',
     ].join('\n')+'\n'});
   downloadZip(createZip(files),safe(project.name)+'_CadRecon_пакет.zip');
   setStatus('Экспортирован локальный ZIP: '+files.length+' файлов. Непроверенных объектов: '+warn);
 }
 const selection=sheet.entities.find(e=>e.id===selected);
 const issues=useMemo(()=>auditSheet(sheet,project),[sheet,project]);
 const measured=useMemo(()=>selection?measureCadEntity(selection):null,[selection]);
 const topology=useMemo(()=>panel==='audit'?inspectCadTopology(sheet.entities):null,[panel,sheet.entities]);
 const counts=useMemo(()=>sheet.entities.reduce((acc,e)=>(acc[e.kind]=(acc[e.kind]||0)+1,acc),{} as Record<string,number>),[sheet]);
 const recognitionQuality=useMemo(()=>assessRecognitionQuality(sheet),[sheet]);
 const reviewGroups=useMemo(()=>{
   const fresh=sheet.entities.filter(e=>!e.verified&&e.origin!=='manual');
   const geometry=fresh.filter(e=>['line','polyline','circle','arc','bezier','axis'].includes(e.kind));
   const text=fresh.filter(e=>e.kind==='text');
   const semantic=fresh.filter(e=>e.kind==='dimension'||e.kind==='eskd');
   for(const group of [geometry,text,semantic])group.sort((a,b)=>(a.confidence??1)-(b.confidence??1));
   return {geometry,text,semantic};
 },[sheet.entities]);
 const reviewed=reviewGroups[reviewType];
 const reviewStart=reviewPage*60,reviewPageCount=Math.max(1,Math.ceil(reviewed.length/60));
 return <div className="app">
  <header className="topbar">
    <div className="brand"><span className="brandicon">⌗</span><div><strong>CadRecon</strong><small>PDF → CAD · ВАШ БРАУЗЕР</small></div></div>
    <div className="project-name"><input aria-label="Название проекта" title="Название проекта" value={project.name} onChange={e=>apply(p=>({...p,name:e.target.value}))}/><span className="save-mark">● локально</span></div>
    <div className="top-actions">
      <input ref={input} type="file" accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff,application/pdf,image/*" multiple hidden onChange={e=>handleDrawing(e.target.files)}/>
      <input ref={jsonInput} type="file" accept=".json,.cadrecon.json" hidden onChange={e=>handleProject(e.target.files)}/>
      <button onClick={()=>input.current?.click()} className="primary">＋ Загрузить PDF / скан</button>
      <button title="Сохранить проект в JSON" onClick={()=>exportProject(project)}>↓ JSON</button>
      <button title="Открыть проект JSON" onClick={()=>jsonInput.current?.click()}>↑ JSON</button>
      <button className="primary outline" onClick={exportDxf}>↓ DXF</button><button title="Скачать DXF всех листов одним ZIP" onClick={exportAllDxf}>↓ Все DXF</button>
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
      <div className="sheetnav"><div className="sheet-tabs">{project.sheets.map((s,i)=><div className={'sheet-tab'+(sheetIndex===i?' active':'')} key={s.id}>
        <button className="sheet-select" onClick={()=>{setSheetIndex(i);setSelected(null);}} title={s.name}>{s.name.length>26?s.name.slice(0,24)+'…':s.name}</button>
        <button className="sheet-close" disabled={!!busy} onClick={()=>void closeSheet(i)}
          title={'Закрыть лист '+s.name} aria-label={'Закрыть лист '+s.name}>×</button>
      </div>)}</div><span className="meta">{sheet.entities.length.toLocaleString('ru-RU')} объектов · {Math.round(sheet.width)} × {Math.round(sheet.height)} {sheet.calibrated?'мм':'ед.'}</span></div>
      <Editor key={sheet.id} focusTarget={focusTarget} sheet={sheet} project={project} tool={tool} selected={selected} onSelect={setSelected} onCreate={e=>addEntities([e])} onMove={(e,d)=>modifyEntity(translateEntity(e,d))} onOperation={applyOperation} onOcrRegion={rect=>{void recognizeArea(rect);}} onCalibrate={factor=>{changeSheet(s=>scaleSheet(s,factor));setStatus('Лист откалиброван. Проверьте дополнительные контрольные размеры.');}} onMessage={setStatus} source={source} compare={compare} grid={grid} snap={snap} symbolType={symbolType} symbolText={symbolText}/>
      <div className="statusbar"><span className={busy?'pulse':''}>{busy||status}</span><span className="status-right">Esc — отмена · Enter — завершить контур · Del — удалить · Ctrl+Z — назад</span></div>
    </section>
    <aside className={'sidebar'+(sidebarWide?' wide':'')+(sidebarCollapsed?' is-collapsed':'')}>
      <div className="sidebar-header">
        <strong>{panel==='reconstruct'?'PDF / скан → DXF':panel==='tools'?'Команды CAD':panel==='layers'?'Слои':
          panel==='properties'?'Свойства':panel==='audit'?'Аудит':
          panel==='recognition'?'Распознавание':panel==='archive'?'Поиск и архив':'Резервные копии'}</strong>
        <span className="sidebar-header-actions">
          {!sidebarCollapsed&&<button type="button" aria-label={sidebarWide?'Стандартная ширина панели':'Расширить боковую панель'}
            title={sidebarWide?'Обычная ширина':'Увеличить панель'} onClick={()=>setSidebarWide(x=>!x)}>
            {sidebarWide?'⇤':'⇥'}</button>}
          <button type="button" aria-label={sidebarCollapsed?'Развернуть боковую панель':'Свернуть боковую панель'}
            title={sidebarCollapsed?'Показать панель':'Скрыть панель'} onClick={()=>setSidebarCollapsed(x=>!x)}>
            {sidebarCollapsed?'⟵':'⟶'}</button>
        </span>
      </div>
      <div className="panel-tabs">{(['reconstruct','recognition','tools','layers','properties','audit','archive','backups'] as Panel[]).map((x,i)=><button key={x} title={['PDF → DXF','Распознавание','Инструменты','Слои','Свойства','Проверка','Поиск и аудит','Резерв'][i]} onClick={()=>{setSidebarCollapsed(false);if(x==='backups')void showBackups();else setPanel(x);}} className={panel===x?'active':''}>{['◎','✓','⌘','☷','⚙','⚠','⌕','▣'][i]}</button>)}</div>
      <div className="panelcontent">
      {panel==='reconstruct'&&<ReconstructionPanel
        quality={recognitionQuality} loaded={!!sheet.image} busy={!!busy}
        recognitionMode={recognitionMode} onMode={setRecognitionMode}
        ocrLanguages={ocrLanguages} onLanguages={setOcrLanguages}
        ocrVertical={ocrVertical} onVertical={setOcrVertical}
        onImport={()=>input.current?.click()} onRecognize={()=>void browserAccurateProcessing()}
        onTrace={()=>void vectorize()} onOcr={()=>void runOcr()}
        onReview={()=>{setPanel('recognition');setReviewPage(0);}}
        onCompare={()=>{setCompare(true);setSource(true);}}
        onExport={exportDxf} onCalibrate={()=>setTool('calibrate')}
        onEdit={()=>setPanel('tools')} onCleanup={cleanupTraceNoise}
        onStop={()=>localController.current?.abort()}
        onPrepareOcr={()=>void prepareBrowserOcr()}/>}
      {panel==='tools'&&<>
      <CadPalette tools={TOOLS} active={tool} onSelect={next=>{setTool(next);
        setStatus('Инструмент: '+(TOOLS.find(x=>x.id===next)?.title||next)+'. Укажите точки на чертеже.');}}
        selection={!!selected}/>
      <details className="cad-tool-group cad-precision">
        <summary><span>Точные построения по координатам</span><small>6</small></summary>
        <p className="cad-group-hint">Для построений по выделенному объекту сначала нажмите «Выделение».
          Это разовые геометрические команды без сохраняемой связи с оригиналом.</p>
        <div className="cad-command-list">
          <button className="action" onClick={()=>constructSelected('coordinates')}>Отрезок X1/Y1 → X2/Y2</button>
          <button className="action" disabled={!selected||!!busy} onClick={()=>constructSelected('parallel')}>Параллельный отрезок через точку</button>
          <button className="action" disabled={!selected||!!busy} onClick={()=>constructSelected('perpendicular')}>Перпендикулярный отрезок через точку</button>
          <button className="action" disabled={selection?.kind!=='circle'||!!busy} onClick={()=>constructSelected('tangent-left')}>Касательная слева от внешней точки</button>
          <button className="action" disabled={selection?.kind!=='circle'||!!busy} onClick={()=>constructSelected('tangent-right')}>Касательная справа от внешней точки</button>
          <button className="action" disabled={!selected||!!busy} onClick={()=>constructSelected('point-on-curve')}>Точка на кривой, параметр t</button>
        </div>
      </details>
      <h3>Размеры и авторазмеры</h3>
      <p className="muted">Как в CAD: две точки задают размер, третья размещает размерную линию. Авторазмеры — только кандидаты по текущей геометрии, не аттестованные размеры изделия.</p>
      <div className="stack">
        <button className="action" onClick={()=>setTool('dimension')}>↔ Размер по двум точкам</button>
        <button className="action" onClick={()=>setTool('dimension-3pt')}>⇤ Размер с размещением (3 точки)</button>
        <button className="action" disabled={!selected||!!busy} onClick={()=>makeAutoDimensions('selected')}>◎ Авторазмер выбранного объекта</button>
        <button className="action" disabled={!!busy} onClick={()=>makeAutoDimensions('all')}>◎ Авторазмеры линий и окружностей</button>
        <button className="action" disabled={selection?.kind!=='circle'||!!busy} onClick={()=>annotateCircle('radius')}>R Радиальный размер (выноска)</button>
        <button className="action" disabled={selection?.kind!=='circle'||!!busy} onClick={()=>annotateCircle('diameter')}>⌀ Диаметральный размер (выноска)</button>
        <button className="action" disabled={selection?.kind!=='circle'||!!busy} onClick={()=>annotateCircle('axes')}>⊕ Центровые оси окружности</button>
        <button className="action" onClick={()=>setTool('dimension-angle')}>∡ Угловой размер (две линии)</button>
        <button className="action" disabled={selection?.kind!=='polyline'||!!busy}
          onClick={()=>createDimensionSeries('chain')}>↔ Цепные размеры по вершинам</button>
        <button className="action" disabled={selection?.kind!=='polyline'||!!busy}
          onClick={()=>createDimensionSeries('baseline')}>⇥ Размеры от общей базы</button>
      </div>
      <p className="muted">{sheet.calibrated?'Калибровка установлена; размеры нужно проверить.':
        '⚠ Масштаб не подтверждён. Авторазмеры создаются без чисел (?).'} Диаметр окружности предлагается как редактируемая выноска, не как ассоциативный DIMDIAMETER.</p>
      <h3>Редактирование геометрии</h3>
      <p className="muted">Сначала выделите один объект. STRETCH перемещает выбранную вершину двумя кликами, MIRROR создаёт копию относительно оси, ARRAY — прямоугольный массив.</p>
      <div className="stack">
        <button className="action" disabled={!selected} onClick={()=>setTool('stretch')}>⤢ STRETCH — переместить вершину</button>
        <button className="action" disabled={!selected} onClick={()=>setTool('mirror')}>◀ MIRROR — две точки оси</button>
        <button className="action" disabled={!selected} onClick={makeRectangularArray}>▦ ARRAY — прямоугольный массив</button>
      </div>
      <h3>Точные преобразования объекта</h3>
      <p className="muted">Укажите объект «Выделением». Опорная точка — центр окружности/эллипса или первый узел.
        Единицы перемещения — координаты листа. Поворот, масштаб и массив сохраняются как редактируемая геометрия,
        без автоматического пересчёта сопряжённых размеров.</p>
      <div className="cad-action-grid">
        <button className="action" disabled={!selected||!!busy} onClick={()=>transformSelected('rotate')}>⤾ ROTATE · угол</button>
        <button className="action" disabled={!selected||!!busy} onClick={()=>transformSelected('scale')}>⤢ SCALE · коэффициент</button>
        <button className="action" disabled={!selected||!!busy} onClick={()=>transformSelected('move')}>⇆ MOVE · ΔX/ΔY</button>
        <button className="action" disabled={!selected||!!busy} onClick={()=>transformSelected('shear')}>▱ SHEAR · сдвиг X</button>
        <button className="action" disabled={!selected||!!busy} onClick={()=>transformSelected('polar')}>◎ Круговой массив</button>
        <button className="action" disabled={!selected||!!busy} onClick={()=>alignSelected('horizontal')}>━ Выровнять LINE по горизонтали</button>
        <button className="action" disabled={!selected||!!busy} onClick={()=>alignSelected('vertical')}>┃ Выровнять LINE по вертикали</button>
      </div>
      <p className="muted">Выравнивание — однократная правка, не параметрическая связь.
        Круги/дуги не преобразуются в некорректные примитивы при сдвиговой деформации.</p>
      <h3>Обозначения ЕСКД — конструктор</h3>
      <p className="muted">Выберите тип и текст, затем укажите место на чертеже инструментом ⌗. Объект сохраняется единым редактируемым знаком.</p>
      <label className="selector-label">Тип обозначения
        <select value={symbolType} onChange={e=>{const id=e.target.value as EskdType;setSymbolType(id);setSymbolText(ESKD_SYMBOLS.find(x=>x.id===id)?.defaultText||'');setTool('eskd');}}>
          {ESKD_SYMBOLS.map(s=><option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </label>
      <label className="selector-label">Значение / надпись<input value={symbolText} onChange={e=>setSymbolText(e.target.value)}/></label>
      <button className="action" onClick={()=>setTool('eskd')}>⌗ Установить обозначение</button>
      <h3>Точная обработка — прямо в браузере</h3>
      <p className="muted">GitHub Pages — единственный хостинг. Файл чертежа не передаётся на сервер. Обработка PDF, сканов, OCR и CAD выполняется на вашем устройстве. Для OCR браузер при первом запуске скачает языковые модели.</p>
      <label className="selector-label">Режим анализа
        <select aria-label="Режим анализа PDF" value={recognitionMode} disabled={!!busy}
          onChange={e=>setRecognitionMode(e.target.value as 'auto'|'hybrid')}>
          <option value="auto">Автоматический: исходные векторы PDF в приоритете</option>
          <option value="hybrid">Гибридный: дополнительно обвести встроенные сканы и OCR</option>
        </select>
      </label>
      <button className="action primary" onClick={browserAccurateProcessing} disabled={!sheet.image||!!busy}>◎ Точное распознавание в браузере</button>
      {localBusy&&<button className="action" onClick={()=>localController.current?.abort()}>× Остановить обработку на устройстве</button>}
      <p className="muted">Обычный PDF: исходные векторы без повторной обводки. Для PDF со встроенными изображениями и неполной векторизацией выберите гибридный режим — он дополнительно анализирует растр и может создать дубли. Скан: обводка + OCR RU/EN + проверка размеров и ЕСКД. Результат необходимо сверить с оригиналом.</p>
      <button className="action" onClick={prepareBrowserOcr} disabled={!!busy}>↓ Подготовить языковые модели OCR (RU/EN)</button>
      <h3>Распознавание текста (OCR)</h3>
      <label className="selector-label">Языки OCR
        <select aria-label="Языки OCR" value={ocrLanguages}
          onChange={e=>setOcrLanguages(e.target.value as 'rus+eng'|'rus'|'eng')} disabled={!!busy}>
          <option value="rus+eng">Русский + English (чертежи со смешанными обозначениями)</option>
          <option value="rus">Только русский</option>
          <option value="eng">Только English / латиница</option>
        </select>
      </label>
      <label className="selector-label">Качество онлайн-OCR
        <select aria-label="Качество онлайн-OCR" value={ocrMode}
          onChange={e=>setOcrMode(e.target.value as 'standard'|'enhanced')} disabled={!!busy}>
          <option value="enhanced">Усиленное: повторная проверка мелкого и нечёткого текста</option>
          <option value="standard">Быстрое: один проход по исходному растру</option>
        </select>
      </label>
      <label className="check"><input type="checkbox" checked={ocrVertical}
        onChange={e=>setOcrVertical(e.target.checked)} disabled={!!busy||ocrMode!=='enhanced'}/>
        Искать вертикальные надписи (±90°, на больших листах — по фрагментам)</label>
      <p className="muted">Все вычисления на устройстве. Усиленный режим повторно увеличивает до 60 трудных строк;
        несовпадающие варианты текста сохраняются как замечания, не заменяют чертёж молча.
        На больших листах поворот пропускается, чтобы не перегрузить браузер.</p>
      <p className="muted">{modelsReady?'✓ Языковые модели подготовлены для текущего сеанса.':'Дополнительные пакеты скачиваются на устройство пользователя при необходимости; использование после очистки кэша потребует повторной загрузки.'}</p>
      <h3>Отдельные инструменты</h3>
      <div className="stack">
        <button className="action" onClick={vectorize} disabled={!sheet.image||!!busy}>⌁ Детальная обводка (исходное разрешение)</button>
        <button className="action" onClick={runOcr} disabled={!sheet.image||!!busy}>Aa Распознать текст (RU/EN)</button>
        <button className="action" onClick={()=>setTool('ocr-region')} disabled={!sheet.image||!!busy}>
          ▧ OCR области — выбрать два угла рамки</button>
        <button className="action" onClick={runSemanticRecognition} disabled={!!busy}>▤ Восстановить размерные цепочки и ЕСКД</button>
        <button className="action" onClick={repairImportedPdfText} disabled={!!busy}>АЯ Исправить кодировку PDF-текста</button>
        <button className="action" onClick={mergeLines} disabled={!!busy}>⇄ Убрать дубли автоотрезков</button>
        <button className="action" onClick={()=>setTool('calibrate')}>⊞ Калибровать по размеру</button>
        <button className="action" onClick={()=>setTool('measure')}>↔ Измерить расстояние</button>
      </div>
      <details className="local-ultra">
        <summary>Дополнительно: Ultra на своём компьютере (необязательно)</summary>
        <p className="muted">Для тяжёлых сканов можно самостоятельно установить дополнительный пакет PaddleOCR + OpenCV на этот же ПК. Он работает на localhost и не требует хостинга или платного сервера. Основная онлайн-версия работает без него.</p>
        <label className="selector-label">Локальный адрес Ultra
          <input aria-label="Локальный адрес Ultra" value={onlineUrl} onChange={e=>setOnlineUrl(e.target.value)} placeholder="http://127.0.0.1:8766"/>
        </label>
        <label className="selector-label">Токен Ultra (из локального установщика)
          <input aria-label="Токен Ultra" type="password" autoComplete="off" value={onlineToken} onChange={e=>setOnlineToken(e.target.value)}/>
        </label>
        <button className="action" disabled={!sheet.image||!!busy||!onlineToken} onClick={onlineProcessing}>◈ Распознать локальным Ultra</button>
        {onlineController.current&&<button className="action" onClick={()=>onlineController.current?.abort()}>× Отменить локальную задачу</button>}
        <p className="muted"><a href="https://github.com/kappamaag-crypto/CadRecon/blob/main/docs/ULTRA_WINDOWS_INSTALLER.md" target="_blank" rel="noreferrer">Как установить Ultra на свой ПК</a></p>
      </details>
      <h3>Состав листа</h3><div className="statgrid">{Object.entries(counts).map(([key,n])=><div key={key}><strong>{n}</strong><small>{key}</small></div>)}</div>{!!ocrText&&<><h3>Распознанный текст</h3><textarea rows={7} readOnly value={ocrText} aria-label="OCR текст"/><button onClick={()=>navigator.clipboard.writeText(ocrText)}>Копировать OCR</button></>}<p className="notice">Сканированная геометрия и OCR не считаются точными до проверки размеров и объектов.</p></>}
      {panel==='archive'&&<ArchivePanel project={project} sheetIndex={sheetIndex} onFocus={focusEntity} onImportSpec={importSpecification} onApplyStamp={applyStamp} onPackage={exportPackage} onStatus={setStatus}/>}
      {panel==='recognition'&&<>
        <h3>Проверка распознавания</h3>
        <p className="muted">Новые объекты CAD не подтверждаются автоматически. Балл алгоритма — эвристика, а не статистическая вероятность правильности. Сравните с оригиналом, при необходимости исправьте или удалите.</p>
        <details>
          <summary>Сравнить LINE / CIRCLE с проверенной разметкой (локальный эталон)</summary>
          <p className="muted">Для сканов с синей обводкой нельзя принимать все цветные линии за доказанную геометрию.
            Разметьте координаты настоящих LINE/CIRCLE в исходных пикселях изображения; поставьте
            reviewed=true только после независимой проверки. Неполный эталон показывает покрытие,
            но не объявляет остальные линии ошибочными.</p>
          <div className="stack">
            <button className="action" disabled={!sheet.image} onClick={()=>void downloadGeometryTemplate()}>
              ↓ Пустой шаблон геометрического эталона JSON</button>
            <input type="file" accept=".json,application/json" aria-label="Загрузить эталон геометрии JSON"
              onChange={e=>{const file=e.target.files?.[0]||null;void measureGeometryAccuracy(file);e.target.value='';}}/>
          </div>
          {geometryBenchmark?.sheetId===sheet.id&&<div className="issue" aria-label="Результат проверки геометрии">
            <strong>Сравнение с проверенным эталоном ({geometryBenchmark.result.scope==='complete'?'полная область':'частичная область'})</strong>
            <p>Покрытие длины контрольных LINE: {(geometryBenchmark.result.lineCoverage*100).toFixed(1)}%.
              Полностью покрыто (≥90%): {geometryBenchmark.result.coveredLines}/{geometryBenchmark.result.expectedLines}.
              Найдено кандидатов LINE: {geometryBenchmark.result.detectedLines}.</p>
            <p>CIRCLE: совпало {geometryBenchmark.result.matchedCircles}/{geometryBenchmark.result.expectedCircles}.
              Пропущены: {geometryBenchmark.result.missingCircles.join(', ')||'нет'}.</p>
            {geometryBenchmark.result.meanCircleCenterErrorPx!==null&&<p>Средняя ошибка центра: {geometryBenchmark.result.meanCircleCenterErrorPx.toFixed(2)} px,
              радиуса: {geometryBenchmark.result.meanCircleRadiusErrorPx?.toFixed(2)} px. Не мм.</p>}
            {geometryBenchmark.result.scope==='complete'?<p>
              Отрезков вне полного эталона: {geometryBenchmark.result.unsupportedCandidates}.
              Согласованность кандидатов: {((geometryBenchmark.result.candidateAgreement??0)*100).toFixed(1)}%.
              Это приближённая метрика, не формальная точность распознавания.</p>:
              <p className="muted">Разметка неполная: ложноположительные элементы не вычисляются.
                За её пределами могут быть рамки, размеры, штриховка и текст.</p>}
            {geometryBenchmark.result.missingLines.length>0&&<p>Недостаточно покрытые линии:
              {' '+geometryBenchmark.result.missingLines.slice(0,12).map(v=>v.id+' ('+(v.coverage*100).toFixed(0)+'%)').join('; ')}
              {geometryBenchmark.result.missingLines.length>12?' и другие':''}.</p>}
          </div>}
        </details>
        <details>
          <summary>Измерить точность OCR по размеченному эталону JSON</summary>
          <p className="muted">Эталон — массив объектов id, text, x0, y0, x1, y1 в пикселях исходной подложки. Все данные сравниваются локально, без отправки файлов на сервер. Результат зависит от корректности разметки.</p>
          <input type="file" aria-label="Загрузить OCR эталон JSON" accept=".json,application/json"
            onChange={e=>{const file=e.target.files?.[0]||null;void measureOcrAccuracy(file);e.target.value='';}}/>
          {ocrBenchmark?.sheetId===sheet.id&&<div className="issue">
            <strong>Результат независимой разметки текущего листа</strong>
            <p>Найдено {ocrBenchmark.result.matched} / {ocrBenchmark.result.expected} надписей.
              Пропущено: {ocrBenchmark.result.missed}. Лишних: {ocrBenchmark.result.falsePositive}.</p>
            <p>Detection precision: {(ocrBenchmark.result.precision*100).toFixed(1)}% ·
              recall: {(ocrBenchmark.result.recall*100).toFixed(1)}%.</p>
            <p>CER: {(ocrBenchmark.result.cer*100).toFixed(1)}% ·
              WER: {(ocrBenchmark.result.wer*100).toFixed(1)}% ·
              точных критичных текстов: {ocrBenchmark.result.criticalExact} / {ocrBenchmark.result.criticalTokens}.</p>
          </div>}
        </details>
        <div className="stack">
          <button className="action" disabled={!!busy} onClick={runSemanticRecognition}>↻ Повторить автоанализ</button>
          <div className="stack">
            <button className="action" aria-pressed={reviewType==='geometry'} onClick={()=>{setReviewType('geometry');setReviewPage(0);}}>Геометрия · {reviewGroups.geometry.length} непроверенных</button>
            <button className="action" aria-pressed={reviewType==='text'} onClick={()=>{setReviewType('text');setReviewPage(0);}}>OCR-надписи · {reviewGroups.text.length} непроверенных</button>
            <button className="action" aria-pressed={reviewType==='semantic'} onClick={()=>{setReviewType('semantic');setReviewPage(0);}}>Размеры и ЕСКД · {reviewGroups.semantic.length} непроверенных</button>
          </div>
          <p className="muted">Показаны объекты с минимальным алгоритмическим баллом (первым делом проверьте их). Страница {Math.min(reviewPage+1,reviewPageCount)} из {reviewPageCount}; кандидатов в категории: {reviewed.length}.</p>
          {reviewed.slice(reviewStart,reviewStart+60).map(e=>
            <button key={e.id} className={'recognition-item '+(selected===e.id?'active':'')} onClick={()=>{setSelected(e.id);setPanel('properties');}}>
              <strong>{e.kind==='dimension'?'Размер':e.kind==='eskd'?'ЕСКД / '+e.symbol:e.kind==='text'?'Текст':e.kind}: {e.text||((e.points[0]?.x??0).toFixed(1)+', '+(e.points[0]?.y??0).toFixed(1))}</strong>
              <small>Балл: {e.confidence===undefined?'не задан':Math.round(e.confidence*100)+'%'} · {e.reason||'Нужна проверка по подложке'}</small>
              <span>Открыть свойства · принять, скорректировать или удалить</span>
            </button>
          )}
          {reviewed.length===0&&<p className="muted">В выбранной категории непроверенных кандидатов нет. Другие категории могут содержать непроверенные объекты.</p>}
          {reviewPageCount>1&&<div className="stack">
            <button className="action" disabled={reviewPage<=0} onClick={()=>setReviewPage(n=>Math.max(0,n-1))}>← Предыдущие 60</button>
            <button className="action" disabled={reviewPage>=reviewPageCount-1} onClick={()=>setReviewPage(n=>Math.min(reviewPageCount-1,n+1))}>Следующие 60 →</button>
          </div>}
        </div>
      </>}
      {panel==='layers'&&<><h3>Слои</h3><p className="muted">Цвет, видимость и блокировка каждого типа CAD-объектов.</p><div className="layerlist">{project.layers.map(l=><div className="layer" key={l.name}><span className="swatch" style={{background:l.color}}/><span className="layername">{l.name}</span><button title="Видимость" onClick={()=>apply(p=>({...p,layers:p.layers.map(x=>x.name===l.name?{...x,visible:!x.visible}:x)}))}>{l.visible?'◉':'○'}</button><button title="Блокировка" onClick={()=>apply(p=>({...p,layers:p.layers.map(x=>x.name===l.name?{...x,locked:!x.locked}:x)}))}>{l.locked?'🔒':'▢'}</button></div>)}</div><button className="action" onClick={()=>{const name=window.prompt('Название нового слоя');if(!name?.trim()||project.layers.some(l=>l.name===name.trim()))return;apply(p=>({...p,layers:[...p.layers,{name:name.trim(),color:'#60a5fa',visible:true,locked:false}]}));}}>＋ Добавить слой</button></>}
      {panel==='properties'&&<><h3>Свойства объекта</h3>{selection?<div className="stack">
        <div className="property-type"><span>Тип</span><strong>{selection.kind}</strong></div>
        {measured&&<div className="issue" aria-label="Геометрический калькулятор">
          <strong>Геометрический калькулятор</strong>
          {measured.length!==undefined&&<p>Длина: {measured.length.toFixed(3)} {sheet.calibrated?'мм':'ед. листа'}</p>}
          {measured.perimeter!==undefined&&<p>Периметр: {measured.perimeter.toFixed(3)} {sheet.calibrated?'мм':'ед. листа'}</p>}
          {measured.area!==undefined&&<p>Площадь: {measured.area.toFixed(3)} {sheet.calibrated?'мм²':'ед. листа²'}</p>}
          {measured.radius!==undefined&&<p>Радиус: {measured.radius.toFixed(3)} {sheet.calibrated?'мм':'ед. листа'}</p>}
          <p>{measured.note}</p>
          {!sheet.calibrated&&<p>⚠ Масштаб не подтверждён: это не миллиметры.</p>}
        </div>}
        <label>Слой<select value={selection.layer} onChange={e=>modifyEntity({...selection,layer:e.target.value})}>{project.layers.map(l=><option key={l.name}>{l.name}</option>)}</select></label>
        <label>Источник <input value={selection.origin} disabled/></label>
        {selection.kind==='line'&&<label>Тип линии (DXF)
          <select aria-label="Тип линии (DXF)" value={selection.lineStyle||'solid'}
            onChange={e=>modifyEntity({...selection,
              lineStyle:e.target.value==='solid'?undefined:(e.target.value as 'dashed'|'center')})}>
            <option value="solid">Сплошная (CONTINUOUS)</option>
            <option value="dashed">Штриховая (DASHED)</option>
            <option value="center">Осевая / штрихпунктирная (CENTER)</option>
          </select>
        </label>}
        <label className="check"><input type="checkbox" checked={selection.verified} onChange={e=>modifyEntity({...selection,verified:e.target.checked},true)}/> Проверен по оригиналу</label>
        {['text','leader','dimension','table','stamp','eskd'].includes(selection.kind)&&<label>Текст <textarea value={selection.text||''} onChange={e=>modifyEntity({...selection,text:e.target.value})} rows={3}/></label>}
        {selection.kind==='hatch'&&<>
          <label>Эскизный рисунок штриховки (не утверждённый ГОСТ)
            <select aria-label="Рисунок штриховки" value={selection.hatchPattern||'solid'}
              onChange={e=>modifyEntity({...selection,
                hatchPattern:e.target.value as 'solid'|'diagonal'|'cross'})}>
              <option value="solid">Сплошная заливка (DXF HATCH)</option>
              <option value="diagonal">Диагональные линии 45°</option>
              <option value="cross">Перекрёстные линии 45° / 135°</option>
            </select>
          </label>
          {selection.hatchPattern&&selection.hatchPattern!=='solid'&&
            <label>Шаг эскизной штриховки (ед. листа)
              <input type="number" min="1" max="10000" step="1"
                value={selection.hatchSpacing||12}
                onChange={e=>modifyEntity({...selection,
                  hatchSpacing:Math.max(1,Math.min(10000,Number(e.target.value)||12))})}/>
            </label>}
          <p className="muted">В DXF диагональные и перекрёстные линии экспортируются как
            редактируемые LINE с замкнутой границей. Это не родной ассоциативный CAD HATCH и не сертифицированный узор ГОСТ 2.306.</p>
        </>}
        {selection.kind==='eskd'&&<label>Тип обозначения
          <select value={selection.symbol||'weld'} onChange={e=>modifyEntity({...selection,symbol:e.target.value as EskdType})}>
            {ESKD_SYMBOLS.map(s=><option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>}
        {selection.confidence!==undefined&&<div className="issue warning">Эвристический балл алгоритма: <b>{Math.round(selection.confidence*100)}%</b> (не вероятность). Проверка по оригиналу обязательна.</div>}
        {selection.reason&&<p className="notice">{selection.reason}</p>}
        {selection.size!==undefined&&<label>Высота текста <input type="number" step=".1" value={selection.size} onChange={e=>modifyEntity({...selection,size:Number(e.target.value)||1})}/></label>}
        {selection.offset!==undefined&&<label>Отступ размерной линии <input type="number" value={selection.offset} onChange={e=>modifyEntity({...selection,offset:Number(e.target.value)||0})}/></label>}
        {selection.radius!==undefined&&<label>Радиус <input type="number" min=".001" value={selection.radius} onChange={e=>modifyEntity({...selection,radius:Math.max(.001,Number(e.target.value)||1)})}/></label>}
        {(selection.kind==='table'||selection.kind==='stamp')&&<><label>Строки <input type="number" min="1" max="50" value={selection.rows||3} onChange={e=>modifyEntity({...selection,rows:Math.max(1,Math.round(Number(e.target.value)||1))})}/></label><label>Столбцы <input type="number" min="1" max="50" value={selection.cols||3} onChange={e=>modifyEntity({...selection,cols:Math.max(1,Math.round(Number(e.target.value)||1))})}/></label><label>Ширина <input type="number" value={selection.width||120} onChange={e=>modifyEntity({...selection,width:Number(e.target.value)||1})}/></label><label>Высота <input type="number" value={selection.height||60} onChange={e=>modifyEntity({...selection,height:Number(e.target.value)||1})}/></label></>}
        {selection.points.slice(0,12).map((pt,i)=><div className="xy" key={i}><span>P{i+1}</span><label>X<input type="number" step=".01" value={Number(pt.x.toFixed(3))} onChange={ev=>modifyEntity({...selection,points:selection.points.map((p,j)=>j===i?{...p,x:Number(ev.target.value)||0}:p)})}/></label><label>Y<input type="number" step=".01" value={Number(pt.y.toFixed(3))} onChange={ev=>modifyEntity({...selection,points:selection.points.map((p,j)=>j===i?{...p,y:Number(ev.target.value)||0}:p)})}/></label></div>)}
        <button className="danger" onClick={deleteSelected}>Удалить объект</button></div>:<p className="muted">Выберите объект инструментом ↖. Можно изменить координаты, текст, размер, слой и статус проверки.</p>}</>}
      {panel==='audit'&&<>
        <h3>Замкнутость контуров и возможные разрывы</h3>
        <p className="muted">Диагностика только отмечает возможные ошибки LINE.
          Она не соединяет разрывы и не подтверждает пригодность для 3D-выдавливания.</p>
        {topology&&<div className="issue" aria-label="Диагностика контуров">
          <p><strong>Проверено LINE: {topology.checked}</strong> ·
            свободных концов: {topology.openEnds} · близких зазоров: {topology.nearGaps} ·
            дублей: {topology.duplicates} · самопересечений: {topology.selfCrossings} · замкнутых полилиний: {topology.closedPolylines}</p>
          {topology.truncated&&<p>⚠ Проверка ограничена первыми 800 линиями и 80 замечаниями.
            Остальные нужно исследовать отдельно.</p>}
          <div className="topology-findings">
            {topology.findings.slice(0,25).map((f,i)=><button className="cad-finding" key={i}
              title="Выделить объект для проверки" onClick={()=>{setSelected(f.entityId);setPanel('properties');}}>
              {f.kind==='duplicate'?'Дубль':f.kind==='gap'?'Разрыв':f.kind==='self-crossing'?'Пересечение':'Свободный конец'}:
              {' '+f.description}
            </button>)}
          </div>
        </div>}
        <h3>Контроль чертежа</h3><div className="stack">{issues.map((i,n)=><div key={n} className={'issue '+i.severity}><strong>{i.severity==='warning'?'⚠ Предупреждение':'ℹ Сведения'}</strong><p>{i.message}</p></div>)}</div><h3>Проверка исходника</h3><p className="muted">Включите «До / после» для сравнения. Подтвердите масштаб минимум по двум независимым размерам. Отметьте проверенные элементы в их свойствах.</p><button className="action" onClick={()=>setCompare(true)}>◫ Открыть сравнение</button><p className="notice">Аудит не заменяет нормоконтроль и инженерную проверку чертежей КМ/КМД.</p></>}
      {panel==='backups'&&<><h3>Резервные копии</h3><p className="muted">До восьми версий сохраняются в браузере. Экспорт JSON необходим для защиты от очистки данных сайта.</p><button className="action" onClick={async()=>{await createBackup(project);setBackups(await listBackups());setStatus('Резервная копия сохранена');}}>＋ Создать копию</button>{backups.map(b=><div className="backup" key={b.key}><strong>{b.name}</strong><small>{new Date(b.time).toLocaleString('ru-RU')}</small><button onClick={()=>restore(b.key)}>Восстановить</button></div>)}<button onClick={()=>exportProject(project)}>Скачать JSON на диск</button></>}
      </div>
    </aside>
  </div>
  <footer className="footer"><span>CadRecon · локальная обработка PDF и сканов · данные не отправляются на сервер</span><span>DXF / JSON · Без гарантии точности без проверки</span></footer>
 </div>;
}