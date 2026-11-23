/** W3 browser-only refinement of Hough border hypotheses to their own
 * contiguous dark ink stroke. This is pixel geometry, not verified CAD. */
import type {StrokeSegment} from './inkVoteDedup';
import {scanInkTone} from './scanInkThreshold';
export interface InkCenterlineResult {lines:StrokeSegment[];adjusted:number}
const clamp=(v:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,v));
const median=(a:number[]):number=>{
  const xs=[...a].sort((x,y)=>x-y),m=Math.floor(xs.length/2);
  return xs.length%2?xs[m]:(xs[m-1]+xs[m])/2;
};
/** Never snap into a different line across white paper. */
export function refineStrokeCenterline(
  line:StrokeSegment,rgba:Uint8ClampedArray,width:number,height:number,inkThreshold=165
):StrokeSegment {
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<3||height<3||
     rgba.length<width*height*4)return line;
  const {a,b}=line;
  if(![a.x,a.y,b.x,b.y].every(Number.isFinite))return line;
  const dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy);
  if(len<18||len>1e7)return line;
  const nx=-dy/len,ny=dx/len;
  const count=clamp(Math.round(len/12),12,48);
  const dark=(x:number,y:number):boolean=>{
    const xx=Math.round(x),yy=Math.round(y);
    if(xx<0||yy<0||xx>=width||yy>=height)return false;
    const i=(yy*width+xx)*4;
    return scanInkTone(rgba[i],rgba[i+1],rgba[i+2])<=inkThreshold;
  };
  const centers:number[]=[];
  for(let i=0;i<count;i++){
    // Avoid junction-biased endpoints. Only sample the INNER original stroke.
    const t=(i+.5)/count,x=a.x+t*dx,y=a.y+t*dy;
    // Mandatory dark anchor prevents jumping into neighboring contours.
    if(!dark(x,y))continue;
    let left=0,right=0;
    while(left>-5&&dark(x+nx*(left-1),y+ny*(left-1)))left--;
    while(right<5&&dark(x+nx*(right+1),y+ny*(right+1)))right++;
    const strokeWidth=right-left+1;
    if(strokeWidth<2||strokeWidth>9)continue;
    centers.push((left+right)/2);
  }
  if(centers.length<Math.ceil(count*.65))return line;
  const mid=median(centers);
  const stable=centers.filter(x=>Math.abs(x-mid)<=1.25);
  if(stable.length<Math.ceil(count*.60))return line;
  const offset=median(stable);
  if(Math.abs(offset)<.3||Math.abs(offset)>3.5)return line;
  return {...line,a:{x:a.x+nx*offset,y:a.y+ny*offset},
    b:{x:b.x+nx*offset,y:b.y+ny*offset}};
}
export function refineStrokeCenters(
  lines:StrokeSegment[],rgba:Uint8ClampedArray,width:number,height:number,inkThreshold=165
):InkCenterlineResult {
  let adjusted=0;
  const refined=lines.map(line=>{
    const result=refineStrokeCenterline(line,rgba,width,height,inkThreshold);
    if(result!==line)adjusted++;
    return result;
  });
  return {lines:refined,adjusted};
}
