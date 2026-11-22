export type Point = { x:number; y:number };
export type Kind = 'point'|'line'|'polyline'|'bezier'|'circle'|'arc'|'text'|'dimension'|'axis'|'leader'|'hatch'|'table'|'stamp'|'eskd';
export type Origin = 'manual'|'pdf'|'trace'|'ocr';
export type EskdType = 'weld'|'roughness'|'datum'|'geotol'|'section'|'detail'|'elevation'|'diameter'|'radius'|'thread'|'slope'|'taper';
export interface Entity {
  id:string; kind:Kind; layer:string; origin:Origin; verified:boolean;
  points:Point[]; center?:Point; radius?:number; startAngle?:number; endAngle?:number;
  closed?:boolean; text?:string; size?:number; offset?:number;
  rows?:number; cols?:number; width?:number; height?:number;
  confidence?:number; color?:string; symbol?:EskdType;
  reason?:string; sourceId?:string; chainId?:string;
  bbox?:{x0:number;y0:number;x1:number;y1:number};
}
export interface Layer { name:string; color:string; visible:boolean; locked:boolean; }
export interface Sheet { id:string; name:string; width:number; height:number; image?:string; entities:Entity[]; calibrated:boolean; importWarnings?:string[]; sourceType:'pdf'|'image'|'blank'; }
export interface CadProject { version:1; id:string; name:string; sheets:Sheet[]; layers:Layer[]; created:string; updated:string; }
export type Tool = 'select'|'pan'|'point'|'rectangle'|'trim'|'extend'|'chamfer'|'fillet'|'line'|'polyline'|'circle'|'arc'|'dimension'|'axis'|'leader'|'hatch'|'text'|'table'|'stamp'|'measure'|'calibrate'|'eskd';
export const COLORS = ['#e4ebf4','#38bdf8','#4ade80','#f9bd5a','#e879f9','#fb7185','#94a3b8','#22d3ee'];
export const DEFAULT_LAYERS:Layer[] = [
  {name:'Контуры',color:'#4ade80',visible:true,locked:false},
  {name:'Оси',color:'#38bdf8',visible:true,locked:false},
  {name:'Размеры',color:'#f9bd5a',visible:true,locked:false},
  {name:'Текст',color:'#e4ebf4',visible:true,locked:false},
  {name:'Штриховка',color:'#94a3b8',visible:true,locked:false},
  {name:'PDF векторы',color:'#a78bfa',visible:true,locked:false},
  {name:'Автообводка',color:'#22d3ee',visible:true,locked:false},
  {name:'OCR',color:'#fb7185',visible:true,locked:false},
  {name:'Авторазмеры',color:'#f97316',visible:true,locked:false},
  {name:'ЕСКД',color:'#d6aaff',visible:true,locked:false}
];
export const newId = () => typeof crypto!=='undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2)+Date.now();
export function newSheet(name='Лист 1',width=1189,height=841):Sheet {return {id:newId(),name,width,height,entities:[],calibrated:false,sourceType:'blank'};}
export function newProject():CadProject {const now=new Date().toISOString();return {version:1,id:newId(),name:'Новый проект',created:now,updated:now,layers:DEFAULT_LAYERS.map(l=>({...l})),sheets:[newSheet()]};}
export function entity(kind:Kind,points:Point[],layer='Контуры',origin:Origin='manual'):Entity {return {id:newId(),kind,layer,origin,verified:false,points,reason:origin==='manual'?'Создано вручную; не означает проверку по оригиналу':undefined};}
export function isPoint(p:unknown):p is Point {return !!p && typeof p==='object' && Number.isFinite((p as Point).x) && Number.isFinite((p as Point).y);}
export function validateProject(value:unknown):CadProject {
  if(!value || typeof value!=='object') throw new Error('Неверный формат проекта');
  const p=value as CadProject;
  if(p.version!==1 || !Array.isArray(p.sheets) || !Array.isArray(p.layers) || p.sheets.length>100) throw new Error('Несовместимая версия проекта');
  // Uploaded project JSON must not make a static GitHub Pages app fetch
  // arbitrary remote image URLs (tracking, privacy or CORS bypass).
  const imageData=/^data:image\/(?:png|jpe?g|webp|gif|bmp|avif);base64,[A-Za-z0-9+/]*={0,2}$/i;
  const safeName=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=180&&!/[\x00-\x1f\x7f]/.test(v);
  const kinds:Kind[]=['point','line','polyline','bezier','circle','arc','text','dimension','axis','leader','hatch','table','stamp','eskd'];
  if(p.layers.length>250||p.layers.some(l=>!safeName(l.name)||typeof l.color!=='string'||!/^#[0-9A-Fa-f]{6}$/.test(l.color)||
    typeof l.visible!=='boolean'||typeof l.locked!=='boolean'))throw new Error('Повреждённое описание слоёв');
  for(const s of p.sheets){
    if(!Number.isFinite(s.width)||!Number.isFinite(s.height)||s.width<=0||s.height<=0||s.width>1e8||s.height>1e8||!Array.isArray(s.entities)||s.entities.length>200000) throw new Error('Неверная геометрия листа');
    if(s.image!==undefined && (typeof s.image!=='string'||s.image.length>180_000_000||!imageData.test(s.image)))
      throw new Error('Неподдерживаемая подложка: файл проекта может содержать только встроенное растровое изображение, без внешних URL');
    for(const e of s.entities){
      if(!kinds.includes(e.kind)||!safeName(e.layer)||!['manual','pdf','trace','ocr'].includes(e.origin)||
        !Array.isArray(e.points)||e.points.length>30000||!e.points.every(isPoint)||
        (e.center!==undefined&&!isPoint(e.center))||
        (e.radius!==undefined&&(!Number.isFinite(e.radius)||e.radius<0))||
        (e.size!==undefined&&(!Number.isFinite(e.size)||e.size<0))||
        (e.confidence!==undefined&&!Number.isFinite(e.confidence)))
        throw new Error('Повреждённая геометрия или свойства объекта');
    }
  }
  return p;
}