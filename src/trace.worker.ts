/// <reference lib="webworker" />
type P={x:number;y:number};type Segment={a:P;b:P;confidence:number};
interface Msg {rgba:Uint8ClampedArray;width:number;height:number;scale:number;minLength:number;}
function trace({rgba,width,height,scale,minLength}:Msg):Segment[]{
  const gray=new Uint8Array(width*height);const histogram=new Uint32Array(256);
  for(let i=0;i<gray.length;i++){const j=i*4;const g=Math.round(.299*rgba[j]+.587*rgba[j+1]+.114*rgba[j+2]);gray[i]=g;histogram[g]++;}
  let n=width*height,total=0;for(let i=0;i<256;i++)total+=i*histogram[i];
  let wb=0,best=-1,th=128,cnt=0;for(let i=0;i<256;i++){cnt+=histogram[i];if(!cnt)continue;const cf=n-cnt;if(!cf)break;wb+=i*histogram[i];const v=(total/cf-wb*(1/cf+1/cnt));const variance=cnt*cf*v*v;if(variance>best){best=variance;th=i;}}
  th=Math.max(45,Math.min(210,th));
  const sampled:P[]=[];const step=Math.max(1,Math.ceil(Math.sqrt(n/60000)));
  for(let y=1;y<height-1;y+=step)for(let x=1;x<width-1;x+=step){
    const i=y*width+x;if(gray[i]>=th)continue;
    if(gray[i-1]>=th||gray[i+1]>=th||gray[i-width]>=th||gray[i+width]>=th)sampled.push({x,y});
  }
  const stride=Math.max(1,Math.ceil(sampled.length/15000));const pts=sampled.filter((_,i)=>i%stride===0);
  const acc=new Map<number,number>();const angles:Array<{c:number;s:number}>=[];for(let t=0;t<180;t+=2)angles.push({c:Math.cos(t*Math.PI/180),s:Math.sin(t*Math.PI/180)});
  const rhoMax=Math.ceil(Math.hypot(width,height)/2)+1; const rhoStride=rhoMax*4+20;
  for(const p of pts)for(let t=0;t<angles.length;t++){
    const a=angles[t],r=Math.round((p.x*a.c+p.y*a.s)/2)+rhoMax;
    const key=t*rhoStride+r;acc.set(key,(acc.get(key)||0)+1);
  }
  const peak=[...acc].filter(([,votes])=>votes>=Math.max(7,Math.floor(minLength/5))).sort((a,b)=>b[1]-a[1]).slice(0,340);
  const found:Segment[]=[];
  for(const [key,votes] of peak){
    const strideR=rhoStride,t=Math.floor(key/strideR),r=(key-t*strideR-rhoMax)*2;
    const {c,s}=angles[t],along={x:-s,y:c},matches:number[]=[];
    for(const p of sampled)if(Math.abs(p.x*c+p.y*s-r)<1.7)matches.push(p.x*along.x+p.y*along.y);
    matches.sort((a,b)=>a-b);let first=matches[0],last=matches[0];
    const push=()=>{if(last-first<minLength)return;const a={x:(r*c+first*along.x)*scale,y:(r*s+first*along.y)*scale},b={x:(r*c+last*along.x)*scale,y:(r*s+last*along.y)*scale}; const confidence=Math.min(.95,.35+votes/150);if(!found.some(s=>Math.abs(s.a.x-a.x)<7*scale&&Math.abs(s.b.y-b.y)<7*scale&&Math.abs(Math.atan2(s.b.y-s.a.y,s.b.x-s.a.x)-Math.atan2(b.y-a.y,b.x-a.x))<.06))found.push({a,b,confidence});};
    for(let i=1;i<matches.length;i++){if(matches[i]-last>Math.max(7,minLength/3)){push();first=matches[i];}last=matches[i];}
    if(matches.length)push();
  }
  return found.sort((a,b)=>Math.hypot(b.b.x-b.a.x,b.b.y-b.a.y)-Math.hypot(a.b.x-a.a.x,a.b.y-a.a.y)).slice(0,3000);
}

interface CircleCandidate {x:number;y:number;radius:number;confidence:number;}
function detectCircles({rgba,width,height,scale}:Msg):CircleCandidate[] {
  const count=width*height,mask=new Uint8Array(count),visited=new Uint8Array(count);
  for(let i=0;i<count;i++){const j=i*4;mask[i]=(.299*rgba[j]+.587*rgba[j+1]+.114*rgba[j+2])<145?1:0;}
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
self.onmessage=(ev:MessageEvent<Msg>)=>{try{(self as unknown as Worker).postMessage({lines:trace(ev.data),circles:detectCircles(ev.data)});}catch(e){(self as unknown as Worker).postMessage({error:String(e)});}};
export {};