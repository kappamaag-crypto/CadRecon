/**
 * Rank a proposed Hough LINE by support in the source monochrome ink.
 * This is NOT a posterior probability that the engineering entity is correct.
 * It may give high support to printed text, table borders and a circle tangent.
 * Therefore low support downgrades, but high support never verifies a line.
 */
export type InkPoint={x:number;y:number};
export type InkLineCandidate={a:InkPoint;b:InkPoint;confidence:number};
export type Evidence={support:number;samples:number;adjustedScore:number;longestBlankRun:number;blankRunRatio:number};

export function rankLineByInkEvidence(
  line:InkLineCandidate,rgba:Uint8ClampedArray,width:number,height:number,
  maxSamples=80,inkThreshold=175
):Evidence{
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<=0||height<=0||
     rgba.length<width*height*4)
    return {support:0,samples:0,adjustedScore:0,longestBlankRun:0,blankRunRatio:0};
  const {a,b}=line,dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy);
  if(!Number.isFinite(length)||length<1||![a.x,a.y,b.x,b.y].every(Number.isFinite))
    return {support:0,samples:0,adjustedScore:0,longestBlankRun:0,blankRunRatio:0};
  const n={x:-dy/length,y:dx/length};
  const samples=Math.max(12,Math.min(maxSamples,Math.ceil(length/6)));
  let hits=0,currentBlank=0,longestBlankRun=0;
  for(let i=0;i<samples;i++){
    const t=(i+.5)/samples,x=a.x+dx*t,y=a.y+dy*t;
    let onInk=false;
    for(const off of [-2,-1,0,1,2]){
      const xx=Math.round(x+n.x*off),yy=Math.round(y+n.y*off);
      if(xx<0||yy<0||xx>=width||yy>=height)continue;
      const at=(yy*width+xx)*4;
      const brightness=.299*rgba[at]+.587*rgba[at+1]+.114*rgba[at+2];
      if(brightness<=inkThreshold){onInk=true;break;}
    }
    if(onInk){hits++;currentBlank=0;}
    else{currentBlank++;longestBlankRun=Math.max(longestBlankRun,currentBlank);}
  }
  const support=hits/samples;
  const blankRunRatio=longestBlankRun/samples;
  // Hough confidence is itself a heuristic. Use a conservative geometric
  // penalty for unsupported segments and never elevate its original score.
  const raw=Number.isFinite(line.confidence)?Math.max(0,Math.min(1,line.confidence)):0;
  // A sustained white gap is stronger negative evidence than isolated misses.
  // Only reduces confidence, never invents a CAD geometry or approval.
  const continuity=blankRunRatio>=.12?1-blankRunRatio:1;
  return {support,samples,longestBlankRun,blankRunRatio,
    adjustedScore:Math.min(raw,.12+.84*support*continuity)};
}
