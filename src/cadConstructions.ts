/** Exact analytic 2D constructions for browser-only CadRecon.
 * All results are independent editable objects, never persistent constraints.
 */
import {entity,type Entity,type Point} from './model';
const EPS=1e-9,MAX=1e8;
const finite=(p:Point)=>Number.isFinite(p.x)&&Number.isFinite(p.y)&&Math.max(Math.abs(p.x),Math.abs(p.y))<=MAX;
const goodLength=(l:number)=>Number.isFinite(l)&&l>EPS&&l<=1e7;
const makeLine=(a:Point,b:Point,note:string):Entity|null=>{
  if(!finite(a)||!finite(b)||Math.hypot(a.x-b.x,a.y-b.y)<EPS)return null;
  const e=entity('line',[{...a},{...b}]);
  e.reason=note+'; создано геометрически, необходимо проверить оригинал';
  e.verified=false;return e;
};
export function lineFromCoordinates(x1:number,y1:number,x2:number,y2:number):Entity|null{
  return makeLine({x:x1,y:y1},{x:x2,y:y2},'Отрезок по точным координатам листа');
}
export function orientedLineAtPoint(
  reference:Entity,start:Point,kind:'parallel'|'perpendicular',length?:number,reverse=false
):Entity|null{
  if(reference.kind!=='line'||reference.points.length!==2||!finite(start)||!reference.points.every(finite))return null;
  const [a,b]=reference.points,dx=b.x-a.x,dy=b.y-a.y,
    n=Math.hypot(dx,dy),targetLength=length??n;
  if(!goodLength(n)||!goodLength(targetLength))return null;
  const ux=dx/n,uy=dy/n,sign=reverse?-1:1;
  const direction=kind==='parallel'?{x:ux*sign,y:uy*sign}:
    {x:-uy*sign,y:ux*sign};
  return makeLine(start,{x:start.x+targetLength*direction.x,
    y:start.y+targetLength*direction.y},
    'Отрезок '+(kind==='parallel'?'параллельно':'перпендикулярно')+
    ' выбранному LINE (не ассоциативен)');
}
/** Exact external-point tangents to an analytic circle; choice of side is
 * explicit. No guesses when the point lies on or inside the circle.
 */
export function tangentFromPoint(
  circle:Entity,external:Point,side:'left'|'right'='left'
):Entity|null{
  if(circle.kind!=='circle'||!circle.center||!circle.radius||
    !finite(circle.center)||!finite(external)||!goodLength(circle.radius))return null;
  const r=circle.radius,ux=external.x-circle.center.x,
    uy=external.y-circle.center.y,d2=ux*ux+uy*uy;
  if(!Number.isFinite(d2)||d2<=r*r+EPS)return null;
  const ratio=r*r/d2,h=r*Math.sqrt(d2-r*r)/d2,s=side==='left'?1:-1;
  const tangent={x:circle.center.x+ux*ratio-uy*h*s,
    y:circle.center.y+uy*ratio+ux*h*s};
  const e=makeLine(external,tangent,'Касательный отрезок от внешней точки к окружности');
  if(e)e.sourceId=circle.id;
  return e;
}
/** Points on true CAD curves: t in [0,1], never snap to a control polygon. */
export function pointOnCurve(curve:Entity,t:number):Entity|null{
  if(!Number.isFinite(t)||t<0||t>1||curve.points.length>1000)return null;
  let p:Point|undefined;
  if((curve.kind==='line'||curve.kind==='polyline')&&curve.points.length>=2){
    // For POLYLINE, parameter follows cumulative arc length, not vertex index.
    const vertices=curve.closed?[...curve.points,curve.points[0]]:curve.points;
    const lengths=vertices.slice(1).map((q,i)=>Math.hypot(q.x-vertices[i].x,q.y-vertices[i].y));
    const total=lengths.reduce((sum,v)=>sum+v,0);
    if(!goodLength(total))return null;
    const target=t*total;let accumulated=0;
    for(let i=0;i<lengths.length;i++){
      const length=lengths[i];
      if(target<=accumulated+length||i===lengths.length-1){
        const portion=length>EPS?(target-accumulated)/length:0;
        p={x:vertices[i].x+(vertices[i+1].x-vertices[i].x)*portion,
          y:vertices[i].y+(vertices[i+1].y-vertices[i].y)*portion};break;
      }
      accumulated+=length;
    }
  }else if(curve.kind==='circle'&&curve.center&&curve.radius){
    const angle=2*Math.PI*t;
    p={x:curve.center.x+curve.radius*Math.cos(angle),
      y:curve.center.y+curve.radius*Math.sin(angle)};
  }else if(curve.kind==='arc'&&curve.center&&curve.radius&&
    curve.startAngle!==undefined&&curve.endAngle!==undefined){
    const angle=curve.startAngle+t*(curve.endAngle-curve.startAngle);
    p={x:curve.center.x+curve.radius*Math.cos(angle),
      y:curve.center.y+curve.radius*Math.sin(angle)};
  }else if(curve.kind==='ellipse'&&curve.center&&curve.radius&&curve.axisRatio&&curve.points.length>=2){
    const major=curve.points[1],angle=Math.atan2(major.y-curve.center.y,major.x-curve.center.x),
      phase=2*Math.PI*t,a=curve.radius*Math.cos(phase),b=curve.radius*curve.axisRatio*Math.sin(phase);
    p={x:curve.center.x+a*Math.cos(angle)-b*Math.sin(angle),
      y:curve.center.y+a*Math.sin(angle)+b*Math.cos(angle)};
  }else if(curve.kind==='bezier'&&curve.points.length===4){
    const [a,b,c,d]=curve.points,u=1-t;
    p={x:u*u*u*a.x+3*u*u*t*b.x+3*u*t*t*c.x+t*t*t*d.x,
      y:u*u*u*a.y+3*u*u*t*b.y+3*u*t*t*c.y+t*t*t*d.y};
  }
  if(!p||!finite(p))return null;
  const e=entity('point',[p]);e.sourceId=curve.id;
  e.reason='Точка на кривой при t='+t.toFixed(4)+
    '; независимый CAD-объект без сохраняемой параметрической связи';return e;
}
