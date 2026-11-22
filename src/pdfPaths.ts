/**
 * PDF.js operator-list -> editable CAD geometry.
 *
 * PDF.js 5.x constructPath arguments use [paintOp, packed DrawOPS chunks, bbox].
 * The old [OPS[], coordinates[]] representation is also supported to avoid
 * silently dropping vector drawings on mixed deployments.
 *
 * Original PDF paths are hypotheses: no imported entity is engineer-verified.
 */
import {entity,type Entity,type Point} from './model';
import {clipPdfCubicToRect,type PdfCubic} from './pdfBezierClip';

type Matrix=[number,number,number,number,number,number];
type Viewport={convertToViewportPoint:(x:number,y:number)=>number[]};
type Ops={constructPath:number;save:number;restore:number;transform:number;
  moveTo:number;lineTo:number;curveTo:number;curveTo2:number;curveTo3:number;
  rectangle:number;closePath:number;endPath?:number;clip?:number;eoClip?:number;setDash?:number;setGState?:number;
  paintFormXObjectBegin?:number;paintFormXObjectEnd?:number;rawFillPath?:number};
type OpList={fnArray:ArrayLike<number>;argsArray:ArrayLike<unknown>};
type Segment={kind:'line'|'bezier';points:Point[]};
export interface PdfVectorReport {
  entities:Entity[];
  pathOperations:number;
  rejectedPaths:number;
  nonPaintedPaths:number;
  clippedGeometry:number;
  rectangularClipLines:number;
  rectangularClipCurves:number;
  fullyClippedObjects:number;
  truncated:boolean;
  warnings:string[];
}

const dist=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y);
const near=(a:Point,b:Point)=>dist(a,b)<1e-5;
const IDENTITY:Matrix=[1,0,0,1,0,0];
const MAX_ITEMS=100000;

function compose(a:Matrix,b:Matrix):Matrix {
  return [a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],
    a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],
    a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
}
function numeric(v:unknown):v is ArrayLike<number> {
  return Array.isArray(v)||(ArrayBuffer.isView(v)&&'length' in v);
}
function allFinite(v:ArrayLike<number>):boolean {
  for(let i=0;i<v.length;i++)if(!Number.isFinite(v[i]))return false;
  return true;
}
function bezierPoint(p:Point[],t:number):Point {
  const u=1-t;
  return {x:u*u*u*p[0].x+3*u*u*t*p[1].x+3*u*t*t*p[2].x+t*t*t*p[3].x,
    y:u*u*u*p[0].y+3*u*u*t*p[1].y+3*u*t*t*p[2].y+t*t*t*p[3].y};
}
/** Strict geometric fit: recognize 4 quarter-Bezier segments only if they
 * form a closed, approximately circular path at the target viewport scale.
 * A generic closed spline must NEVER be silently called a circle.
 */
function circleFromQuarterCurves(parts:Segment[]):{center:Point;radius:number}|null {
  if(parts.length!==4||parts.some(s=>s.kind!=='bezier'))return null;
  const paths=parts.map(s=>s.points);
  for(let i=0;i<4;i++)if(!near(paths[i][3],paths[(i+1)%4][0]))return null;
  const vertices=paths.map(p=>p[0]);
  const center={x:vertices.reduce((a,p)=>a+p.x,0)/4,
    y:vertices.reduce((a,p)=>a+p.y,0)/4};
  const radii=vertices.map(p=>dist(p,center));
  const radius=radii.reduce((a,b)=>a+b,0)/4;
  if(!Number.isFinite(radius)||radius<1e-5)return null;
  // Reject ellipses, skewed circles, noncircular B-spline loops and asymmetry.
  const tolerance=Math.max(.0002,radius*.0015);
  for(const p of paths){
    for(const t of [0,.125,.25,.375,.5,.625,.75,.875,1]){
      if(Math.abs(dist(bezierPoint(p,t),center)-radius)>tolerance)return null;
    }
  }
  return {center,radius};
}

/** Distinguish a true four-cubic PDF ellipse from a generic 4-curve loop.
 * PDF approximates elliptical quarters with four cubic curves. Accept only
 * opposite, perpendicular axes and low normalized radial residual. Under
 * skew/shear or arbitrary paths retain original editable Bezier segments.
 */
function ellipseFromQuarterCurves(parts:Segment[]):{center:Point;radius:number;axisRatio:number;majorTip:Point}|null{
  if(parts.length!==4||parts.some(s=>s.kind!=='bezier'))return null;
  const paths=parts.map(s=>s.points);
  for(let i=0;i<4;i++)if(!near(paths[i][3],paths[(i+1)%4][0]))return null;
  const verts=paths.map(s=>s[0]);
  const center={x:verts.reduce((sum,p)=>sum+p.x,0)/4,
    y:verts.reduce((sum,p)=>sum+p.y,0)/4};
  const u={x:verts[0].x-center.x,y:verts[0].y-center.y},
    v={x:verts[1].x-center.x,y:verts[1].y-center.y};
  const lu=Math.hypot(u.x,u.y),lv=Math.hypot(v.x,v.y);
  const major=Math.max(lu,lv),minor=Math.min(lu,lv);
  if(!Number.isFinite(major)||major<=1e-6||minor/major<.02||minor/major>.985)return null;
  const oppositeTol=Math.max(1e-4,major*.003);
  if(dist({x:verts[0].x+verts[2].x,y:verts[0].y+verts[2].y},
    {x:2*center.x,y:2*center.y})>oppositeTol||
    dist({x:verts[1].x+verts[3].x,y:verts[1].y+verts[3].y},
      {x:2*center.x,y:2*center.y})>oppositeTol)return null;
  if(Math.abs(u.x*v.x+u.y*v.y)/(lu*lv)>.012)return null;
  const axis=lu>=lv?u:v,other=lu>=lv?v:u;
  const ux=axis.x/major,uy=axis.y/major,
    vx=other.x/minor,vy=other.y/minor;
  const ratio=minor/major;
  // Normalized conic ellipse equation x^2/a^2+y^2/b^2=1;
  // this rejects rounded rectangles and arbitrary cubic loops.
  for(const segment of paths)for(const t of [0,.125,.25,.375,.5,.625,.75,.875,1]){
    const p=bezierPoint(segment,t),dx=p.x-center.x,dy=p.y-center.y;
    const s=(dx*ux+dy*uy)/major,r=(dx*vx+dy*vy)/minor;
    if(!Number.isFinite(s)||!Number.isFinite(r)||Math.abs(s*s+r*r-1)>.004)return null;
  }
  return {center,radius:major,axisRatio:ratio,majorTip:{x:center.x+axis.x,y:center.y+axis.y}};
}

type ClipRect={x0:number;y0:number;x1:number;y1:number};
function clipStraightLine(a:Point,b:Point,clip:ClipRect):Point[]|null{
  const dx=b.x-a.x,dy=b.y-a.y;
  let lo=0,hi=1;
  for(const [p,q] of [[-dx,a.x-clip.x0],[dx,clip.x1-a.x],
    [-dy,a.y-clip.y0],[dy,clip.y1-a.y]]){
    if(Math.abs(p)<1e-12){if(q<0)return null;continue;}
    const t=q/p;
    if(p<0)lo=Math.max(lo,t);else hi=Math.min(hi,t);
    if(lo>hi)return null;
  }
  if(hi-lo<1e-9)return null;
  return [{x:a.x+lo*dx,y:a.y+lo*dy},{x:a.x+hi*dx,y:a.y+hi*dy}];
}
function intersectRect(a:ClipRect,b:ClipRect):ClipRect{
  return {x0:Math.max(a.x0,b.x0),y0:Math.max(a.y0,b.y0),
    x1:Math.min(a.x1,b.x1),y1:Math.min(a.y1,b.y1)};
}

/** Conservative curve bounds. A cubic lies inside its control point hull.
 * A circle/arc/ellipse is contained by the radius square; this deliberately
 * overestimates, so a legitimate visible curve cannot be deleted as outside.
 */
function geometricBounds(e:Entity):ClipRect|null{
  const points=[...e.points];
  if((e.kind==='circle'||e.kind==='arc'||e.kind==='ellipse')&&e.center&&e.radius){
    points.push({x:e.center.x-e.radius,y:e.center.y-e.radius},
      {x:e.center.x+e.radius,y:e.center.y+e.radius});
  }
  if(!points.length||points.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)))return null;
  return {x0:Math.min(...points.map(p=>p.x)),y0:Math.min(...points.map(p=>p.y)),
    x1:Math.max(...points.map(p=>p.x)),y1:Math.max(...points.map(p=>p.y))};
}
function outsideRect(a:ClipRect,b:ClipRect):boolean{
  return a.x1<b.x0||b.x1<a.x0||a.y1<b.y0||b.y1<a.y0;
}
function insideRect(a:ClipRect,b:ClipRect):boolean{
  return a.x0>=b.x0&&a.y0>=b.y0&&a.x1<=b.x1&&a.y1<=b.y1;
}

export function extractPdfPaths(list:OpList,vp:Viewport,ops:Ops,limit=30000):PdfVectorReport {
  const entities:Entity[]=[],warnings:string[]=[];
  let ctm:Matrix=[...IDENTITY],pathOperations=0,rejectedPaths=0,truncated=false;
  let nonPaintedPaths=0,clippedGeometry=0,rectangularClipLines=0,rectangularClipCurves=0,fullyClippedObjects=0,clipActive=false,unknownAlpha=false,formScope=false;
  let clipRect:ClipRect|null=null;
  let pdfLineStyle:Entity['lineStyle']=undefined,currentPathStroked=true;
  // PDF.js can emit constructPath(END_PATH) followed by OPS.clip, or emit
  // OPS.clip before the path-ending constructPath. Keep the current pending
  // rectangular path until the clip command consumes it; never equate a
  // non-painted rectangle with a visible CAD polyline.
  let pendingClipRect:ClipRect|null=null,awaitingClipPath=false;
  const stack:Array<{ctm:Matrix;clipActive:boolean;clipRect:ClipRect|null;lineStyle:Entity['lineStyle']}>=[];
  // Stable PDF.js OPS values (src/shared/util.js): 20..27 paint visible paths;
  // 28 endPath, 29 clip, 30 eoClip do NOT paint any geometry.
  const paintable=new Set([20,21,22,23,24,25,26,27,ops.rawFillPath??94]);
  const strokedPaint=new Set([20,21,24,25,26,27]);
  const nativeLineStyle=(arg:unknown):Entity['lineStyle']=>{
    if(!Array.isArray(arg)||arg.length<1)return undefined;
    const dash=arg[0];
    if(!numeric(dash)||dash.length>12||!allFinite(dash))return undefined;
    const values=Array.from(dash);
    if(values.length===2&&values[0]>0&&values[1]>0)return 'dashed';
    // Common ISO/engineering long-gap-dot-gap centerline. Anything else
    // (custom dots, complex patterns, zero gaps) stays unclassified.
    if(values.length===4&&values.every(x=>x>0)&&values[0]>=2.2*values[2]&&
      values[2]<=Math.min(values[1],values[3])*1.2)
      return 'center';
    return undefined;
  };
  const push=(e:Entity,opIndex:number)=>{
    if(entities.length>=limit){truncated=true;return;}
    if(e.kind==='line'&&currentPathStroked&&pdfLineStyle)e.lineStyle=pdfLineStyle;
    // Rectangular cubic Bézier clipping preserves exact editable control
    // geometry via de Casteljau; do not approximate or connect hidden pieces.
    if(clipActive&&clipRect&&e.kind==='bezier'&&e.points.length===4){
      const segments=clipPdfCubicToRect(e.points as PdfCubic,clipRect);
      if(!segments.length){fullyClippedObjects++;return;}
      const changed=segments.length!==1||segments[0].some((p,j)=>dist(p,e.points[j])>1e-7);
      if(changed)rectangularClipCurves++;
      for(const part of segments){
        if(entities.length>=limit){truncated=true;break;}
        const item=changed?entity('bezier',part,'PDF векторы','pdf'):e;
        item.verified=false;item.sourceId='pdf-path-op-'+opIndex;
        item.reason=changed?
          'Нативный PDF Bézier: прямоугольное отсечение рассчитано без выпрямления кривой; проверьте координаты':
          'Нативный PDF Bézier полностью внутри прямоугольного clipping; требует проверки';
        entities.push(item);
      }
      return;
    }
    // Exact LINE clipping; unsupported arbitrary clip shapes remain explicit.

    if(clipActive&&clipRect&&e.kind==='line'&&e.points.length===2){
      rectangularClipLines++;
      const visible=clipStraightLine(e.points[0],e.points[1],clipRect);
      if(!visible)return;
      e.points=visible;
      e.reason='Нативный PDF LINE: прямоугольное отсечение рассчитано; требуется проверка';
    }else if(clipActive&&clipRect){
      const area=geometricBounds(e);
      if(area&&outsideRect(area,clipRect)){fullyClippedObjects++;return;}
      if(area&&insideRect(area,clipRect)){
        e.reason='Нативный PDF path полностью внутри прямоугольного clipping; форма сохранена';
      }else{
        clippedGeometry++;
        e.reason='Нативный PDF path пересекает прямоугольный clipping; частичное отсечение кривой НЕ реализовано, требуется проверка';
      }
    }else{
      if(clipActive)clippedGeometry++;
      e.reason='Нативный PDF path; проверьте тип объекта, масштаб и контекст'+
        (clipActive?'; ОБЛАСТЬ ОТСЕЧЕНИЯ PDF не рассчитана, часть линии может быть скрыта':'');
    }
    e.verified=false;e.sourceId='pdf-path-op-'+opIndex;
    entities.push(e);
  };
  const transform=(x:number,y:number):Point=>{
    const pt=vp.convertToViewportPoint(ctm[0]*x+ctm[2]*y+ctm[4],
      ctm[1]*x+ctm[3]*y+ctm[5]);
    return {x:pt[0],y:pt[1]};
  };
  /** PDF W n / eoClip: accept ONLY four-corner axis-aligned closed
   * rectangles, in viewport coordinates, with no curve or multiple subpaths.
   * Anything else remains an unknown clip; never fabricate shape semantics.
   */
  const rectangularClip=(raw:unknown):ClipRect|null=>{
    if(!Array.isArray(raw)||raw.length<2)return null;
    // Some PDF.js versions retain the legacy rectangle command 19 with
    // separate [x,y,width,height] operands; others use packed DrawOPS 0/1/4.
    if(numeric(raw[0])&&numeric(raw[1])){
      const commands=raw[0],coords=raw[1];
      if(commands.length===1&&commands[0]===ops.rectangle&&
        coords.length===4&&allFinite(coords)){
        const [x,y,w,h]=Array.from(coords);
        const pts=[transform(x,y),transform(x+w,y),
          transform(x+w,y+h),transform(x,y+h)];
        if(pts.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)))return null;
        const xs=pts.map(p=>p.x),ys=pts.map(p=>p.y);
        const x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys);
        if(x1<=x0||y1<=y0)return null;
        const allowed=pts.every(p=>(Math.abs(p.x-x0)<1e-5||Math.abs(p.x-x1)<1e-5)&&
          (Math.abs(p.y-y0)<1e-5||Math.abs(p.y-y1)<1e-5));
        if(!allowed||new Set(pts.map(p=>Math.round(p.x*1e4)+':'+Math.round(p.y*1e4))).size!==4)return null;
        return {x0,y0,x1,y1};
      }
      return null;
    }
    const src=raw[1],chunks=Array.isArray(src)?src:[src];
    const corners:Point[]=[];let closed=false;
    for(const chunk of chunks){
      if(!numeric(chunk)||!allFinite(chunk))return null;
      for(let i=0;i<chunk.length;){
        const op=chunk[i++];
        if(op===4){closed=true;continue;}
        if(op!==0&&op!==1||i+1>=chunk.length)return null;
        corners.push(transform(chunk[i++],chunk[i++]));
      }
    }
    if(corners.length===5&&near(corners[0],corners[4]))corners.pop();
    if(!closed||corners.length!==4||!corners.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)))return null;
    const x0=Math.min(...corners.map(p=>p.x)),x1=Math.max(...corners.map(p=>p.x));
    const y0=Math.min(...corners.map(p=>p.y)),y1=Math.max(...corners.map(p=>p.y));
    if(x1-x0<1e-6||y1-y0<1e-6)return null;
    const set=new Set(corners.map(p=>
      Math.abs(p.x-x0)<1e-5?'L':Math.abs(p.x-x1)<1e-5?'R':'?')
      .map((x,i)=>x+(Math.abs(corners[i].y-y0)<1e-5?'T':
        Math.abs(corners[i].y-y1)<1e-5?'B':'?')));
    if(set.size!==4||[...set].some(x=>x.includes('?')))return null;
    return {x0,y0,x1,y1};
  };
  for(let i=0;i<list.fnArray.length;i++){
    const fn=list.fnArray[i];
    if(fn===ops.save){stack.push({ctm:[...ctm],clipActive,clipRect:clipRect?{...clipRect}:null,lineStyle:pdfLineStyle});pendingClipRect=null;awaitingClipPath=false;continue;}
    if(fn===ops.restore){const prior=stack.pop();ctm=prior?.ctm??[...IDENTITY];clipActive=prior?.clipActive??false;clipRect=prior?.clipRect??null;pdfLineStyle=prior?.lineStyle;pendingClipRect=null;awaitingClipPath=false;continue;}
    if((ops.clip!==undefined&&fn===ops.clip)||(ops.eoClip!==undefined&&fn===ops.eoClip)){
      clipActive=true;
      // W (nonzero) permits axis-aligned rectangles; W* (even-odd) only if
      // there is one proven rectangle with no subpaths, same as normal W.
      if(pendingClipRect){
        clipRect=clipRect?intersectRect(clipRect,pendingClipRect):pendingClipRect;
        pendingClipRect=null;awaitingClipPath=false;
      }else{
        awaitingClipPath=true;clipRect=null;
      }
      continue;
    }
    if(ops.setDash!==undefined&&fn===ops.setDash){pdfLineStyle=nativeLineStyle(list.argsArray[i]);continue;}
    if(ops.setGState!==undefined&&fn===ops.setGState){unknownAlpha=true;continue;}
    if(ops.paintFormXObjectBegin!==undefined&&fn===ops.paintFormXObjectBegin){formScope=true;continue;}
    if(fn===ops.transform){
      const m=list.argsArray[i];
      if(numeric(m)&&m.length===6&&allFinite(m))ctm=compose(ctm,Array.from(m) as Matrix);
      continue;
    }
    if(fn!==ops.constructPath)continue;
    pathOperations++;
    const raw=list.argsArray[i];
    if(!Array.isArray(raw)||raw.length<2){rejectedPaths++;continue;}
    currentPathStroked=typeof raw[0]!=='number'||strokedPaint.has(raw[0]);
    // Do not create invisible CAD objects from clipping-only paths, or
    // unrecognized paint operations. PDF clipping is NOT geometrically
    // modeled, so any subsequent visible paths in the clipped scope are
    // explicitly marked as potentially over-exported.
    if(typeof raw[0]==='number'){
      const paintOp=raw[0] as number;
      if(paintOp===28||paintOp===29||paintOp===30){
        nonPaintedPaths++;
        const rectangle=rectangularClip(raw);
        if(paintOp===28){
          if(awaitingClipPath){
            clipRect=rectangle?(clipRect?intersectRect(clipRect,rectangle):rectangle):null;
            clipActive=true;awaitingClipPath=false;pendingClipRect=null;
          }else pendingClipRect=rectangle;
        }else{
          clipRect=rectangle?(clipRect?intersectRect(clipRect,rectangle):rectangle):null;
          clipActive=true;pendingClipRect=null;awaitingClipPath=false;
        }
        continue;
      }
      if(!paintable.has(paintOp)){
        rejectedPaths++;
        continue;
      }
    }
    // PDF.js >=5: [paintOperation, Array<Float32Array>, boundingBox]
    // DrawOPS: 0=moveTo, 1=lineTo, 2=cubic, 3=quadratic, 4=close.
    // Legacy: [Array<OPS>, Array<number>, boundingBox].
    const packed=typeof raw[0]==='number';
    const chunks: Array<{data:ArrayLike<number>;packed:boolean}>=[];
    if(packed){
      const source=raw[1];
      const arr=Array.isArray(source)?source:[source];
      for(const part of arr)if(numeric(part)&&allFinite(part))chunks.push({data:part,packed:true});
    }else if(numeric(raw[0])&&numeric(raw[1])&&allFinite(raw[0])&&allFinite(raw[1])){
      chunks.push({data:raw[0],packed:false});
    }
    if(!chunks.length){rejectedPaths++;continue;}
    let current:Point|null=null,start:Point|null=null,segments:Segment[]=[];
    const flush=()=>{
      if(!segments.length)return;
      // A PDF rectangle arrives as 4 consecutive lines and a close; retain one
      // closed editable polyline rather than four unrelated segments.
      const circular=circleFromQuarterCurves(segments);
      const ellipse=circular?null:ellipseFromQuarterCurves(segments);
      // A clipped full circle/ellipse must not be exported as a full entity.
      // If fully inside or PROVEN fully outside, retain/cull as one primitive.
      // Otherwise clip each original Bézier quarter to individual SPLINE
      // pieces. The same applies to clipped closed polylines: never insert
      // invented boundary strokes along the clipping rectangle.
      const canGroup=(e:Entity)=>{
        if(!clipActive||!clipRect)return true;
        const b=geometricBounds(e);
        return !!b&&(insideRect(b,clipRect)||outsideRect(b,clipRect));
      };
      let grouped=false;
      if(circular){
        const e=entity('circle',[circular.center],'PDF векторы','pdf');
        e.center=circular.center;e.radius=circular.radius;
        if(canGroup(e)){push(e,i);grouped=true;}
      }else if(ellipse){
        const e=entity('ellipse',[ellipse.center,ellipse.majorTip],'PDF векторы','pdf');
        e.center=ellipse.center;e.radius=ellipse.radius;e.axisRatio=ellipse.axisRatio;
        if(canGroup(e)){push(e,i);grouped=true;}
      }
      if(!grouped&&segments.length>=3&&!(currentPathStroked&&pdfLineStyle)&&segments.every(s=>s.kind==='line')
        &&near(segments[0].points[0],segments[segments.length-1].points[1])){
        const pts=segments.map(s=>s.points[0]);
        const e=entity('polyline',pts,'PDF векторы','pdf');e.closed=true;
        if(canGroup(e)){push(e,i);grouped=true;}
      }
      if(!grouped)for(const s of segments){
        const e=entity(s.kind,s.points,'PDF векторы','pdf');push(e,i);
      }
      segments=[];
    };
    const move=(x:number,y:number)=>{flush();current=transform(x,y);start=current;};
    const line=(x:number,y:number)=>{
      const next=transform(x,y);
      if(current&&!near(current,next))segments.push({kind:'line',points:[current,next]});
      current=next;
    };
    const cubic=(a:Point,b:Point,end:Point)=>{
      if(current&&!near(current,end))segments.push({kind:'bezier',points:[current,a,b,end]});
      current=end;
    };
    const close=()=>{
      if(current&&start&&!near(current,start))segments.push({kind:'line',points:[current,start]});
      current=start;flush();start=null;current=null;
    };
    if(packed){
      for(const part of chunks){
        const data=part.data;
        let p=0;
        while(p<data.length){
          const op=data[p++];
          let needed=0;
          if(op===0||op===1)needed=2;
          else if(op===2)needed=6;
          else if(op===3)needed=4;
          else if(op===4)needed=0;
          else {rejectedPaths++;break;}
          if(p+needed>data.length){rejectedPaths++;break;}
          const vals:Array<number>=[];
          for(let n=0;n<needed;n++)vals.push(data[p++]);
          if(op===0)move(vals[0],vals[1]);
          else if(op===1)line(vals[0],vals[1]);
          else if(op===2)cubic(transform(vals[0],vals[1]),transform(vals[2],vals[3]),transform(vals[4],vals[5]));
          else if(op===3){
            const q=transform(vals[0],vals[1]),end=transform(vals[2],vals[3]);
            const anchor=current as Point|null;
            if(anchor){
              const c1={x:anchor.x+2*(q.x-anchor.x)/3,y:anchor.y+2*(q.y-anchor.y)/3};
              const c2={x:end.x+2*(q.x-end.x)/3,y:end.y+2*(q.y-end.y)/3};
              cubic(c1,c2,end);
            }
          }else close();
        }
      }
    }else{
      const commands=raw[0] as ArrayLike<number>,coords=raw[1] as ArrayLike<number>;
      let p=0;
      for(let j=0;j<commands.length;j++){
        const op=commands[j];
        if(op===ops.moveTo&&p+2<=coords.length)move(coords[p++],coords[p++]);
        else if(op===ops.lineTo&&p+2<=coords.length)line(coords[p++],coords[p++]);
        else if(op===ops.curveTo&&p+6<=coords.length){
          cubic(transform(coords[p++],coords[p++]),transform(coords[p++],coords[p++]),transform(coords[p++],coords[p++]));
        }else if(op===ops.curveTo2&&p+4<=coords.length){
          const c1=current, c2=transform(coords[p++],coords[p++]),end=transform(coords[p++],coords[p++]);
          if(c1)cubic(c1,c2,end);
        }else if(op===ops.curveTo3&&p+4<=coords.length){
          const c1=transform(coords[p++],coords[p++]),end=transform(coords[p++],coords[p++]);
          cubic(c1,end,end);
        }else if(op===ops.rectangle&&p+4<=coords.length){
          const [x,y,w,h]=[coords[p++],coords[p++],coords[p++],coords[p++]];
          move(x,y);line(x+w,y);line(x+w,y+h);line(x,y+h);close();
        }else if(op===ops.closePath){close();}
        else rejectedPaths++;
      }
    }
    flush();
    if(entities.length>=limit){truncated=true;break;}
    if(entities.length>MAX_ITEMS){truncated=true;break;}
  }
  if(pathOperations&&entities.length===0)warnings.push('PDF содержит команды пути, но редактируемая геометрия не извлечена.');
  if(nonPaintedPaths)warnings.push('Пропущено '+nonPaintedPaths+' невидимых или ограничивающих PDF path: это не CAD-линии.');
  if(clippedGeometry)warnings.push('PDF содержит clipping: у '+clippedGeometry+' CAD-объектов отсечение НЕ рассчитано; видимость и контуры могут отличаться от оригинала.');
  if(rectangularClipLines)warnings.push('Прямоугольный PDF clipping применён к '+rectangularClipLines+' LINE.');
  if(rectangularClipCurves)warnings.push('Прямоугольный PDF clipping точно разделил '+rectangularClipCurves+' кубических кривых на видимые сегменты SPLINE; оригинальный контур требует проверки.');
  if(fullyClippedObjects)warnings.push('Прямоугольный PDF clipping исключил '+fullyClippedObjects+' заведомо невидимых кривых или контуров.');
  if(unknownAlpha)warnings.push('PDF использует графические состояния: прозрачность/альфа пока не учитываются при извлечении векторов.');
  if(formScope)warnings.push('PDF использует Form XObject: требуется проверить вложенные координаты и clipping по оригиналу.');
  if(rejectedPaths)warnings.push('Часть команд PDF не распознана: '+rejectedPaths+'. Результат неполный.');
  if(truncated)warnings.push('Превышен лимит CAD-объектов PDF: фрагменты не импортированы. Разделите документ.');
  return {entities,pathOperations,rejectedPaths,nonPaintedPaths,clippedGeometry,rectangularClipLines,rectangularClipCurves,fullyClippedObjects,truncated,warnings};
}
