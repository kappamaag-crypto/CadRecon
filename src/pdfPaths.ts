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

type Matrix=[number,number,number,number,number,number];
type Viewport={convertToViewportPoint:(x:number,y:number)=>number[]};
type Ops={constructPath:number;save:number;restore:number;transform:number;
  moveTo:number;lineTo:number;curveTo:number;curveTo2:number;curveTo3:number;
  rectangle:number;closePath:number;endPath?:number;clip?:number;eoClip?:number;setGState?:number;
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

export function extractPdfPaths(list:OpList,vp:Viewport,ops:Ops,limit=30000):PdfVectorReport {
  const entities:Entity[]=[],warnings:string[]=[];
  let ctm:Matrix=[...IDENTITY],pathOperations=0,rejectedPaths=0,truncated=false;
  let nonPaintedPaths=0,clippedGeometry=0,rectangularClipLines=0,clipActive=false,unknownAlpha=false,formScope=false;
  let clipRect:ClipRect|null=null;
  const stack:Array<{ctm:Matrix;clipActive:boolean;clipRect:ClipRect|null}>=[];
  // Stable PDF.js OPS values (src/shared/util.js): 20..27 paint visible paths;
  // 28 endPath, 29 clip, 30 eoClip do NOT paint any geometry.
  const paintable=new Set([20,21,22,23,24,25,26,27,ops.rawFillPath??94]);
  const push=(e:Entity,opIndex:number)=>{
    if(entities.length>=limit){truncated=true;return;}
    // Only exact LINE vs axis-aligned rectangular clipping is implemented.
    // Unknown clip shapes and curved paths remain explicit unresolved evidence.
    if(clipActive&&clipRect&&e.kind==='line'&&e.points.length===2){
      rectangularClipLines++;
      const visible=clipStraightLine(e.points[0],e.points[1],clipRect);
      if(!visible)return;
      e.points=visible;
      e.reason='Нативный PDF LINE: прямоугольное отсечение рассчитано; требуется проверка';
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
    if(fn===ops.save){stack.push({ctm:[...ctm],clipActive,clipRect:clipRect?{...clipRect}:null});continue;}
    if(fn===ops.restore){const prior=stack.pop();ctm=prior?.ctm??[...IDENTITY];clipActive=prior?.clipActive??false;clipRect=prior?.clipRect??null;continue;}
    if((ops.clip!==undefined&&fn===ops.clip)||(ops.eoClip!==undefined&&fn===ops.eoClip)){clipActive=true;clipRect=null;continue;}
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
    // Do not create invisible CAD objects from clipping-only paths, or
    // unrecognized paint operations. PDF clipping is NOT geometrically
    // modeled, so any subsequent visible paths in the clipped scope are
    // explicitly marked as potentially over-exported.
    if(typeof raw[0]==='number'){
      const paintOp=raw[0] as number;
      if(paintOp===28||paintOp===29||paintOp===30){
        nonPaintedPaths++;
        if(paintOp===29||paintOp===30){
          const rectangle=paintOp===29?rectangularClip(raw):null;
          clipRect=rectangle?(clipRect?intersectRect(clipRect,rectangle):rectangle):null;
          clipActive=true;
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
      if(circular){
        const e=entity('circle',[circular.center],'PDF векторы','pdf');
        e.center=circular.center;e.radius=circular.radius;push(e,i);
      }else if(segments.length>=3&&segments.every(s=>s.kind==='line')
        &&near(segments[0].points[0],segments[segments.length-1].points[1])){
        const pts=segments.map(s=>s.points[0]);
        const e=entity('polyline',pts,'PDF векторы','pdf');e.closed=true;push(e,i);
      }else{
        for(const s of segments){
          const e=entity(s.kind,s.points,'PDF векторы','pdf');push(e,i);
        }
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
  if(rectangularClipLines)warnings.push('Прямоугольный PDF clipping применён к '+rectangularClipLines+' LINE; сложные кривые и маски всё ещё требуют проверки.');
  if(unknownAlpha)warnings.push('PDF использует графические состояния: прозрачность/альфа пока не учитываются при извлечении векторов.');
  if(formScope)warnings.push('PDF использует Form XObject: требуется проверить вложенные координаты и clipping по оригиналу.');
  if(rejectedPaths)warnings.push('Часть команд PDF не распознана: '+rejectedPaths+'. Результат неполный.');
  if(truncated)warnings.push('Превышен лимит CAD-объектов PDF: фрагменты не импортированы. Разделите документ.');
  return {entities,pathOperations,rejectedPaths,nonPaintedPaths,clippedGeometry,rectangularClipLines,truncated,warnings};
}
