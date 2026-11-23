/// <reference lib="webworker" />
import {detectOverlappedCircles} from './circleDetector';
import {suppressRedundantCircleStrokes} from './circleStrokeFilter';
import {deduplicateInkStrokeVotes,sameFiniteLine} from './inkVoteDedup';
import {rankLineByInkEvidence} from './lineEvidence';
import {refineStrokeCenters} from './inkCenterline';
import {classifyLinePattern} from './linePattern';
import {otsuInkThreshold,scanInkTone} from './scanInkThreshold';
import {inferStrokeNormal,normalAgrees,type InkNormal} from './edgeOrientation';
type P={x:number;y:number};type EdgeP=P&{normal:InkNormal};type Segment={a:P;b:P;confidence:number;lineStyle?:'dashed'|'center';patternMarks?:number};
interface Msg {rgba:Uint8ClampedArray;width:number;height:number;scale:number;minLength:number;}
function trace({rgba,width,height,scale,minLength}:Msg):{lines:Segment[];threshold:number}{
  const gray=new Uint8Array(width*height);const histogram=new Uint32Array(256);
  for(let i=0;i<gray.length;i++){const j=i*4;const g=scanInkTone(rgba[j],rgba[j+1],rgba[j+2]);gray[i]=g;histogram[g]++;}
  const n=width*height;
  // Inclusive Otsu ink threshold: equality is common on faded photocopies.
  const th=otsuInkThreshold(histogram);
  // Evaluate EVERY pixel before sampling. The previous fixed (x,y) grid
  // could hit only the interior of a 3px vertical/horizontal stroke, losing
  // its entire boundary and fabricating a false "nothing detected" result.
  const edgeMask=new Uint8Array(n);
  let edgeCount=0;
  for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){
    const i=y*width+x;
    if(gray[i]>th)continue;
    if(gray[i-1]>th||gray[i+1]>th||gray[i-width]>th||gray[i+width]>th){
      edgeMask[i]=1;edgeCount++;
    }
  }
  const sampled:EdgeP[]=[];
  // Bound Hough/fit time while sampling from the complete edge population,
  // never from a periodic pixel grid that can alias away whole thin strokes.
  // Most edge pixels have ONE local normal. Voting at every angle invents
  // tangent/chord candidates from circles, printed text and random noise.
  const edgeStride=Math.max(1,Math.ceil(edgeCount/45000));
  let observed=0;
  for(let i=0;i<n;i++){
    if(!edgeMask[i])continue;
    if(observed++%edgeStride!==0)continue;
    const x=i%width,y=Math.floor(i/width);
    const normal=inferStrokeNormal(gray,width,height,x,y,th);
    if(normal)sampled.push({x,y,normal});
  }
  const stride=Math.max(1,Math.ceil(sampled.length/15000));
  const pts=sampled.filter((_,i)=>i%stride===0);
  const acc=new Map<number,number>();const angles:Array<{c:number;s:number}>=[];for(let t=0;t<180;t+=2)angles.push({c:Math.cos(t*Math.PI/180),s:Math.sin(t*Math.PI/180)});
  const rhoMax=Math.ceil(Math.hypot(width,height)/2)+1; const rhoStride=rhoMax*4+20;
  for(const p of pts)for(let t=0;t<angles.length;t++){
    const a=angles[t];
    if(!normalAgrees(p.normal,a.c,a.s))continue;
    const r=Math.round((p.x*a.c+p.y*a.s)/2)+rhoMax;
    const key=t*rhoStride+r;acc.set(key,(acc.get(key)||0)+1);
  }
  const peak=[...acc].filter(([,votes])=>votes>=Math.max(7,Math.floor(minLength/5))).sort((a,b)=>b[1]-a[1]).slice(0,340);
  const found:Segment[]=[];
  for(const [key,votes] of peak){
    const strideR=rhoStride,t=Math.floor(key/strideR),r=(key-t*strideR-rhoMax)*2;
    const {c,s}=angles[t],along={x:-s,y:c},matches:number[]=[];
    for(const p of sampled)if(normalAgrees(p.normal,c,s)&&Math.abs(p.x*c+p.y*s-r)<1.7)
      matches.push(p.x*along.x+p.y*along.y);
    matches.sort((a,b)=>a-b);
    // Test the full Hough axis before splitting at white spaces. Repeated
    // dashed/centre marks can form one editable STYLED LINE proposal without
    // claiming that each white gap contains a solid stroke.
    if(matches.length>=4&&matches[matches.length-1]-matches[0]>minLength*3){
      const start=matches[0],end=matches[matches.length-1];
      const full={a:{x:r*c+start*along.x,y:r*s+start*along.y},
        b:{x:r*c+end*along.x,y:r*s+end*along.y},confidence:Math.min(.80,.35+votes/150)};
      const pattern=classifyLinePattern(full,rgba,width,height,th);
      if(pattern){
        const candidate:Segment={a:{x:full.a.x*scale,y:full.a.y*scale},
          b:{x:full.b.x*scale,y:full.b.y*scale},
          confidence:Math.min(full.confidence,.75),lineStyle:pattern.style,patternMarks:pattern.marks};
        if(!found.some(previous=>previous.lineStyle===candidate.lineStyle&&sameFiniteLine(previous,candidate,2.5*scale))){
          found.push(candidate);
        }
        continue;
      }
    }
    let first=matches[0],last=matches[0];
    const push=()=>{if(last-first<minLength)return;const a={x:(r*c+first*along.x)*scale,y:(r*s+first*along.y)*scale},b={x:(r*c+last*along.x)*scale,y:(r*s+last*along.y)*scale}; const confidence=Math.min(.95,.35+votes/150);if(!found.some(s=>sameFiniteLine(s,{a,b,confidence},2.5*scale)))found.push({a,b,confidence});};
    for(let i=1;i<matches.length;i++){if(matches[i]-last>Math.max(7,minLength/3)){push();first=matches[i];}last=matches[i];}
    if(matches.length)push();
  }
  return {lines:found.sort((a,b)=>Math.hypot(b.b.x-b.a.x,b.b.y-b.a.y)-Math.hypot(a.b.x-a.a.x,a.b.y-a.a.y)).slice(0,3000),threshold:th};
}

interface CircleCandidate {x:number;y:number;radius:number;confidence:number;}
function detectCircles({rgba,width,height,scale}:Msg,threshold=145):CircleCandidate[] {
  const count=width*height,mask=new Uint8Array(count),visited=new Uint8Array(count);
  for(let i=0;i<count;i++){const j=i*4;mask[i]=scanInkTone(rgba[j],rgba[j+1],rgba[j+2])<=threshold?1:0;}
  const queue=new Int32Array(count),circles:CircleCandidate[]=[];
  for(let start=0;start<count;start++){
    if(!mask[start]||visited[start])continue;
    visited[start]=1;queue[0]=start;let head=0,tail=1,minx=width,miny=height,maxx=0,maxy=0;
    const sample:number[]=[];
    while(head<tail){
      const at=queue[head++],x=at%width,y=Math.floor(at/width);
      if(x<minx)minx=x;if(y<miny)miny=y;if(x>maxx)maxx=x;if(y>maxy)maxy=y;
      if(sample.length<30000)sample.push(at);
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        if(!dx&&!dy)continue;
        const xx=x+dx,yy=y+dy;if(xx<0||yy<0||xx>=width||yy>=height)continue;
        const k=yy*width+xx;if(mask[k]&&!visited[k]){visited[k]=1;queue[tail++]=k;}
      }
    }
    const w=maxx-minx+1,h=maxy-miny+1, r=(w+h)/4;
    if(tail<24||tail>30000||w<12||h<12||w>450||h>450||w/h<.82||w/h>1.22)continue;
    const cx=(minx+maxx)/2,cy=(miny+maxy)/2;
    const tolerance=Math.max(2,r*.18);
    let matches=0;
    for(const k of sample){const x=k%width,y=Math.floor(k/width);if(Math.abs(Math.hypot(x-cx,y-cy)-r)<tolerance)matches++;}
    const ratio=matches/sample.length;
    if(ratio<.77)continue;
    const candidate={x:cx*scale,y:cy*scale,radius:r*scale,confidence:Math.min(.95,ratio)};
    if(!circles.some(c=>Math.hypot(c.x-candidate.x,c.y-candidate.y)<r*scale*.3))circles.push(candidate);
    if(circles.length>=300)break;
  }
  return circles;
}
self.onmessage=(ev:MessageEvent<Msg>)=>{try{
  const msg=ev.data;
  const traced=trace(msg);
  const inkThreshold=traced.threshold;
  const circles=detectCircles(msg,inkThreshold);
  // Circle+line intersections are a single connected contour; independent
  // gradient voting recovers candidates the contour-only pass cannot see.
  for(const p of detectOverlappedCircles(msg.rgba,msg.width,msg.height,25,undefined,inkThreshold)){
    const c={x:p.x*msg.scale,y:p.y*msg.scale,radius:p.radius*msg.scale,confidence:p.confidence};
    if(!circles.some(x=>Math.hypot(x.x-c.x,x.y-c.y)<Math.max(6,c.radius*.12)&&
      Math.abs(x.radius-c.radius)<Math.max(5,c.radius*.1)))circles.push(c);
  }
  const filtered=suppressRedundantCircleStrokes(traced.lines,circles);
  const centered=refineStrokeCenters(filtered.lines,msg.rgba,msg.width,msg.height,inkThreshold);
  const dedup=deduplicateInkStrokeVotes(centered.lines,msg.rgba,msg.width,msg.height,inkThreshold);
  (self as unknown as Worker).postMessage({
    lines:dedup.lines.map(line=>{const rank=rankLineByInkEvidence(line,msg.rgba,msg.width,msg.height,512,inkThreshold);return {...line,confidence:rank.adjustedScore,inkSupport:rank.support,blankRunRatio:rank.blankRunRatio,blankRunPixels:rank.blankRunPixels};}),circles:circles.slice(0,300),
    circleStrokeDuplicates:filtered.removed,inkStrokeDuplicates:dedup.removed,
    centerlineAdjusted:centered.adjusted,
  });
}catch(e){(self as unknown as Worker).postMessage({error:String(e)});}};
export {};