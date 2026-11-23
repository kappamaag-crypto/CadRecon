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
import {suspiciousText} from './textRepair';

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
/** Repeated one-click OCR is a RECONCILIATION, never an append-only action.
 * OCR often reads the same drawing label differently on later runs (Ø28/O28,
 * Rz 20/Rz 2O). Two readings in the SAME source box are alternatives, not two
 * editable labels at the same position. User-edited and accepted text always
 * wins, and no numerical text is auto-replaced by a new guess.
 */
export interface RecognitionMerge {
  entities:Entity[];
  added:number;
  updated:number;
  conflicts:number;
}
const unreadable=(s:string)=>/[\uFFFD\uE000-\uF8FF\u0000-\u0008\u000E-\u001F]/u.test(s)||
  /(?:Ã.|Â.|Ð.|Ñ.){2,}/u.test(s);
const protect=(e:Entity)=>e.verified||e.origin==='manual'||
  /объект изменён|вручную|исправлен оператором/i.test(e.reason||'');
function sameOcrPosition(a:Entity,b:Entity):boolean {
  if(a.kind!=='text'||b.kind!=='text')return false;
  if(a.bbox&&b.bbox){
    const w=Math.max(0,Math.min(a.bbox.x1,b.bbox.x1)-Math.max(a.bbox.x0,b.bbox.x0));
    const h=Math.max(0,Math.min(a.bbox.y1,b.bbox.y1)-Math.max(a.bbox.y0,b.bbox.y0));
    const aa=Math.max(0,(a.bbox.x1-a.bbox.x0)*(a.bbox.y1-a.bbox.y0));
    const bb=Math.max(0,(b.bbox.x1-b.bbox.x0)*(b.bbox.y1-b.bbox.y0));
    const heightRatio=Math.min(a.bbox.y1-a.bbox.y0,b.bbox.y1-b.bbox.y0)/
      Math.max(a.bbox.y1-a.bbox.y0,b.bbox.y1-b.bbox.y0);
    return Math.min(aa,bb)>0&&w*h/Math.min(aa,bb)>=.72&&heightRatio>=.62;
  }
  // Legacy OCR imports may lack bbox. Require near-identical origin points.
  return a.points.length>0&&b.points.length>0&&dist(a.points[0],b.points[0])<=2;
}
const normalizedScore=(e:Entity)=>Math.max(0,Math.min(1,
  (e.confidence??0)>1?(e.confidence??0)/100:(e.confidence??0)));
export function mergeRecognitionEntities(existing:Entity[],proposals:Entity[]):RecognitionMerge{
  const entities=[...existing];
  let added=0,updated=0,conflicts=0;
  // Spatial index of baseline OCR positions; no quadratic scan on A0 sheets.
  const bin=64,grid=new Map<string,number[]>();
  const anchor=(e:Entity)=>e.bbox?{x:e.bbox.x0,y:e.bbox.y0}:e.points[0]||{x:0,y:0};
  const cell=(x:number,y:number)=>x+':'+y;
  const addIndex=(e:Entity,i:number)=>{
    if(e.kind!=='text'||!['ocr','pdf','manual'].includes(e.origin))return;
    const p=anchor(e),x=Math.floor(p.x/bin),y=Math.floor(p.y/bin);
    const key=cell(x,y),indexes=grid.get(key)||[];
    indexes.push(i);grid.set(key,indexes);
  };
  entities.forEach(addIndex);
  for(const proposal of proposals){
    if(proposal.kind==='text'&&proposal.origin==='ocr'){
      const p=anchor(proposal),x=Math.floor(p.x/bin),y=Math.floor(p.y/bin);
      const candidates=new Set<number>();
      for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)
        for(const i of grid.get(cell(x+dx,y+dy))||[])candidates.add(i);
      const i=[...candidates].find(i=>sameOcrPosition(entities[i],proposal));
      if(i!==undefined){
        const old=entities[i];
        if((old.text||'').trim()===(proposal.text||'').trim()||protect(old))continue;
        if(old.origin==='ocr'){
          conflicts++;
          const alternative=(proposal.text||'').trim().slice(0,120);
          const oldText=old.text||'';
          const prefix='КОНФЛИКТ OCR: повторный проход прочитал «'+alternative+
            '». Размеры и обозначения не изменены автоматически.';
          // Replace only clearly broken non-numeric characters, and only when
          // the new observation is stronger. No silent engineering correction.
          const safeReplace=unreadable(oldText)&&!unreadable(alternative)&&
            !/\d/u.test(oldText+alternative)&&
            normalizedScore(proposal)>normalizedScore(old)+.10;
          const nextText=safeReplace?alternative:oldText;
          const reason=[old.reason||'',prefix,
            safeReplace?'Исходный повреждённый OCR: «'+oldText.slice(0,100)+'».':'']
            .filter(Boolean).join('; ');
          if(old.text!==nextText||old.reason!==reason){
            // Id and source geometry are stable: semantic links survive.
            entities[i]={...old,text:nextText,reason,verified:false,
              confidence:safeReplace?proposal.confidence:old.confidence};
            updated++;
          }
        }
        // A doubtful PDF text should not be silently overwritten. OCR may
        // supply a separate explicitly-reviewable alternative to the operator.
        else if(old.origin==='pdf'){
          const fresh=uniqueCandidates(entities,[proposal]);
          if(fresh.length){entities.push(...fresh);addIndex(fresh[0],entities.length-1);added++;}
        }
        continue;
      }
    }
    const fresh=uniqueCandidates(entities,[proposal]);
    if(!fresh.length)continue;
    for(const e of fresh){entities.push(e);addIndex(e,entities.length-1);added++;}
  }
  return {entities:added||updated?entities:existing,added,updated,conflicts};
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
  mode:'auto'|'hybrid'='auto',languages:OcrLanguages='rus+eng',detectVertical=false,
):Promise<BrowserAccurateResult>{
  if(!sheet.image)throw new Error('Для распознавания нужен загруженный PDF или скан');
  const assertActive=()=>{if(signal?.aborted)throw new DOMException('Обработка чертежа отменена','AbortError');};
  assertActive();
  const warnings:string[]=[];
  let candidates:Entity[]=[],ocrText='';
  const native=sheet.sourceType==='pdf'&&sheet.entities.some(hasNativeGeometry);
  const digitalText=sheet.sourceType==='pdf'&&sheet.entities.some(hasDigitalText);
  // A single readable PDF text node does NOT prove that all other glyphs
  // have a working font map. Do raster OCR when PDF extraction is suspect.
  const brokenDigitalText=sheet.sourceType==='pdf'&&sheet.entities.some(e=>
    e.kind==='text'&&e.origin==='pdf'&&
    (suspiciousText(e.text||'')||unreadable(e.text||'')||
      /PDF-кодировки|неверная кодировка|ошибка Latin-1/i.test(e.reason||'')));
  if(brokenDigitalText)warnings.push('В PDF обнаружен текст с сомнительной кодировкой: запущен дополнительный OCR по изображению. Исходные надписи сохранены для сравнения.');
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
  if(!digitalText||mode==='hybrid'||brokenDigitalText){
    onProgress?.('Браузер: OCR русского и английского (модели загружаются в браузер)...');
    try {
      const ocr=await recognizeText({...sheet,entities:[...sheet.entities,...candidates]},onProgress,signal,
        {mode:'enhanced',languages,detectVertical,maxRetries:35});
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
