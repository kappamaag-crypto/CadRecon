/** Explicit, browser-only W4 geometry transforms.
 * Conservative geometry support: POINT / LINE / open POLYLINE / CIRCLE.
 * No auto verification, no silent edits to original references.
 */
import {newId,type Entity,type Point} from './model';
import type {OperationResult} from './cadOperations';
const EPS=1e-7;
const point=(p:Point)=>Number.isFinite(p.x)&&Number.isFinite(p.y);
const distance=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y);
const editable=(e:Entity)=>['point','line','polyline','circle'].includes(e.kind)&&
  !e.closed&&e.points.length>=1&&e.points.length<=200&&e.points.every(point)&&
  (e.kind!=='circle'||!!e.center&&point(e.center)&&Number.isFinite(e.radius)&&e.radius!>EPS);
const clone=(e:Entity):Entity=>({...e,id:newId(),origin:'manual',verified:false,
  confidence:undefined,sourceId:undefined,chainId:undefined,bbox:undefined,
  reason:'Создано CAD-преобразованием, требуется инженерная проверка по оригиналу'});
export function mirrorEntity(source:Entity,axisA:Point,axisB:Point):OperationResult|null{
  if(!editable(source)||!point(axisA)||!point(axisB))return null;
  const dx=axisB.x-axisA.x,dy=axisB.y-axisA.y,length2=dx*dx+dy*dy;
  if(!Number.isFinite(length2)||length2<EPS)return null;
  const reflect=(p:Point):Point=>{
    const t=((p.x-axisA.x)*dx+(p.y-axisA.y)*dy)/length2;
    return {x:2*(axisA.x+t*dx)-p.x,y:2*(axisA.y+t*dy)-p.y};
  };
  const points=source.points.map(reflect);
  const center=source.center?reflect(source.center):undefined;
  if(!points.every(point)||center&&!point(center))return null;
  const mirrored:Entity={...clone(source),points,center};
  return {replacements:[],additions:[mirrored]};
}
export function arrayEntity(
  source:Entity,columns:number,rows:number,dx:number,dy:number
):OperationResult|null{
  if(!editable(source)||!Number.isInteger(columns)||!Number.isInteger(rows)||
    columns<1||rows<1||columns>20||rows>20||
    columns*rows<2||columns*rows>100||![dx,dy].every(Number.isFinite)||
    Math.abs(dx)>1e6||Math.abs(dy)>1e6||
    (columns>1&&Math.abs(dx)<EPS)||(rows>1&&Math.abs(dy)<EPS))return null;
  const additions:Entity[]=[];
  for(let r=0;r<rows;r++)for(let c=0;c<columns;c++){
    if(!r&&!c)continue;
    const shift={x:c*dx,y:r*dy};
    const moved:Entity={...clone(source),
      points:source.points.map(p=>({x:p.x+shift.x,y:p.y+shift.y})),
      center:source.center?{x:source.center.x+shift.x,y:source.center.y+shift.y}:undefined,
    };
    if(!moved.points.every(point)||moved.center&&!point(moved.center))return null;
    additions.push(moved);
  }
  return {replacements:[],additions};
}
export function stretchVertex(source:Entity,index:number,to:Point):OperationResult|null{
  if((source.kind!=='line'&&source.kind!=='polyline')||source.closed||
    source.points.length<2||source.points.length>200||
    !source.points.every(point)||!Number.isInteger(index)||index<0||index>=source.points.length||
    !point(to)||distance(source.points[index],to)<EPS)return null;
  const points=source.points.map((p,i)=>i===index?{...to}:{...p});
  if(points.slice(1).some((p,i)=>distance(p,points[i])<EPS))return null;
  // Reject any self-crossing created by moving the selected vertex.
  const cross=(a:Point,b:Point,c:Point)=> (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  const crosses=(a:Point,b:Point,c:Point,d:Point)=>{
    const x=cross(a,b,c),y=cross(a,b,d),z=cross(c,d,a),w=cross(c,d,b);
    return x*y< -EPS&&z*w< -EPS;
  };
  for(let i=0;i<points.length-1;i++)for(let j=i+2;j<points.length-1;j++)
    if(crosses(points[i],points[i+1],points[j],points[j+1]))return null;
  const updated:Entity={...source,points,origin:'manual',verified:false,
    confidence:undefined,bbox:undefined,sourceId:undefined,chainId:undefined,
    reason:'STRETCH: вершина передвинута вручную; требуется проверка геометрии'};
  return {replacements:[updated],additions:[]};
}
