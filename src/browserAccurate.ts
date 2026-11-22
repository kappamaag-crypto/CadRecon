/**
 * Main Pages-only accurate reconstruction pipeline. All drawing processing
 * occurs in the user's browser (PDF.js, Tesseract.js, canvas + Web Worker).
 * Tesseract.js may FETCH its model/worker binaries on the first run, but this
 * code never uploads the source drawing to an OCR backend.
 *
 * This is a best-effort reconstruction with an explicit review requirement,
 * not a guarantee of correct geometry, OCR or ESKD semantics.
 */
import {recognizeText,type OcrLanguages} from './ocr';
import {traceImage} from './vectorize';
import {reconstructDimensionChains} from './dimensions';
import {detectESKDLabels} from './eskd';
import type {Entity,Point,Sheet} from './model';

export interface BrowserAccurateResult {
  entities:Entity[];
  ocrText:string;
  note:string;
  warnings:string[];
  scanned:boolean;
}
const dist=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y);

function duplicate(a:Entity,b:Entity):boolean {
  if(a.kind!==b.kind)return false;
  if(['dimension','eskd'].includes(a.kind)&&a.sourceId&&b.sourceId&&a.sourceId===b.sourceId)return true;
  if(a.kind==='text'){
    return (a.text||'').trim()===(b.text||'').trim()
      &&a.points.length>0&&b.points.length>0
      &&dist(a.points[0],b.points[0])<=3;
  }
  if(a.kind==='circle'){
    return !!a.center&&!!b.center&&a.radius!==undefined&&b.radius!==undefined
      &&dist(a.center,b.center)<=2&&Math.abs(a.radius-b.radius)<=2;
  }
  if(a.kind==='line'&&a.points.length===2&&b.points.length===2){
    if(a.lineStyle!==b.lineStyle)return false;
    const [x,y]=a.points,[u,v]=b.points;
    return (dist(x,u)<=.75&&dist(y,v)<=.75)||
      (dist(x,v)<=.75&&dist(y,u)<=.75);
  }
  if(a.points.length!==b.points.length||!a.points.length)return false;
  if(a.kind==='eskd'&&(a.symbol!==b.symbol||a.text!==b.text))return false;
  if(a.kind==='dimension'&&a.text!==b.text)return false;
  if(a.closed!==b.closed)return false;
  return a.points.every((p,i)=>dist(p,b.points[i])<=.5);
}
/** Keep model candidates distinct unless they are demonstrably the same;
 * never conflate nearby lines or different dimension/OCR text values. */
/** Spatial hash prevents quadratic comparison on thousands of scanned lines.
 * Geometric candidates sharing a PDF source-operation ID are NOT equivalent:
 * one path can contain many distinct segments. SourceID dedup is reserved for
 * derived semantic objects (dimension / ESKD).
 */
export function uniqueCandidates(existing:Entity[],proposals:Entity[]):Entity[]{
  const buckets=new Map<string,Entity[]>();
  const sourced=new Set<string>();
  const fresh:Entity[]=[];
  const semanticKey=(e:Entity)=>e.sourceId&&['dimension','eskd'].includes(e.kind)
    ?e.kind+'|'+e.sourceId:null;
  const anchor=(e:Entity):Point=>{
    if(e.kind==='circle'&&e.center)return e.center;
    if(e.kind==='line'&&e.points.length===2){
      const [a,b]=e.points;
      return a.x<b.x||(a.x===b.x&&a.y<=b.y)?a:b;
    }
    return e.points[0]||{x:0,y:0};
  };
  const size=(e:Entity)=>e.kind==='text'?6:e.kind==='circle'?4:2;
  const bucketKey=(e:Entity,x=0,y=0,r=0)=>{
    const a=anchor(e),cell=size(e);
    const cx=Math.floor(a.x/cell)+x,cy=Math.floor(a.y/cell)+y;
    const radial=e.kind==='circle'?':'+(Math.floor((e.radius||0)/4)+r):'';
    const txt=e.kind==='text'?':'+(e.text||'').trim():'';
    return e.kind+':'+(e.kind==='line'?e.lineStyle||'solid':'')+':'+cx+':'+cy+radial+txt;
  };
  const index=(e:Entity)=>{
    const k=bucketKey(e),items=buckets.get(k)||[];
    items.push(e);buckets.set(k,items);
    const semantic=semanticKey(e);if(semantic)sourced.add(semantic);
  };
  for(const e of existing)index(e);
  for(const proposal of proposals){
    const semantic=semanticKey(proposal);
    if(semantic&&sourced.has(semantic))continue;
    let seen=false;
    for(let dy=-1;dy<=1&&!seen;dy++)for(let dx=-1;dx<=1&&!seen;dx++){
      const radiusOffsets=proposal.kind==='circle'?[-1,0,1]:[0];
      for(const dr of radiusOffsets){
        const candidates=buckets.get(bucketKey(proposal,dx,dy,dr));
        if(candidates?.some(e=>duplicate(e,proposal))){seen=true;break;}
      }
    }
    if(seen)continue;
    const e={...proposal,verified:false};
    fresh.push(e);index(e);
  }
  return fresh;
}
const hasNativeGeometry=(e:Entity)=>e.origin==='pdf' &&
  ['line','polyline','circle','arc','bezier'].includes(e.kind);
const hasDigitalText=(e:Entity)=>e.origin==='pdf'&&e.kind==='text'&&!!e.text?.trim();

/**
 * Native vector PDF first. For scanned PDFs or images, high-resolution tiled
 * tracing + OCR. Semantic dimension/ESKD hypotheses are linked to evidence.
 * Repeated runs do not append identical candidates.
 */
export async function recognizeBrowserAccurate(
  sheet:Sheet,
  onProgress?:(status:string)=>void,
  signal?:AbortSignal,
  mode:'auto'|'hybrid'='auto',languages:OcrLanguages='rus+eng',
):Promise<BrowserAccurateResult>{
  if(!sheet.image)throw new Error('Для распознавания нужен загруженный PDF или скан');
  const assertActive=()=>{if(signal?.aborted)throw new DOMException('Обработка чертежа отменена','AbortError');};
  assertActive();
  const warnings:string[]=[];
  let candidates:Entity[]=[],ocrText='';
  const native=sheet.sourceType==='pdf'&&sheet.entities.some(hasNativeGeometry);
  const digitalText=sheet.sourceType==='pdf'&&sheet.entities.some(hasDigitalText);
  const scanned=!native||mode==='hybrid';
  if(mode==='hybrid'&&native)warnings.push('Гибридный PDF: дополнительная обводка может создать повторяющиеся и ложные линии поверх исходных векторов. Проверьте по подложке.');

  if(scanned){
    onProgress?.('Браузер: подробная векторизация по фрагментам...');
    try {
      const lines=await traceImage(sheet,12,onProgress,'detailed',signal);
      assertActive();
      if(lines.warnings?.length)warnings.push(...lines.warnings);
      candidates=uniqueCandidates(sheet.entities,lines.entities);
      warnings.push('Поиск линий в скане не гарантирует восстановление их исходной топологии.');
    }catch(error){
      assertActive();
      warnings.push('Автообводка не выполнена: '+String(error).slice(0,140)+'. Можно распознать текст и исправить геометрию вручную.');
    }
  }else{
    onProgress?.('Браузер: сохраняем точные векторные объекты исходного PDF...');
  }
  if(!digitalText||mode==='hybrid'){
    onProgress?.('Браузер: OCR русского и английского (модели загружаются в браузер)...');
    try {
      const ocr=await recognizeText({...sheet,entities:[...sheet.entities,...candidates]},onProgress,signal,
        {mode:'enhanced',languages,maxRetries:35});
      assertActive();
      ocrText=ocr.text;
      candidates.push(...uniqueCandidates([...sheet.entities,...candidates],ocr.entities));
    }catch(error){
      assertActive();
      warnings.push('OCR RU/EN не выполнен: '+String(error).slice(0,140)+
        '. Проверьте загрузку моделей или используйте локальные CAD-объекты без OCR.');
    }
  }else {
    warnings.push('Цифровой текст PDF уже импортирован. Дополнительный OCR можно запустить отдельно для поиска пропущенных надписей.');
  }
  assertActive();
  const source=[...sheet.entities,...candidates];
  onProgress?.('Браузер: проверяем размерные цепи и условные обозначения...');
  const chains=reconstructDimensionChains({...sheet,entities:source});
  const dims=uniqueCandidates(source,chains.dimensions);
  const symbols=uniqueCandidates([...source,...dims],detectESKDLabels(source));
  const added=uniqueCandidates(sheet.entities,[...candidates,...dims,...symbols]);
  warnings.push(...chains.warnings);
  if(!sheet.calibrated)warnings.push('Масштаб не калиброван: геометрические размеры не подтверждены в мм.');
  const counts={
    geometry:added.filter(e=>['line','polyline','circle','arc','bezier'].includes(e.kind)).length,
    texts:added.filter(e=>e.kind==='text').length,
    dimensions:added.filter(e=>e.kind==='dimension').length,
    eskd:added.filter(e=>e.kind==='eskd').length,
  };
  assertActive();
  return {entities:added,ocrText,warnings,scanned,
    note:'Браузерное распознавание: геометрия '+counts.geometry+', текст '+counts.texts+
      ', размеры '+counts.dimensions+', ЕСКД '+counts.eskd+
      '. Новых кандидатов: '+added.length+
      '. Все требуют проверки. Исходный чертёж не отправлялся на OCR-сервер.'};
}
