/** W3: last-resort recall for long *one-pixel*, axis-aligned strokes.
 * Hough may miss 1px cyan/green CAD geometry when edge-gradient votes alias.
 * This pass reads original tonal pixels, NEVER fills gaps, and emits only
 * explicitly unsupported/unverified proposals for normal ink evidence review.
 */
import type {StrokeSegment} from './inkVoteDedup';
export function recoverThinAxisStrokes(
  tone:Uint8Array,width:number,height:number,threshold:number,
  minLength=24,maxCandidates=500,
):StrokeSegment[]{
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<6||height<6||
    tone.length<width*height||!Number.isFinite(threshold)||width*height>30_000_000)
    return [];
  const floor=Math.max(24,Math.min(1024,Math.ceil(minLength)));
  const limit=Math.max(0,Math.min(500,Math.floor(maxCandidates)));
  const dark=(x:number,y:number)=>tone[y*width+x]<=threshold;
  const found:StrokeSegment[]=[];
  const add=(x0:number,y0:number,x1:number,y1:number)=>{
    if(Math.hypot(x1-x0,y1-y0)+1<floor)return;
    found.push({a:{x:x0,y:y0},b:{x:x1,y:y1},confidence:.55});
  };
  for(let y=2;y<height-2;y++){
    let first=-1;
    for(let x=2;x<=width-2;x++){
      const eligible=x<width-2&&dark(x,y)&&!dark(x,y-1)&&!dark(x,y+1);
      if(eligible){if(first<0)first=x;}
      else if(first>=0){add(first,y,x-1,y);first=-1;}
    }
  }
  for(let x=2;x<width-2;x++){
    let first=-1;
    for(let y=2;y<=height-2;y++){
      const eligible=y<height-2&&dark(x,y)&&!dark(x-1,y)&&!dark(x+1,y);
      if(eligible){if(first<0)first=y;}
      else if(first>=0){add(x,first,x,y-1);first=-1;}
    }
  }
  found.sort((a,b)=>Math.hypot(b.b.x-b.a.x,b.b.y-b.a.y)-
    Math.hypot(a.b.x-a.a.x,a.b.y-a.a.y));
  return found.slice(0,limit);
}
