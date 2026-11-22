/** Explicit W4 affine operations for supported 2D CAD primitives.
 * No parametric dependencies or automatic change to associated dimensions.
 * Coordinates are sheet-local units; operations always clear verification.
 */
import {newId,type Entity,type Point} from './model';
import type {OperationResult} from './cadOperations';
const EPS=1e-7;
const finite=(p:Point)=>Number.isFinite(p.x)&&Number.isFinite(p.y);
const pointKinds=new Set(['point','line','axis','construction','polyline','bezier','hatch',
  'circle','arc','ellipse']);
const safe=(e:Entity)=>pointKinds.has(e.kind)&&e.points.length>0&&e.points.length<=1000&&
  e.points.every(finite)&&
  (!['circle','arc','ellipse'].includes(e.kind)||
    !!e.center&&finite(e.center)&&Number.isFinite(e.radius)&&e.radius!>EPS)&&
  (e.kind!=='ellipse'||!!e.axisRatio&&e.axisRatio>0&&e.axisRatio<=1);
const changed=(e:Entity):Entity=>({...e,origin:'manual',verified:false,
  confidence:undefined,sourceId:undefined,chainId:undefined,bbox:undefined,
  reason:'Геометрия изменена CAD-преобразованием: связанные размеры и оригинал надо проверить'});
const rotPoint=(p:Point,pivot:Point,angle:number):Point=>{
  const co=Math.cos(angle),si=Math.sin(angle);
  const x=p.x-pivot.x,y=p.y-pivot.y;
  return {x:pivot.x+x*co-y*si,y:pivot.y+x*si+y*co};
};
function transformed(e:Entity,point:(v:Point)=>Point,angle=0,scale=1):Entity|null{
  const points=e.points.map(point),center=e.center?point(e.center):undefined;
  if(!points.every(finite)||center&&!finite(center))return null;
  const updated=changed({...e,points,center,
    radius:e.radius===undefined?undefined:e.radius*scale,
    startAngle:e.startAngle===undefined?undefined:e.startAngle+angle,
    endAngle:e.endAngle===undefined?undefined:e.endAngle+angle,
  });
  if((updated.radius!==undefined&&(!Number.isFinite(updated.radius)||updated.radius>1e8))||
    points.some(p=>Math.max(Math.abs(p.x),Math.abs(p.y))>1e9))return null;
  return updated;
}
function replace(e:Entity):OperationResult{return {replacements:[e],additions:[]};}
export function rotateCadEntity(e:Entity,pivot:Point,degrees:number):OperationResult|null{
  if(!safe(e)||!finite(pivot)||!Number.isFinite(degrees)||Math.abs(degrees)>36000||
    Math.abs(degrees)<1e-9)return null;
  const angle=degrees*Math.PI/180,updated=transformed(e,p=>rotPoint(p,pivot,angle),angle);
  return updated?replace(updated):null;
}
export function scaleCadEntity(e:Entity,pivot:Point,factor:number):OperationResult|null{
  if(!safe(e)||!finite(pivot)||!Number.isFinite(factor)||factor<=1e-6||
    factor>1000||Math.abs(factor-1)<1e-9)return null;
  const updated=transformed(e,p=>({x:pivot.x+(p.x-pivot.x)*factor,
    y:pivot.y+(p.y-pivot.y)*factor}),0,factor);
  return updated?replace(updated):null;
}
export function moveCadEntity(e:Entity,dx:number,dy:number):OperationResult|null{
  if(!safe(e)||![dx,dy].every(Number.isFinite)||Math.max(Math.abs(dx),Math.abs(dy))>1e8||
    Math.hypot(dx,dy)<EPS)return null;
  const updated=transformed(e,p=>({x:p.x+dx,y:p.y+dy}));
  return updated?replace(updated):null;
}
/** Shear a straight-edged primitive; do not silently convert a circle/arc
 * into invalid circular geometry (those become conics after shearing).
 */
export function shearCadEntity(e:Entity,pivot:Point,kx:number):OperationResult|null{
  if(!safe(e)||!['point','line','polyline','bezier','construction','hatch','axis'].includes(e.kind)||
    !finite(pivot)||!Number.isFinite(kx)||Math.abs(kx)>5||Math.abs(kx)<EPS)return null;
  const updated=transformed(e,p=>({x:p.x+kx*(p.y-pivot.y),y:p.y}));
  return updated?replace(updated):null;
}
/** Even angular spacing around explicit center, source preserved. */
export function polarArrayCad(
  e:Entity,center:Point,count:number,sweepDegrees=360
):OperationResult|null{
  if(!safe(e)||!finite(center)||!Number.isInteger(count)||count<2||count>64||
    !Number.isFinite(sweepDegrees)||sweepDegrees<=0||sweepDegrees>360)return null;
  const additions:Entity[]=[];
  for(let i=1;i<count;i++){
    const deg=sweepDegrees===360?360*i/count:sweepDegrees*i/(count-1);
    const angle=deg*Math.PI/180;
    const out=transformed(e,p=>rotPoint(p,center,angle),angle);
    if(!out)return null;
    additions.push({...out,id:newId()});
  }
  return {replacements:[],additions};
}
/** A one-shot align operation, NOT a persistent parametric constraint.
 * Preserve exact segment length while making horizontal or vertical.
 */
export function alignCadLine(e:Entity,axis:'horizontal'|'vertical'):OperationResult|null{
  if(e.kind!=='line'||e.points.length!==2||!e.points.every(finite))return null;
  const [a,b]=e.points,dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy);
  if(length<EPS)return null;
  const q=axis==='horizontal'?{x:a.x+(dx>=0?length:-length),y:a.y}:
    {x:a.x,y:a.y+(dy>=0?length:-length)};
  return replace(changed({...e,points:[{...a},q],
    reason:'Ручное выравнивание; это не постоянная параметрическая связь'}));
}
