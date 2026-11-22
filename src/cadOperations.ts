/** W4 CAD operations: deterministic, bounded line-line geometry.
 *
 * All edits require explicit two-step user selection. No OCR value is used
 * to silently change geometry; no new or edited primitive becomes verified.
 */
import {entity,type Entity,type Point} from './model';
export type OperationResult={
  replacements:Entity[];
  additions:Entity[];
  removals?:string[];
  warning?:string;
};
const EPS=1e-8;
const sub=(a:Point,b:Point):Point=>({x:a.x-b.x,y:a.y-b.y});
const add=(a:Point,b:Point):Point=>({x:a.x+b.x,y:a.y+b.y});
const scale=(a:Point,s:number):Point=>({x:a.x*s,y:a.y*s});
const cross=(a:Point,b:Point)=>a.x*b.y-a.y*b.x;
const dot=(a:Point,b:Point)=>a.x*b.x+a.y*b.y;
const length=(a:Point)=>Math.hypot(a.x,a.y);
const lerp=(a:Point,b:Point,t:number):Point=>add(a,scale(sub(b,a),t));
const between=(x:number)=>x>=-EPS&&x<=1+EPS;
export interface Crossing {point:Point;t:number;u:number}
export function intersectLines(first:Entity,second:Entity):Crossing|null{
  if(first.kind!=='line'||second.kind!=='line'||first.points.length!==2||second.points.length!==2)return null;
  const [a,b]=first.points,[c,d]=second.points;
  const r=sub(b,a),s=sub(d,c),det=cross(r,s);
  const magnitude=length(r)*length(s);
  if(magnitude<EPS||Math.abs(det)<=magnitude*1e-9)return null;
  const ac=sub(c,a);
  const t=cross(ac,s)/det,u=cross(ac,r)/det;
  const point=lerp(a,b,t);
  if(!Number.isFinite(point.x)||!Number.isFinite(point.y))return null;
  return {point,t,u};
}
function edited(e:Entity,points:Point[]):Entity {
  return {...e,points,verified:false,
    reason:'Изменена пользователем в CAD-операции: проверьте геометрию'};
}
/** W4 BREAK: remove a finite span between two manually picked points.
 * Both cut points must project into the INTERIOR of the selected LINE.
 * No OCR information may modify cut coordinates. The original ID remains
 * on the first part; the remainder is one new editable LINE, one Undo step.
 */
export function breakLine(
  source:Entity,firstClick:Point,secondClick:Point,
  pickTolerance=Infinity
):OperationResult|null{
  if(source.kind!=='line'||source.points.length!==2||
    ![firstClick.x,firstClick.y,secondClick.x,secondClick.y].every(Number.isFinite)||
    !Number.isFinite(pickTolerance)&&pickTolerance!==Infinity)return null;
  const [a,b]=source.points,delta=sub(b,a),squared=dot(delta,delta);
  if(!Number.isFinite(squared)||squared<EPS)return null;
  const len=Math.sqrt(squared);
  const project=(p:Point)=>{
    const t=dot(sub(p,a),delta)/squared;
    const closest=lerp(a,b,t);
    return {t,error:length(sub(p,closest))};
  };
  const x=project(firstClick),y=project(secondClick);
  if(x.error>pickTolerance||y.error>pickTolerance)return null;
  const lo=Math.min(x.t,y.t),hi=Math.max(x.t,y.t);
  const eps=Math.max(1e-7,1e-5/len);
  if(lo<=eps||hi>=1-eps||hi-lo<=Math.max(eps,1e-4/len))return null;
  const first=edited(source,[a,lerp(a,b,lo)]);
  const second=entity('line',[lerp(a,b,hi),b],source.layer,'manual');
  second.verified=false;
  second.reason='BREAK: создан оставшийся участок; геометрия не подтверждена инженером';
  return {replacements:[first],additions:[second]};
}

/** W4 OFFSET: create a separate parallel LINE at an explicitly chosen
 * distance and side. Leaves the original line untouched. The measurement unit
 * is controlled by sheet.calibrated in the UI; a raw scan cannot claim mm. */
export function offsetLine(
  source:Entity,distance:number,side:Point
):OperationResult|null{
  if(source.kind!=='line'||source.points.length!==2||
    !Number.isFinite(distance)||distance<=0||distance>1e7||
    !Number.isFinite(side.x)||!Number.isFinite(side.y))return null;
  const [a,b]=source.points;
  const v=sub(b,a),len=length(v);
  if(!Number.isFinite(len)||len<EPS)return null;
  const normal={x:-v.y/len,y:v.x/len};
  const signed=normal.x*(side.x-a.x)+normal.y*(side.y-a.y);
  if(Math.abs(signed)<Math.max(EPS,len*1e-9))return null;
  const delta=scale(normal,signed>0?distance:-distance);
  const points=[add(a,delta),add(b,delta)];
  if(!points.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)))return null;
  const out=entity('line',points,source.layer,'manual');
  out.verified=false;
  out.reason='OFFSET: создан параллельный отрезок; пользователь должен проверить направление, калибровку и расстояние';
  return {replacements:[],additions:[out]};
}

/** Trim the clicked part of a line at the intersection with boundary.
 * Requires physical crossing of BOTH finite segments.
 */
export function trimLine(boundary:Entity,target:Entity,clicked:Point):OperationResult|null{
  const hit=intersectLines(boundary,target);
  if(!hit||!between(hit.t)||!between(hit.u))return null;
  const [a,b]=target.points;
  const dir=sub(b,a),length2=dir.x*dir.x+dir.y*dir.y;
  if(length2<EPS)return null;
  const clickT=((clicked.x-a.x)*dir.x+(clicked.y-a.y)*dir.y)/length2;
  const pts=clickT<=hit.u?[hit.point,b]:[a,hit.point];
  if(length(sub(pts[0],pts[1]))<=Math.max(EPS,Math.sqrt(length2)*1e-5))return null;
  return {replacements:[edited(target,pts)],additions:[]};
}
/** Extend nearest endpoint toward a boundary's INFINITE line, but only when
 * the target endpoint lies before the intersection and the resulting
 * extension is bounded by maxRatio of the original line's length.
 */
export function extendLine(boundary:Entity,target:Entity,clicked:Point,maxRatio=4):OperationResult|null{
  const hit=intersectLines(boundary,target);
  if(!hit||between(hit.u))return null;
  const [a,b]=target.points;
  const len=length(sub(a,b));
  if(len<EPS||length(sub(hit.point,hit.u<0?a:b))>len*maxRatio)return null;
  // Anchor the nonextended endpoint. Never extend inside an existing segment.
  const near=hit.u<0? a:b,far=hit.u<0? b:a;
  if(length(sub(clicked,near))>length(sub(clicked,far))*3){
    // Prevent accidental extension of the wrong end when selection is far away.
    return null;
  }
  return {replacements:[edited(target,hit.u<0?[hit.point,b]:[a,hit.point])],additions:[]};
}
type Ray={original:Entity;point:Point;chosenEnd:Point;vector:Point;len:number};
function rayAt(e:Entity,crossing:Point,clicked:Point):Ray|null{
  const [a,b]=e.points;
  const da=length(sub(a,crossing)),db=length(sub(b,crossing));
  const chosenEnd=length(sub(a,clicked))<=length(sub(b,clicked))?a:b;
  const vector=sub(chosenEnd,crossing),len=length(vector);
  if(len<EPS||!Number.isFinite(len))return null;
  // Intersection must be on a chosen part of both finite segments.
  const other=chosenEnd===a?b:a;
  if(length(sub(other,crossing))>da+db+1e-5)return null;
  return {original:e,point:crossing,chosenEnd,vector:scale(vector,1/len),len};
}
function twoRays(first:Entity,second:Entity,pickFirst:Point,pickSecond:Point){
  const x=intersectLines(first,second);
  if(!x||!between(x.t)||!between(x.u))return null;
  const a=rayAt(first,x.point,pickFirst),b=rayAt(second,x.point,pickSecond);
  if(!a||!b)return null;
  const cosine=a.vector.x*b.vector.x+a.vector.y*b.vector.y;
  if(cosine<=-.99999||cosine>=.99999)return null;
  return {a,b,cosine,intersection:x.point};
}
/** Equal-distance chamfer of two intersecting finite straight segments. */
export function chamferLines(
  first:Entity,second:Entity,pickFirst:Point,pickSecond:Point,offset:number,
):OperationResult|null{
  if(!Number.isFinite(offset)||offset<=0)return null;
  const r=twoRays(first,second,pickFirst,pickSecond);
  if(!r||r.a.len<offset+EPS||r.b.len<offset+EPS)return null;
  const x=add(r.intersection,scale(r.a.vector,offset));
  const y=add(r.intersection,scale(r.b.vector,offset));
  const bridge=entity('line',[x,y],first.layer,'manual');
  bridge.verified=false;bridge.reason='Фаска построена вручную: проверить радиусы/размеры';
  return {replacements:[edited(first,[r.a.chosenEnd,x]),edited(second,[r.b.chosenEnd,y])],
    additions:[bridge]};
}
/** Tangent circular fillet between two finite rays (no guessing of radius).
 * Finds center on internal angle bisector and builds a minor canvas arc.
 */
export function filletLines(
  first:Entity,second:Entity,pickFirst:Point,pickSecond:Point,radius:number,
):OperationResult|null{
  if(!Number.isFinite(radius)||radius<=0)return null;
  const r=twoRays(first,second,pickFirst,pickSecond);
  if(!r)return null;
  const theta=Math.acos(Math.max(-1,Math.min(1,r.cosine)));
  const distance=radius/Math.tan(theta/2);
  if(!Number.isFinite(distance)||distance>r.a.len-EPS||distance>r.b.len-EPS)return null;
  const tx=add(r.intersection,scale(r.a.vector,distance));
  const ty=add(r.intersection,scale(r.b.vector,distance));
  const bisector=add(r.a.vector,r.b.vector),bl=length(bisector);
  if(bl<EPS)return null;
  const center=add(r.intersection,scale(bisector,radius/(Math.sin(theta/2)*bl)));
  if(Math.abs(length(sub(center,tx))-radius)>1e-5||
     Math.abs(length(sub(center,ty))-radius)>1e-5)return null;
  const arc=entity('arc',[tx,ty],first.layer,'manual');
  arc.center=center;arc.radius=radius;arc.verified=false;
  arc.reason='Сопряжение построено вручную: проверить касание и размер';
  let start=Math.atan2(tx.y-center.y,tx.x-center.x);
  let end=Math.atan2(ty.y-center.y,ty.x-center.x);
  const mod=(x:number)=>((x%(2*Math.PI))+2*Math.PI)%(2*Math.PI);
  if(mod(end-start)>Math.PI){[start,end]=[end,start];}
  arc.startAngle=start;arc.endAngle=end;
  return {replacements:[edited(first,[r.a.chosenEnd,tx]),edited(second,[r.b.chosenEnd,ty])],
    additions:[arc]};
}

/** W4 JOIN: user selects two open segments/polylines with a single identical
 * endpoint. No extension, snap over a white gap, T-junction assumption, or
 * automatic verification. Original #1 ID survives, #2 removed in one Undo.
 * Reject ambiguous dual-ended overlap/loops and near 180° backtracking.
 */
export function joinCadEntities(
  first:Entity,second:Entity,tolerance=1e-5
):OperationResult|null {
  const allowed=(e:Entity)=> (e.kind==='line'||e.kind==='polyline')&&
    !e.closed&&e.points.length>=2&&e.points.length<=10000&&
    e.points.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y));
  if(!allowed(first)||!allowed(second)||first.id===second.id||
    first.layer!==second.layer||!Number.isFinite(tolerance)||
    tolerance<0||tolerance>.001)return null;
  const ae=[first.points[0],first.points[first.points.length-1]];
  const be=[second.points[0],second.points[second.points.length-1]];
  const matches:Array<{i:number;j:number}>=[];
  for(let i=0;i<2;i++)for(let j=0;j<2;j++){
    if(length(sub(ae[i],be[j]))<=tolerance)matches.push({i,j});
  }
  // Two matches suggest duplicated/reversed paths or a loop: do not guess.
  if(matches.length!==1)return null;
  const {i,j}=matches[0];
  const left=i===0?[...first.points].reverse():[...first.points];
  const right=j===1?[...second.points].reverse():[...second.points];
  const a=left[left.length-2],junctionA=left[left.length-1],
    junctionB=right[0],b=right[1];
  const incoming=sub(junctionA,a),outgoing=sub(b,junctionB);
  const lenA=length(incoming),lenB=length(outgoing);
  if(!Number.isFinite(lenA)||!Number.isFinite(lenB)||lenA<=EPS||lenB<=EPS)return null;
  const cosine=dot(incoming,outgoing)/(lenA*lenB);
  // Reject doubling back along the same feature: not a valid open JOIN.
  if(cosine<-.99999)return null;
  const joined={x:(junctionA.x+junctionB.x)/2,y:(junctionA.y+junctionB.y)/2};
  const combined=[...left.slice(0,-1),joined,...right.slice(1)];
  if(combined.length>20000||combined.slice(1).some((p,k)=>length(sub(p,combined[k]))<=EPS))return null;
  const straight=first.kind==='line'&&second.kind==='line'&&cosine>1-1e-9;
  const updated:Entity={...first,kind:straight?'line':'polyline',
    points:straight?[combined[0],combined[combined.length-1]]:combined,
    closed:false,origin:'manual',verified:false,confidence:undefined,
    bbox:undefined,sourceId:undefined,chainId:undefined,
    reason:'JOIN: концы выбраны пользователем и совпали; требуется проверка исходной геометрии'};
  return {replacements:[updated],additions:[],removals:[second.id],
    warning:'Соединение подтверждается пользователем; отсутствующие штрихи не восстанавливаются'};
}
