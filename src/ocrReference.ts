/** Private OCR benchmark envelope.
 * A partial markup MUST NOT turn unlabelled areas into false positives.
 * A full reference must specify a bounded region with all labels reviewed.
 * Legacy array format remains accepted, but is explicitly unscoped.
 */
import {evaluateOcrAccuracy,type OcrGolden,type OcrMeasurement} from './ocrMetrics';
import type {OcrBox} from './ocrTiles';

type Rect={x0:number;y0:number;x1:number;y1:number};
export interface OcrReference {
  version:1;reviewed:true;scope:'partial'|'complete';
  imageWidth:number;imageHeight:number;
  region?:Rect;
  labels:OcrGolden[];
}
export interface OcrReferenceComparison {
  scope:'partial'|'complete'|'legacy';
  metrics:OcrMeasurement;
  /** Null unless every text on the declared ROI is independently labelled. */
  measuredPrecision:number|null;
  measuredFalsePositives:number|null;
}
const record=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x);
const finite=(x:unknown):x is number=>typeof x==='number'&&Number.isFinite(x);
const inside=(a:OcrBox,r:Rect)=>a.x0>=r.x0&&a.y0>=r.y0&&a.x1<=r.x1&&a.y1<=r.y1;
const boxArea=(a:OcrBox)=>Math.max(0,a.x1-a.x0)*Math.max(0,a.y1-a.y0);
const overlap=(a:OcrBox,b:OcrBox)=>{
  const i=Math.max(0,Math.min(a.x1,b.x1)-Math.max(a.x0,b.x0))*
    Math.max(0,Math.min(a.y1,b.y1)-Math.max(a.y0,b.y0));
  return i>0&&i/Math.min(boxArea(a),boxArea(b))>=.1;
};
function parseLabels(raw:unknown,w:number,h:number,region?:Rect):OcrGolden[]{
  if(!Array.isArray(raw)||raw.length>2000)throw new Error('OCR: ожидается массив до 2000 размеченных надписей');
  const ids=new Set<string>(),bounds=region||{x0:0,y0:0,x1:w,y1:h};
  for(const row of raw){
    if(!record(row)||typeof row.id!=='string'||!row.id||row.id.length>100||
      ids.has(row.id)||typeof row.text!=='string'||!row.text.trim()||row.text.length>400||
      !['x0','y0','x1','y1'].every(k=>finite(row[k]))||
      !(Number(row.x1)>Number(row.x0)&&Number(row.y1)>Number(row.y0))||
      !inside(row as unknown as OcrBox,bounds))
      throw new Error('OCR: неверная надпись, bbox или повторяющийся ID');
    ids.add(row.id);
  }
  return raw as OcrGolden[];
}
export function parseOcrReference(raw:unknown,imageWidth:number,imageHeight:number):
  {scope:'partial'|'complete'|'legacy';labels:OcrGolden[];region?:Rect}{
  if(!Number.isInteger(imageWidth)||!Number.isInteger(imageHeight)||imageWidth<1||imageHeight<1)
    throw new Error('OCR: недопустимые размеры исходной подложки');
  if(Array.isArray(raw)){
    return {scope:'legacy',labels:parseLabels(raw,imageWidth,imageHeight)};
  }
  if(!record(raw)||raw.version!==1||raw.reviewed!==true||
    (raw.scope!=='partial'&&raw.scope!=='complete')||
    raw.imageWidth!==imageWidth||raw.imageHeight!==imageHeight)
    throw new Error('OCR: необходимы version=1, reviewed=true, scope и точные размеры текущей подложки');
  let region:Rect|undefined;
  if(raw.region!==undefined){
    if(!record(raw.region))throw new Error('OCR: некорректная область');
    const r=raw.region;
    if(![r.x0,r.y0,r.x1,r.y1].every(finite)||
      Number(r.x0)<0||Number(r.y0)<0||
      Number(r.x1)>imageWidth||Number(r.y1)>imageHeight||
      Number(r.x1)<=Number(r.x0)||Number(r.y1)<=Number(r.y0))
      throw new Error('OCR: область вне изображения');
    region={x0:r.x0 as number,y0:r.y0 as number,
      x1:r.x1 as number,y1:r.y1 as number};
  }
  if(raw.scope==='complete'&&!region)
    throw new Error('OCR: для полного эталона обязательна ограниченная область region');
  const labels=parseLabels(raw.labels,imageWidth,imageHeight,region);
  if(labels.length===0)throw new Error('OCR: добавьте хотя бы одну проверенную надпись');
  return {scope:raw.scope as 'partial'|'complete',labels,region};
}
export function compareOcrReference(
  ref:ReturnType<typeof parseOcrReference>,predicted:OcrBox[]
):OcrReferenceComparison{
  // Complete ROI: only text *inside* the ROI is comparable. Outside entities
  // cannot be called false positives. Partial: keep readings intersecting
  // labelled boxes for CER/WER, but do NOT claim precision or false positives.
  const relevant=ref.scope==='legacy'?predicted:
    ref.scope==='complete'?predicted.filter(p=>inside(p,ref.region!)):
    predicted.filter(p=>ref.labels.some(g=>overlap(p,g)));
  const metrics=evaluateOcrAccuracy(ref.labels,relevant);
  return {scope:ref.scope,metrics,
    measuredPrecision:ref.scope==='complete'?metrics.precision:null,
    measuredFalsePositives:ref.scope==='complete'?metrics.falsePositive:null};
}
