import type {CadProject,Entity,Point,Sheet} from './model';
const EPS=1e-8;
export const add=(a:Point,b:Point):Point=>({x:a.x+b.x,y:a.y+b.y});
export const sub=(a:Point,b:Point):Point=>({x:a.x-b.x,y:a.y-b.y});
export const mul=(a:Point,k:number):Point=>({x:a.x*k,y:a.y*k});
export const dist=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y);
export const mid=(a:Point,b:Point):Point=>mul(add(a,b),.5);
export function pointSegmentDistance(p:Point,a:Point,b:Point) {
  const dx=b.x-a.x,dy=b.y-a.y,len=dx*dx+dy*dy;
  if(len<EPS)return dist(p,a);
  const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/len));
  return dist(p,{x:a.x+t*dx,y:a.y+t*dy});
}
export function shapeDistance(p:Point,e:Entity) {
  if(e.kind==='circle'||e.kind==='arc')return Math.abs(dist(p,e.center||e.points[0])- (e.radius||0));
  if(e.kind==='text'||e.kind==='table'||e.kind==='stamp')return dist(p,e.points[0]);
  const pts=e.points;
  if(!pts.length)return Infinity;
  if(pts.length===1)return dist(p,pts[0]);
  let best=Infinity;
  for(let i=1;i<pts.length;i++)best=Math.min(best,pointSegmentDistance(p,pts[i-1],pts[i]));
  if(e.closed&&pts.length>2)best=Math.min(best,pointSegmentDistance(p,pts[pts.length-1],pts[0]));
  return best;
}
export function findHit(p:Point,entities:Entity[],tol:number) {for(let i=entities.length-1;i>=0;i--)if(shapeDistance(p,entities[i])<=tol)return entities[i];return undefined;}
export function snapPoint(p:Point,entities:Entity[],tolerance:number,grid=0):Point {
  let result=p,best=tolerance;
  if(grid>0){const a={x:Math.round(p.x/grid)*grid,y:Math.round(p.y/grid)*grid};const d=dist(a,p);if(d<best){result=a;best=d;}}
  for(const e of entities){
    const pts=[...e.points];if(e.center)pts.push(e.center);
    if(e.points.length===2)pts.push(mid(e.points[0],e.points[1]));
    for(const a of pts){const d=dist(p,a);if(d<best){best=d;result=a;}}
  }return result;
}
export function translateEntity(e:Entity,d:Point):Entity {return {...e,points:e.points.map(p=>add(p,d)),center:e.center?add(e.center,d):undefined};}
export function scaleSheet(sheet:Sheet,factor:number):Sheet {
  if(!Number.isFinite(factor)||factor<=0)throw new Error('Неверный масштаб');
  return {...sheet,width:sheet.width*factor,height:sheet.height*factor,calibrated:true,entities:sheet.entities.map(e=>({...e,points:e.points.map(p=>mul(p,factor)),center:e.center?mul(e.center,factor):undefined,radius:e.radius===undefined?undefined:e.radius*factor,size:e.size===undefined?undefined:e.size*factor,offset:e.offset===undefined?undefined:e.offset*factor,width:e.width===undefined?undefined:e.width*factor,height:e.height===undefined?undefined:e.height*factor}))};
}
export function dimensionLength(e:Entity) {return e.points.length<2?0:dist(e.points[0],e.points[1]);}
export interface AuditItem {severity:'warning'|'info';message:string;id?:string}
export function auditSheet(sheet:Sheet, project:CadProject):AuditItem[] {
  const issues:AuditItem[]=[];
  if(!sheet.calibrated)issues.push({severity:'warning',message:'Лист не калиброван: координаты и размеры могут не соответствовать миллиметрам.'});
  const visibleLayers=new Set(project.layers.map(l=>l.name));
  const unverified=sheet.entities.filter(e=>!e.verified);
  if(unverified.length)issues.push({severity:'warning',message:'Непроверенных объектов: '+unverified.length+'. Их нельзя считать инженерно подтверждёнными.'});
  const missingLayer=sheet.entities.filter(e=>!visibleLayers.has(e.layer));
  if(missingLayer.length)issues.push({severity:'warning',message:'Объектов с отсутствующим слоем: '+missingLayer.length});
  const zero=sheet.entities.filter(e=>['line','dimension','axis','leader'].includes(e.kind) && dimensionLength(e)<EPS);
  if(zero.length)issues.push({severity:'warning',message:'Нулевых отрезков: '+zero.length});
  const contours=sheet.entities.filter(e=>e.kind==='polyline' && !e.closed);
  if(contours.length)issues.push({severity:'info',message:'Незамкнутых полилиний: '+contours.length});
  const nonManual=sheet.entities.filter(e=>e.origin==='ocr'||e.origin==='trace'||e.origin==='pdf');
  if(nonManual.length)issues.push({severity:'info',message:'Автоматически восстановлено объектов: '+nonManual.length+'; потребуется сверка.'});
  if(!issues.length)issues.push({severity:'info',message:'Базовые проверки пройдены. Для выпуска КМ/КМД необходима инженерная экспертиза.'});
  return issues;
}
export function measure(p:Point,q:Point) {return dist(p,q).toFixed(2)+' мм';}