/** Source-pixel OCR benchmark (not OCR engine confidence).
 * Compare independently annotated ground truth to CAD OCR candidates.
 * No calibration to millimeters and no server involvement.
 */
import type {OcrBox} from './ocrTiles';
export interface OcrGolden extends OcrBox {id:string;}
export interface OcrMeasurement {
  expected:number;detected:number;matched:number;missed:number;falsePositive:number;
  precision:number;recall:number;cer:number;wer:number;
  criticalTokens:number;criticalExact:number;criticalExactRate:number;
}
const length=(v:string)=>[...v].length;
const words=(v:string)=>v.trim().split(/\s+/u).filter(Boolean);
const ed=<T>(a:T[],b:T[]):number=>{
  let before=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++){
    const after=[i];
    for(let j=1;j<=b.length;j++)
      after.push(Math.min(after[j-1]+1,before[j]+1,
        before[j-1]+(a[i-1]===b[j-1]?0:1)));
    before=after;
  }
  return before[b.length];
};
const intersection=(a:OcrBox,b:OcrBox)=>{
  const dx=Math.max(0,Math.min(a.x1,b.x1)-Math.max(a.x0,b.x0));
  const dy=Math.max(0,Math.min(a.y1,b.y1)-Math.max(a.y0,b.y0));
  return dx*dy;
};
const area=(a:OcrBox)=>Math.max(0,a.x1-a.x0)*Math.max(0,a.y1-a.y0);
const iou=(a:OcrBox,b:OcrBox)=>{
  const common=intersection(a,b),denom=area(a)+area(b)-common;
  return denom>0?common/denom:0;
};
const critical=(v:string)=>/[0-9±⌀Ø∅∅°×]/u.test(v);
/** Bounded one-to-one IoU assignment. Unpaired expected text counts as missed,
 * unpaired detected as false positive; never hides extra duplicate labels.
 */
export function evaluateOcrAccuracy(
  groundTruth:OcrGolden[],predicted:OcrBox[],threshold=.45
):OcrMeasurement{
  if(!Number.isFinite(threshold)||threshold<.1||threshold>1)
    throw new Error('OCR metric: invalid IoU threshold');
  if(groundTruth.length>2000||predicted.length>2000)
    throw new Error('OCR metric: maximum 2000 labels per run');
  if([...groundTruth,...predicted].some(x=>![x.x0,x.y0,x.x1,x.y1].every(Number.isFinite)||
    x.x1<=x.x0||x.y1<=x.y0||x.text.length>400))
    throw new Error('OCR metric: malformed bbox or oversized text');
  // Keep user-imported benchmark data from exhausting a browser tab.
  const totalChars=[...groundTruth,...predicted].reduce((s,r)=>s+r.text.length,0);
  if(totalChars>30000)throw new Error('OCR metric: more than 30000 annotation characters');
  const pairs:Array<{i:number;j:number;score:number}>=[];
  for(let i=0;i<groundTruth.length;i++)for(let j=0;j<predicted.length;j++){
    const score=iou(groundTruth[i],predicted[j]);
    if(score>=threshold){
      if(pairs.length>=30000)throw new Error('OCR metric: too many overlapping ground-truth boxes');
      pairs.push({i,j,score});
    }
  }
  pairs.sort((a,b)=>b.score-a.score||a.i-b.i||a.j-b.j);
  const refs=new Set<number>(),used=new Set<number>();
  let charErrors=0,referenceChars=0,wordErrors=0,referenceWords=0;
  let criticalTokens=0,criticalExact=0;
  for(const p of pairs){
    if(refs.has(p.i)||used.has(p.j))continue;
    refs.add(p.i);used.add(p.j);
    const e=groundTruth[p.i].text,o=predicted[p.j].text;
    charErrors+=ed([...e],[...o]);referenceChars+=length(e);
    wordErrors+=ed(words(e),words(o));referenceWords+=words(e).length;
    if(critical(e)){criticalTokens++;if(e===o)criticalExact++;}
  }
  for(let i=0;i<groundTruth.length;i++){
    if(refs.has(i))continue;
    const e=groundTruth[i].text;
    charErrors+=length(e);referenceChars+=length(e);
    wordErrors+=words(e).length;referenceWords+=words(e).length;
    if(critical(e))criticalTokens++;
  }
  for(let j=0;j<predicted.length;j++){
    if(used.has(j))continue;
    charErrors+=length(predicted[j].text);
    wordErrors+=words(predicted[j].text).length;
  }
  const matched=refs.size,missed=groundTruth.length-matched,
    falsePositive=predicted.length-matched;
  return {expected:groundTruth.length,detected:predicted.length,matched,missed,falsePositive,
    precision:predicted.length?matched/predicted.length:groundTruth.length?0:1,
    recall:groundTruth.length?matched/groundTruth.length:1,
    cer:referenceChars?charErrors/referenceChars:charErrors?1:0,
    wer:referenceWords?wordErrors/referenceWords:wordErrors?1:0,
    criticalTokens,criticalExact,criticalExactRate:criticalTokens?criticalExact/criticalTokens:1};
}
