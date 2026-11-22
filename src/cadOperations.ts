/** W4 CAD operations: deterministic, bounded line-line geometry.
 *
 * All edits require explicit two-step user selection. No OCR value is used
 * to silently change geometry; no new or edited primitive becomes verified.
 */
import {entity,type Entity,type Point} from './model';
export type OperationResult={
  replacements:Entity[];
  additions:Entity[];
  warning?:string;
};
const EPS=1e-8;
const sub=(a:Point,b:Point):Point=>({x:a.x-b.x,y:a.y-b.y});
const add=(a:Point,b:Point):Point=>({x:a.x+b.x,y:a.y+b.y});
const scale=(a:Point,s:number):Point=>({x:a.x*s,y:a.y*s});
const cross=(a:Point,b:Point)=>a.x*b.y-a.y*b.x;
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
