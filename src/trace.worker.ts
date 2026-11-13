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
  const acc=new Map<number,number>();const angles:Array<{c:number;s:number}>=[];for(let t=0;t<180;t+=3)angles.push({c:Math.cos(t*Math.PI/180),s:Math.sin(t*Math.PI/180)});
  const rhoMax=Math.ceil(Math.hypot(width,height)/2)+1; const rhoStride=rhoMax*4+20;
  for(const p of pts)for(let t=0;t<angles.length;t++){
    const a=angles[t],r=Math.round((p.x*a.c+p.y*a.s)/2)+rhoMax;
    const key=t*rhoStride+r;acc.set(key,(acc.get(key)||0)+1);
  }
  const peak=[...acc].filter(([,votes])=>votes>=Math.max(9,Math.floor(minLength/5))).sort((a,b)=>b[1]-a[1]).slice(0,180);
  const found:Segment[]=[];
  for(const [key,votes] of peak){
    const strideR=rhoStride,t=Math.floor(key/strideR),r=(key-t*strideR-rhoMax)*2;
    const {c,s}=angles[t],along={x:-s,y:c},matches:number[]=[];
    for(const p of sampled)if(Math.abs(p.x*c+p.y*s-r)<1.7)matches.push(p.x*along.x+p.y*along.y);
    matches.sort((a,b)=>a-b);let first=matches[0],last=matches[0];
    const push=()=>{if(last-first<minLength)return;const a={x:(r*c+first*along.x)*scale,y:(r*s+first*along.y)*scale},b={x:(r*c+last*along.x)*scale,y:(r*s+last*along.y)*scale}; const confidence=Math.min(.95,.35+votes/150);if(!found.some(s=>Math.abs(s.a.x-a.x)<7*scale&&Math.abs(s.b.y-b.y)<7*scale&&Math.abs(Math.atan2(s.b.y-s.a.y,s.b.x-s.a.x)-Math.atan2(b.y-a.y,b.x-a.x))<.06))found.push({a,b,confidence});};
    for(let i=1;i<matches.length;i++){if(matches[i]-last>Math.max(12,minLength/4)){push();first=matches[i];}last=matches[i];}
    if(matches.length)push();
  }
  return found.sort((a,b)=>Math.hypot(b.b.x-b.a.x,b.b.y-b.a.y)-Math.hypot(a.b.x-a.a.x,a.b.y-a.a.y)).slice(0,2400);
}
self.onmessage=(ev:MessageEvent<Msg>)=>{try{(self as unknown as Worker).postMessage({lines:trace(ev.data)});}catch(e){(self as unknown as Worker).postMessage({error:String(e)});}};
export {};