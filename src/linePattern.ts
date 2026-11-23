/** W3: label repeated dark marks on a Hough axis without joining arbitrary
 * white gaps. The result is an UNVERIFIED line-style proposal, not an ink mask
 * or a dimension measurement. No network or image transfer is used.
 */
import type {StrokeSegment} from './inkVoteDedup';
import {scanInkTone} from './scanInkThreshold';
export type LinePatternStyle='dashed'|'center';
export interface LinePattern {style:LinePatternStyle;marks:number;coverage:number}
type Run={ink:boolean;length:number};
const median=(a:number[])=>{const s=[...a].sort((x,y)=>x-y);return s[Math.floor(s.length/2)]||0;};
const stable=(a:number[],fraction:number)=>a.length>0&&Math.max(...a)<=Math.max(1,median(a))*fraction&&Math.min(...a)>=Math.max(1,median(a)) / fraction;

export function classifyLinePattern(
  line:StrokeSegment,rgba:Uint8ClampedArray,width:number,height:number,inkThreshold=165
):LinePattern|null{
  if(width<40||height<20||rgba.length<width*height*4)return null;
  const {a,b}=line,dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy);
  if(![a.x,a.y,b.x,b.y].every(Number.isFinite)||length<55||length>2400)return null;
  const nx=-dy/length,ny=dx/length;
  const count=Math.ceil(length);
  const marks:boolean[]=[];
  for(let i=0;i<=count;i++){
    const t=i/count,x=a.x+t*dx,y=a.y+t*dy;
    let ink=false;
    for(const offset of [-2,-1,0,1,2]){
      const xx=Math.round(x+nx*offset),yy=Math.round(y+ny*offset);
      if(xx<0||yy<0||xx>=width||yy>=height)continue;
      const j=(yy*width+xx)*4;
      if(scanInkTone(rgba[j],rgba[j+1],rgba[j+2])<=inkThreshold){ink=true;break;}
    }
    marks.push(ink);
  }
  // Remove one-pixel antialiasing defects, but do not bridge real 2px+ gaps.
  for(let i=1;i<marks.length-1;i++){
    if(marks[i-1]===marks[i+1]&&marks[i]!==marks[i-1]){marks[i]=marks[i-1];i++;}
  }
  const runs:Run[]=[];
  for(const bit of marks){
    const last=runs[runs.length-1];
    if(last&&last.ink===bit)last.length++;
    else runs.push({ink:bit,length:1});
  }
  while(runs.length&&!runs[0].ink)runs.shift();
  while(runs.length&&!runs[runs.length-1].ink)runs.pop();
  if(runs.length<7||runs.length%2===0)return null;
  const dark=runs.filter(x=>x.ink).map(x=>x.length);
  const gaps=runs.filter(x=>!x.ink).map(x=>x.length);
  if(dark.length<4||gaps.length<3||Math.min(...dark)<2||Math.min(...gaps)<3)return null;
  const total=runs.reduce((sum,x)=>sum+x.length,0);
  const coverage=dark.reduce((sum,x)=>sum+x,0)/total;
  if(coverage<.20||coverage>.84||!stable(gaps,2.4))return null;
  // Centre-line: long–dot–long–dot–long, rather than just any punctuated ink.
  const largest=Math.max(...dark);
  const longs=dark.map(v=>v>=largest*.70);
  const dots=dark.map(v=>v<=largest*.38);
  if(dark.length>=5&&longs.filter(Boolean).length>=2&&dots.filter(Boolean).length>=2&&
    dark.every((_,i)=>i%2===0?longs[i]:dots[i])){
    const longSizes=dark.filter((_,i)=>i%2===0);
    const shortSizes=dark.filter((_,i)=>i%2===1);
    if(stable(longSizes,1.8)&&stable(shortSizes,2))return {style:'center',marks:dark.length,coverage};
  }
  // Conventional dashed: at least four similarly sized dashes and regular
  // gaps. A sparse outline or accidental missing scan ink is NOT enough.
  if(dark.length>=4&&stable(dark,1.75))
    return {style:'dashed',marks:dark.length,coverage};
  return null;
}
