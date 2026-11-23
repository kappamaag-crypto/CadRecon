/** W3: bounded independent ink re-measurement AFTER overlap-only topology joins.
 * Old tile evidence covered a DIFFERENT finite segment. Reuse is misleading.
 * Source pixels are sampled again from the user-local image into a thin strip.
 * No gaps are filled and no CAD entity is marked verified.
 */
import type {Entity,Sheet} from './model';
import {rankLineByInkEvidence,type Evidence} from './lineEvidence';
import {otsuInkThreshold} from './scanInkThreshold';

export interface ResampledScan {
  entities:Entity[];
  reviewed:number;
  skipped:number;
  warning?:string;
}
export function applyRecheckedLineEvidence(e:Entity,measured:Evidence,lengthPx:number):Entity {
  if(e.kind!=='line'||e.origin!=='trace'||e.verified||e.points.length!==2||
    !Number.isFinite(lengthPx)||lengthPx<1||measured.samples===0||
    !Number.isFinite(measured.support)||!Number.isFinite(measured.blankRunRatio))
    return e;
  const support=Math.max(0,Math.min(1,measured.support));
  const blankRunRatio=Math.max(0,Math.min(1,measured.blankRunRatio));
  const rank=typeof e.confidence==='number'&&Number.isFinite(e.confidence)
    ?Math.max(0,Math.min(1,e.confidence)):0;
  // Never promote the confidence of a joined Hough proposal.
  const confidence=Math.min(rank,measured.adjustedScore);
  const sourceGapPx=Math.min(lengthPx,lengthPx*blankRunRatio);
  return {...e,verified:false,confidence,
    scanEvidence:{inkSupport:support,blankRunRatio,blankRunPixels:sourceGapPx},
    reason:'Повторное измерение после сшивки: опора на исходный штрих '+
      Math.round(support*100)+'%, самый длинный участок без штриха ~'+
      sourceGapPx.toFixed(1)+' пикс. обработанного растра. '+
      'Предложение алгоритма не проверено инженером.'};
}
function gray(rgba:Uint8ClampedArray):Uint32Array {
  const histogram=new Uint32Array(256);
  for(let i=0;i+3<rgba.length;i+=4)
    histogram[Math.round(.299*rgba[i]+.587*rgba[i+1]+.114*rgba[i+2])]++;
  return histogram;
}
/** Re-evaluate only changed LINEs, up to maxLines; avoid full-page RGBA allocation.
 * Canvas strip has <=512*9 pixels. Reading raw image never sends it to a server.
 */
export async function remeasureMergedScanLines(
  input:Entity[],image:HTMLImageElement,sheet:Pick<Sheet,'width'|'height'>,
  rasterWidth:number,rasterHeight:number,
  signal?:AbortSignal,onProgress?:(message:string)=>void,maxLines=400,
):Promise<ResampledScan>{
  const assertActive=()=>{if(signal?.aborted)throw new DOMException('Сверка пикселей отменена','AbortError');};
  assertActive();
  if(!Number.isFinite(rasterWidth)||!Number.isFinite(rasterHeight)||
    rasterWidth<2||rasterHeight<2||!Number.isFinite(sheet.width)||
    !Number.isFinite(sheet.height)||sheet.width<=0||sheet.height<=0)
    return {entities:input,reviewed:0,skipped:0,
      warning:'Пиксельная опора объединённых LINE не пересчитана: неверная геометрия листа.'};
  const canvas=document.createElement('canvas');
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  if(!ctx)return {entities:input,reviewed:0,skipped:0,
    warning:'Пиксельная опора объединённых LINE не пересчитана: Canvas недоступен.'};
  const sx=rasterWidth/sheet.width,sy=rasterHeight/sheet.height;
  const output:Entity[]=[],cap=Math.max(0,Math.min(400,Math.floor(maxLines)));
  let reviewed=0,skipped=0;
  for(const e of input){
    assertActive();
    if(e.kind!=='line'||e.origin!=='trace'||e.verified||e.scanEvidence||
      !e.reason?.includes('Пиксельная опора итогового отрезка не пересчитана')){
      output.push(e);continue;
    }
    if(reviewed>=cap){skipped++;output.push(e);continue;}
    const [a,b]=e.points;
    const aa={x:a.x*sx,y:a.y*sy},bb={x:b.x*sx,y:b.y*sy};
    const length=Math.hypot(bb.x-aa.x,bb.y-aa.y);
    if(!Number.isFinite(length)||length<8||length>15000){
      skipped++;output.push(e);continue;
    }
    try{
      // Render a rotated 9px-wide ink strip along the NEW line extent.
      // 3.5px either side tolerates raster border-center rounding without
      // including a distinct contour >4px away.
      const samples=Math.min(512,Math.max(16,Math.ceil(length/2)));
      const middle={x:(aa.x+bb.x)/2,y:(aa.y+bb.y)/2};
      canvas.width=samples;canvas.height=9;
      ctx.setTransform(1,0,0,1,0,0);
      ctx.fillStyle='#fff';ctx.fillRect(0,0,samples,9);
      ctx.translate(samples/2,4.5);
      ctx.scale((samples-1)/length,1);
      ctx.rotate(-Math.atan2(bb.y-aa.y,bb.x-aa.x));
      ctx.translate(-middle.x,-middle.y);
      ctx.imageSmoothingEnabled=true;ctx.drawImage(image,0,0,rasterWidth,rasterHeight);
      const rgba=ctx.getImageData(0,0,samples,9).data;
      const threshold=otsuInkThreshold(gray(rgba));
      const evidence=rankLineByInkEvidence({a:{x:0,y:4},b:{x:samples-1,y:4},
        confidence:e.confidence??0},rgba,samples,9,512,threshold);
      output.push(applyRecheckedLineEvidence(e,evidence,length));
      reviewed++;
      if(reviewed%25===0){
        onProgress?.('Проверка исходных чернил после объединения: '+reviewed+' линий');
        // Yield to keep browser controls responsive on A0/A1 sheets.
        await new Promise<void>(resolve=>setTimeout(resolve,0));
      }
    }catch(error){
      // Missing pixel evidence is safer than a fabricated score. Still allow
      // abort to propagate immediately rather than swallowing cancellation.
      if(signal?.aborted)throw error;
      skipped++;output.push(e);
    }
  }
  canvas.width=0;canvas.height=0;
  return {entities:output,reviewed,skipped,
    warning:skipped?'Пиксельная опора '+skipped+
      ' объединённых линий осталась неизмеренной (лимит или ошибка); проверьте исходник.':undefined};
}
