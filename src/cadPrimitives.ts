/** Browser-only exact elementary 2D CAD constructions. Coordinates are
 * sheet units (not necessarily mm). Every new object requires inspection.
 */
import {entity,type Entity,type Point} from './model';

const EPS=1e-7;
const finite=(p:Point)=>Number.isFinite(p.x)&&Number.isFinite(p.y);
const distance=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y);
const cross=(a:Point,b:Point)=>a.x*b.y-a.y*b.x;
const difference=(a:Point,b:Point):Point=>({x:a.x-b.x,y:a.y-b.y});
const normalize=(v:Point):Point|null=>{
  const n=Math.hypot(v.x,v.y);
  return Number.isFinite(n)&&n>EPS?{x:v.x/n,y:v.y/n}:null;
};
const manual=(e:Entity,note:string):Entity=>{
  e.reason=note+'; требуется проверка геометрии по оригиналу';
  e.verified=false;
  return e;
};

/** True auxiliary infinite straight line; not part of printed/DXF modelspace. */
export function constructionLine(a:Point,b:Point):Entity|null{
  if(!finite(a)||!finite(b)||distance(a,b)<EPS)return null;
  return manual(entity('construction',[a,b],'Вспомогательные'),
    'Вспомогательная бесконечная прямая (не экспортируется в DXF)');
}
/** Clip an infinite line to the finite sheet for viewing and hit testing. */
export function visibleConstructionLine(a:Point,b:Point,width:number,height:number):[Point,Point]|null{
  if(!finite(a)||!finite(b)||![width,height].every(Number.isFinite)||
    width<=0||height<=0||distance(a,b)<EPS)return null;
  const d=difference(b,a);
  let lo=-Infinity,hi=Infinity;
  for(const [origin,vector,limit] of [[a.x,d.x,width],[a.y,d.y,height]]){
    if(Math.abs(vector)<EPS){if(origin<0||origin>limit)return null;continue;}
    const t0=(0-origin)/vector,t1=(limit-origin)/vector;
    lo=Math.max(lo,Math.min(t0,t1));
    hi=Math.min(hi,Math.max(t0,t1));
    if(lo>hi)return null;
  }
  if(!Number.isFinite(lo)||!Number.isFinite(hi)||hi-lo<EPS)return null;
  return [
    {x:a.x+lo*d.x,y:a.y+lo*d.y},
    {x:a.x+hi*d.x,y:a.y+hi*d.y},
  ];
}
/** Vertex -> two rays. Reject opposite/degenerate rays instead of guessing. */
export function angleBisector(vertex:Point,first:Point,second:Point):Entity|null{
  if(![vertex,first,second].every(finite))return null;
  const a=normalize(difference(first,vertex)),b=normalize(difference(second,vertex));
  if(!a||!b)return null;
  const bisector=normalize({x:a.x+b.x,y:a.y+b.y});
  return bisector?constructionLine(vertex,{x:vertex.x+bisector.x,y:vertex.y+bisector.y}):null;
}
export function circleByThreePoints(a:Point,b:Point,c:Point):Entity|null{
  if(![a,b,c].every(finite))return null;
  const u=difference(b,a),v=difference(c,a),det=2*cross(u,v);
  const span=Math.max(distance(a,b),distance(a,c),distance(b,c));
  if(span<EPS||Math.abs(det)<1e-9*span*span)return null;
  const uu=u.x*u.x+u.y*u.y,vv=v.x*v.x+v.y*v.y;
  const center={x:a.x+(uu*v.y-vv*u.y)/det,y:a.y+(u.x*vv-v.x*uu)/det};
  const radius=distance(center,a);
  if(!finite(center)||!Number.isFinite(radius)||radius<=EPS||radius>1e7)return null;
  const e=entity('circle',[a,b,c]);
  e.center=center;e.radius=radius;
  return manual(e,'Окружность точно по трём неколлинеарным точкам');
}
/** Arc through start, intermediate and end points; the drawn sweep always
 * passes through the intermediate point (canvas Y-down radians).
 */
export function arcThroughThreePoints(a:Point,middle:Point,b:Point):Entity|null{
  const circle=circleByThreePoints(a,middle,b);
  if(!circle?.center||!circle.radius)return null;
  const center=circle.center;
  const sa=Math.atan2(a.y-center.y,a.x-center.x),
    ma=Math.atan2(middle.y-center.y,middle.x-center.x),
    ba=Math.atan2(b.y-center.y,b.x-center.x);
  const twopi=2*Math.PI,wrap=(value:number)=>((value%twopi)+twopi)%twopi;
  const delta=wrap(ba-sa),through=wrap(ma-sa);
  if(delta<1e-8||through<1e-8||Math.abs(through-delta)<1e-8)return null;
  const e=entity('arc',[a,middle,b]);
  e.center={...center};e.radius=circle.radius;
  if(through<delta){e.startAngle=sa;e.endAngle=sa+delta;}
  else{e.startAngle=ba;e.endAngle=ba+twopi-delta;}
  return manual(e,'Дуга построена по трём неколлинеарным точкам с сохранением промежуточной точки на дуге');
}
export function regularPolygon(
  center:Point,reference:Point,sides:number,mode:'inscribed'|'circumscribed'='inscribed'
):Entity|null{
  if(!finite(center)||!finite(reference)||!Number.isInteger(sides)||
    sides<3||sides>128)return null;
  const apothemOrRadius=distance(center,reference);
  if(apothemOrRadius<EPS)return null;
  const shift=mode==='circumscribed'?Math.PI/sides:0;
  const R=mode==='circumscribed'?apothemOrRadius/Math.cos(Math.PI/sides):apothemOrRadius;
  const theta=Math.atan2(reference.y-center.y,reference.x-center.x)-shift;
  const points=Array.from({length:sides},(_,i)=>({
    x:center.x+R*Math.cos(theta+2*Math.PI*i/sides),
    y:center.y+R*Math.sin(theta+2*Math.PI*i/sides),
  }));
  if(!points.every(finite))return null;
  const e=entity('polyline',points);
  e.closed=true;
  return manual(e,'Правильный '+sides+'-угольник ('+
    (mode==='inscribed'?'вписанный':'описанный')+')');
}
/** Ellipse: center, first semi-major axis endpoint, independent semi-minor
 * displacement measured normal to the major axis; no fake true circle.
 */
export function ellipseFromAxes(center:Point,majorTip:Point,minorHandle:Point):Entity|null{
  if(![center,majorTip,minorHandle].every(finite))return null;
  const d=difference(majorTip,center),major=Math.hypot(d.x,d.y);
  if(major<=EPS||major>1e7)return null;
  const displacement=difference(minorHandle,center);
  const minor=Math.abs(cross(d,displacement))/major;
  if(minor<=EPS||minor>major+EPS)return null;
  const axisRatio=Math.min(1,minor/major);
  const e=entity('ellipse',[center,majorTip]);
  e.center={...center};e.radius=major;e.axisRatio=axisRatio;
  return manual(e,'Эллипс по центру и двум осям (малая ось перпендикулярна большой)');
}
