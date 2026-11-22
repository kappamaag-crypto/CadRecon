/** Deterministic, conservative OCR arbitration. Source geometry never changes.
 * Multiple tiles/passes can disagree on a technical value (e.g. 6000/8000).
 * Choose an alternative only with strong evidence; preserve disagreements in
 * the review reason. This is NOT semantic or dimensional verification.
 */
import type {OcrBox} from './ocrTiles';
export type OcrPass='primary'|'retry'|'rotated';
export interface OcrReading extends OcrBox {
  confidence:number;pass:OcrPass;alternatives?:string[];
}
export interface OcrConsensus {
  readings:OcrReading[];duplicates:number;conflicts:number;promoted:number;
}
const area=(r:OcrBox)=>Math.max(0,(r.x1-r.x0)*(r.y1-r.y0));
const bounded=(r:OcrReading)=>[r.x0,r.y0,r.x1,r.y1,r.confidence].every(Number.isFinite)
  &&r.x1>r.x0&&r.y1>r.y0&&r.text.trim().length>0&&r.text.length<=4000;
export function overlappingOcrRegions(a:OcrBox,b:OcrBox):boolean {
  const ia=Math.max(0,Math.min(a.x1,b.x1)-Math.max(a.x0,b.x0))*
    Math.max(0,Math.min(a.y1,b.y1)-Math.max(a.y0,b.y0));
  const aa=area(a),ba=area(b);
  const ha=a.y1-a.y0,hb=b.y1-b.y0;
  return Math.min(aa,ba)>0&&ia/Math.min(aa,ba)>=.75&&
    Math.min(ha,hb)/Math.max(ha,hb)>=.55;
}
export function reconcileOcrReadings(raw:OcrReading[]):OcrConsensus{
  const readings:OcrReading[]=[];
  let duplicates=0,conflicts=0,promoted=0;
  // Same-sheet spatial bins; never merge merely because technical text matches.
  const grid=new Map<string,number[]>();
  const cell=128;
  const key=(x:number,y:number)=>x+':'+y;
  for(const value of raw){
    if(!bounded(value))continue;
    const r={...value,confidence:Math.max(0,Math.min(1,value.confidence))};
    const minX=Math.floor(r.x0/cell),maxX=Math.floor(r.x1/cell);
    const minY=Math.floor(r.y0/cell),maxY=Math.floor(r.y1/cell);
    const extent=(maxX-minX+1)*(maxY-minY+1);
    let index=-1;
    if(extent<=256){
      const candidates=new Set<number>();
      for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++)
        for(const i of grid.get(key(x,y))||[])candidates.add(i);
      for(const i of candidates){
        if(overlappingOcrRegions(readings[i],r)){index=i;break;}
      }
    }
    if(index<0){
      index=readings.length;
      readings.push({...r,alternatives:[]});
      if(extent<=256)for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){
        const k=key(x,y),bucket=grid.get(k)||[];bucket.push(index);grid.set(k,bucket);
      }
      continue;
    }
    const previous=readings[index];
    if(previous.text.trim()===r.text.trim()){
      duplicates++;
      if(r.confidence>previous.confidence)readings[index]={...previous,confidence:r.confidence};
      continue;
    }
    conflicts++;
    const first=previous.text;
    const other=r.text;
    const alternatives=new Set([...(previous.alternatives||[]),other]);
    if(r.confidence>=previous.confidence+.18&&previous.confidence<.72){
      // Repeated OCR with larger/cleaner text sometimes fixes low confidence,
      // but preserve both alternatives and require review.
      alternatives.delete(other);alternatives.add(first);
      readings[index]={...r,alternatives:[...alternatives].slice(0,6)};
      promoted++;
    }else{
      readings[index]={...previous,alternatives:[...alternatives].slice(0,6)};
    }
  }
  return {readings,duplicates,conflicts,promoted};
}
