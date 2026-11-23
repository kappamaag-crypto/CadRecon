/** Private, browser-only geometry benchmark for independently reviewed CAD markup.
 * NOT a pixel/OCR accuracy guarantee. No network, no mutations, no inferred mm.
 * A screenshot with blue overlay is a draft until an engineer explicitly reviews
 * its LINE/CIRCLE coordinates against the source drawing.
 */
import type {Entity,Point} from './model';
export interface GeometryReference {
  version:1;
  reviewed:true;
  imageWidth:number;imageHeight:number;
  scope:'partial'|'complete';
  region?:{x0:number;y0:number;x1:number;y1:number};
  lines:{id:string;a:Point;b:Point}[];
  circles:{id:string;center:Point;radius:number}[];
}
export interface GeometryMeasurement {
  scope:'partial'|'complete';
  expectedLines:number;detectedLines:number;
  lineCoverage:number;coveredLines:number;
  missingLines:{id:string;coverage:number}[];
  /** Null on partial ground truth: unlabeled geometry is NOT a false positive. */
  unsupportedCandidates:number|null;
  candidateAgreement:number|null;
  expectedCircles:number;detectedCircles:number;matchedCircles:number;
  missingCircles:string[];
  extraCircles:number|null;
  meanCircleCenterErrorPx:number|null;
  meanCircleRadiusErrorPx:number|null;
  tolerancePx:number;
}
type Segment={a:Point;b:Point};
type Circle={center:Point;radius:number};
type Rect={x0:number;y0:number;x1:number;y1:number};
const dot=(a:Point,b:Point)=>a.x*b.x+a.y*b.y;
const delta=(a:Point,b:Point):Point=>({x:a.x-b.x,y:a.y-b.y});
const len=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y);
const finite=(p:Point)=>!!p&&Number.isFinite(p.x)&&Number.isFinite(p.y);
const inside=(p:Point,rect:Rect)=>p.x>=rect.x0&&p.y>=rect.y0&&p.x<=rect.x1&&p.y<=rect.y1;
const boxIntersect=(a:Rect,b:Rect,tol:number)=>a.x0<=b.x1+tol&&a.x1>=b.x0-tol&&a.y0<=b.y1+tol&&a.y1>=b.y0-tol;
const box=(s:Segment):Rect=>({x0:Math.min(s.a.x,s.b.x),x1:Math.max(s.a.x,s.b.x),
  y0:Math.min(s.a.y,s.b.y),y1:Math.max(s.a.y,s.b.y)});
function clip(s:Segment,r:Rect):Segment|null {
  // Liang–Barsky against a measurement ROI. Clipping here is for comparison
  // ONLY; never edits a recovered CAD entity or silently joins a gap.
  let t0=0,t1=1;
  const dx=s.b.x-s.a.x,dy=s.b.y-s.a.y;
  for(const [p,q] of [[-dx,s.a.x-r.x0],[dx,r.x1-s.a.x],[-dy,s.a.y-r.y0],[dy,r.y1-s.a.y]]){
    if(Math.abs(p)<1e-12){if(q<0)return null;continue;}
    const t=q/p;
    if(p<0)t0=Math.max(t0,t);
    else t1=Math.min(t1,t);
    if(t0>=t1)return null;
  }
  return {a:{x:s.a.x+t0*dx,y:s.a.y+t0*dy},
    b:{x:s.a.x+t1*dx,y:s.a.y+t1*dy}};
}
function distanceToSegment(p:Point,s:Segment):number {
  const v=delta(s.b,s.a),dd=dot(v,v);
  if(dd<1e-12)return len(p,s.a);
  const t=Math.max(0,Math.min(1,dot(delta(p,s.a),v)/dd));
  return len(p,{x:s.a.x+t*v.x,y:s.a.y+t*v.y});
}
function angleMatch(a:Segment,b:Segment):boolean {
  const aa=delta(a.b,a.a),bb=delta(b.b,b.a);
  const n=Math.hypot(aa.x,aa.y)*Math.hypot(bb.x,bb.y);
  return n>1e-10&&Math.abs(dot(aa,bb)/n)>=Math.cos(Math.PI/24); // 7.5 degrees
}
function coverage(target:Segment,source:Segment[],tolerance:number):number {
  const d=len(target.a,target.b);
  const count=Math.max(8,Math.min(128,Math.ceil(d/2)));
  let hits=0;
  for(let i=0;i<=count;i++){
    const t=i/count,p={x:target.a.x+(target.b.x-target.a.x)*t,
      y:target.a.y+(target.b.y-target.a.y)*t};
    if(source.some(s=>distanceToSegment(p,s)<=tolerance))hits++;
  }
  return hits/(count+1);
}
const entry=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export function parseGeometryReference(raw:unknown):GeometryReference {
  if(!entry(raw)||raw.version!==1||raw.reviewed!==true||
    raw.scope!=='partial'&&raw.scope!=='complete')
    throw new Error('Геометрический эталон: требуется version=1, reviewed=true и scope partial/complete');
  const w=raw.imageWidth,h=raw.imageHeight;
  if(typeof w!=='number'||typeof h!=='number'||
    !Number.isInteger(w)||!Number.isInteger(h)||w<2||h<2||
    w>20000||h>20000)
    throw new Error('Геометрический эталон: неверные размеры изображения');
  if(!Array.isArray(raw.lines)||!Array.isArray(raw.circles)||
    raw.lines.length+raw.circles.length<1||
    raw.lines.length>250||raw.circles.length>100)
    throw new Error('Геометрический эталон: ожидается 1–350 проверенных LINE/CIRCLE');
  const rect:Rect={x0:0,y0:0,x1:w,y1:h};
  if(raw.region!==undefined){
    const region=raw.region;
    if(!entry(region))throw new Error('Геометрический эталон: неверная область');
    const {x0,y0,x1,y1}=region;
    if(![x0,y0,x1,y1].every(v=>typeof v==='number'&&Number.isFinite(v))||
      !(Number(x0)>=0&&Number(y0)>=0&&Number(x1)<=w&&Number(y1)<=h&&
        Number(x1)>Number(x0)&&Number(y1)>Number(y0)))
      throw new Error('Геометрический эталон: область вне изображения');
    Object.assign(rect,{x0,y0,x1,y1});
  }
  if(raw.scope==='complete'&&!raw.region)
    throw new Error('Для полного эталона обязательно задайте ограниченную полностью размеченную область region');
  const ids=new Set<string>();
  function checkId(item:Record<string,unknown>):void {
    if(typeof item.id!=='string'||item.id.length<1||item.id.length>90||ids.has(item.id))
      throw new Error('Геометрический эталон: неверный или повторный id');
    ids.add(item.id);
  }
  for(const item of raw.lines){
    if(!entry(item))throw new Error('Геометрический эталон: неверный LINE');
    checkId(item);
    if(!finite(item.a as Point)||!finite(item.b as Point)||
      !inside(item.a as Point,rect)||!inside(item.b as Point,rect)||
      len(item.a as Point,item.b as Point)<2)
      throw new Error('Геометрический эталон: неверные координаты LINE '+item.id);
  }
  for(const item of raw.circles){
    if(!entry(item))throw new Error('Геометрический эталон: неверный CIRCLE');
    checkId(item);
    const center=item.center as Point, radius=item.radius;
    if(!finite(center)||!inside(center,rect)||
      typeof radius!=='number'||!Number.isFinite(radius)||radius<2||
      radius>Math.max(w,h)||
      center.x-radius<rect.x0||center.x+radius>rect.x1||
      center.y-radius<rect.y0||center.y+radius>rect.y1)
      throw new Error('Геометрический эталон: окружность не помещается в область '+item.id);
  }
  return raw as unknown as GeometryReference;
}
export function measureGeometryAgainstReference(
  reference:GeometryReference,entities:Entity[],
  sheetSize:{width:number;height:number},tolerancePx=3
):GeometryMeasurement {
  if(!Number.isFinite(tolerancePx)||tolerancePx<.5||tolerancePx>10)
    throw new Error('Геометрический эталон: допуск 0.5–10 пикселей');
  if(![sheetSize.width,sheetSize.height].every(Number.isFinite)||
    sheetSize.width<=0||sheetSize.height<=0)
    throw new Error('Геометрический эталон: размер листа неверен');
  if(entities.length>30000)throw new Error('Геометрический эталон: более 30000 объектов');
  const sx=reference.imageWidth/sheetSize.width,sy=reference.imageHeight/sheetSize.height;
  const roi:Rect=reference.region||{x0:0,y0:0,x1:reference.imageWidth,y1:reference.imageHeight};
  const predicted:Segment[]=[],foundCircles:Circle[]=[];
  for(const e of entities){
    // Do not benchmark manual corrections as automatic reconstruction.
    if(e.origin!=='trace'&&e.origin!=='pdf')continue;
    if((e.kind==='line'||e.kind==='polyline')&&e.points.length>=2&&
      e.points.length<=3000&&e.points.every(finite)){
      const pts=e.points.map(p=>({x:p.x*sx,y:p.y*sy}));
      const count=e.closed&&e.kind==='polyline'?pts.length:pts.length-1;
      for(let i=0;i<count;i++){
        const s=clip({a:pts[i],b:pts[(i+1)%pts.length]},roi);
        if(s&&len(s.a,s.b)>=2)predicted.push(s);
        if(predicted.length>10000)throw new Error('Геометрический эталон: >10000 отрезков в области; уменьшите region');
      }
    }
    if(e.kind==='circle'&&e.center&&finite(e.center)&&e.radius&&e.radius>0){
      // Anisotropic viewport mapping deforms circles: do not pretend radius
      // is circular if source coordinates have different axis scales.
      const center={x:e.center.x*sx,y:e.center.y*sy},rx=e.radius*sx,ry=e.radius*sy;
      if(Math.abs(rx-ry)>.02*Math.max(rx,ry))continue;
      const circle={center,radius:(rx+ry)/2};
      if(inside({x:center.x-circle.radius,y:center.y-circle.radius},roi)&&
         inside({x:center.x+circle.radius,y:center.y+circle.radius},roi))
        foundCircles.push(circle);
    }
  }
  const lows:{id:string;coverage:number}[]=[];
  let weighted=0,total=0,coveredLines=0;
  for(const ref of reference.lines){
    const target={a:ref.a,b:ref.b};
    const near=predicted.filter(s=>angleMatch(target,s)&&boxIntersect(box(target),box(s),tolerancePx));
    const ratio=coverage(target,near,tolerancePx);
    weighted+=ratio*len(target.a,target.b);total+=len(target.a,target.b);
    if(ratio>=.90)coveredLines++;
    else lows.push({id:ref.id,coverage:ratio});
  }
  const matched=new Set<number>(),matchedRefs=new Set<string>();
  let centerError=0,radiusError=0;
  for(const ref of reference.circles){
    let best=-1,bestError=Infinity;
    for(let i=0;i<foundCircles.length;i++){
      if(matched.has(i))continue;
      const dc=len(ref.center,foundCircles[i].center),
        dr=Math.abs(ref.radius-foundCircles[i].radius);
      if(dc>tolerancePx||dr>tolerancePx)continue;
      if(dc+dr<bestError){best=i;bestError=dc+dr;}
    }
    if(best>=0){matched.add(best);matchedRefs.add(ref.id);
      centerError+=len(ref.center,foundCircles[best].center);
      radiusError+=Math.abs(ref.radius-foundCircles[best].radius);}
  }
  const missingCircles=reference.circles.filter(ref=>!matchedRefs.has(ref.id))
    .map(ref=>ref.id);
  const complete=reference.scope==='complete';
  let unsupported=0;
  if(complete){
    for(const s of predicted){
      // Conservative agreement proxy, NOT formal object precision: candidate
      // samples must follow a labeled reference stroke through most of its length.
      const near=reference.lines.filter(r=>angleMatch(s,r)&&boxIntersect(box(s),box(r),tolerancePx))
        .map(r=>({a:r.a,b:r.b}));
      if(coverage(s,near,tolerancePx)<.70)unsupported++;
    }
  }
  return {scope:reference.scope,expectedLines:reference.lines.length,
    detectedLines:predicted.length,lineCoverage:total?weighted/total:0,
    coveredLines,missingLines:lows,
    unsupportedCandidates:complete?unsupported:null,
    candidateAgreement:complete?(predicted.length?(predicted.length-unsupported)/predicted.length:0):null,
    expectedCircles:reference.circles.length,detectedCircles:foundCircles.length,
    matchedCircles:matched.size,missingCircles,
    extraCircles:complete?foundCircles.length-matched.size:null,
    meanCircleCenterErrorPx:matched.size?centerError/matched.size:null,
    meanCircleRadiusErrorPx:matched.size?radiusError/matched.size:null,
    tolerancePx};
}
