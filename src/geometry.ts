import type {CadProject,Entity,Point,Sheet} from './model';
import {auditNominalChains} from './dimensionAudit';
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
  // Editable cubic PDF curves: approximate hit-testing on the true curve,
  // not its control polygon (the latter is NOT the displayed geometry).
  if(e.kind==='bezier'&&e.points.length===4){
    const [a,b,c,d]=e.points;
    let prev=a,best=Infinity;
    for(let k=1;k<=32;k++){
      const t=k/32,u=1-t;
      const q={x:u*u*u*a.x+3*u*u*t*b.x+3*u*t*t*c.x+t*t*t*d.x,
        y:u*u*u*a.y+3*u*u*t*b.y+3*u*t*t*c.y+t*t*t*d.y};
      best=Math.min(best,pointSegmentDistance(p,prev,q));prev=q;
    }
    return best;
  }
  if(e.kind==='circle'||e.kind==='arc')return Math.abs(dist(p,e.center||e.points[0])- (e.radius||0));
  if(e.kind==='text'||e.kind==='table'||e.kind==='stamp'||e.kind==='eskd')return dist(p,e.points[0]);
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
  return {...sheet,width:sheet.width*factor,height:sheet.height*factor,calibrated:true,entities:sheet.entities.map(e=>({...e,verified:false,reason:'Масштаб листа изменён: требуется повторная проверка геометрии',points:e.points.map(p=>mul(p,factor)),center:e.center?mul(e.center,factor):undefined,radius:e.radius===undefined?undefined:e.radius*factor,size:e.size===undefined?undefined:e.size*factor,offset:e.offset===undefined?undefined:e.offset*factor,width:e.width===undefined?undefined:e.width*factor,height:e.height===undefined?undefined:e.height*factor,bbox:e.bbox?{x0:e.bbox.x0*factor,y0:e.bbox.y0*factor,x1:e.bbox.x1*factor,y1:e.bbox.y1*factor}:undefined}))};
}
export function dimensionLength(e:Entity) {return e.points.length<2?0:dist(e.points[0],e.points[1]);}
export interface AuditItem {severity:'warning'|'info';message:string;id?:string}
export function auditSheet(sheet:Sheet, project:CadProject):AuditItem[] {
  const issues:AuditItem[]=[];
  if(!sheet.calibrated)issues.push({severity:'warning',message:'Лист не калиброван: координаты и размеры могут не соответствовать миллиметрам.'});
  for(const message of sheet.importWarnings||[])issues.push({severity:'warning',message:'Импорт PDF: '+message});
  const visibleLayers=new Set(project.layers.map(l=>l.name));
  const unverified=sheet.entities.filter(e=>!e.verified);
  if(unverified.length)issues.push({severity:'warning',message:'Непроверенных объектов: '+unverified.length+'. Их нельзя считать инженерно подтверждёнными.'});
  const missingLayer=sheet.entities.filter(e=>!visibleLayers.has(e.layer));
  if(missingLayer.length)issues.push({severity:'warning',message:'Объектов с отсутствующим слоем: '+missingLayer.length});
  const zero=sheet.entities.filter(e=>['line','dimension','axis','leader'].includes(e.kind) && dimensionLength(e)<EPS);
  if(zero.length)issues.push({severity:'warning',message:'Нулевых отрезков: '+zero.length});
  const contours=sheet.entities.filter(e=>e.kind==='polyline' && !e.closed);
  if(contours.length)issues.push({severity:'info',message:'Незамкнутых полилиний: '+contours.length});
  const untrusted=sheet.entities.filter(e=>!e.verified&&(e.kind==='dimension'||e.kind==='eskd')&&e.origin!=='manual');
  if(untrusted.length)issues.push({severity:'warning',message:'Неподтверждённых размерных и ЕСКД-объектов: '+untrusted.length});
  // Re-evaluate whenever the geometry or calibration changes; do not trust a stale OCR report.
  const discrepancies=sheet.entities.filter(e=>{
    if(e.kind!=='dimension'||!e.sourceId||!sheet.calibrated)return false;
    const found=/^\s*(\d+(?:[.,]\d+)?)\s*(?:мм)?\s*$/i.exec(e.text||'');
    if(!found)return false;
    const stated=Number(found[1].replace(',','.'));
    return stated>0&&Math.abs(dimensionLength(e)-stated)/stated>.025;
  });
  if(discrepancies.length)issues.push({severity:'warning',message:'Размерные значения противоречат текущей геометрии: '+discrepancies.length});
  issues.push(...auditNominalChains(sheet));
  const nonManual=sheet.entities.filter(e=>e.origin==='ocr'||e.origin==='trace'||e.origin==='pdf');
  if(nonManual.length)issues.push({severity:'info',message:'Автоматически восстановлено объектов: '+nonManual.length+'; потребуется сверка.'});
  if(!issues.length)issues.push({severity:'info',message:'Базовые проверки пройдены. Для выпуска КМ/КМД необходима инженерная экспертиза.'});
  return issues;
}
export function measure(p:Point,q:Point,calibrated=false) {return dist(p,q).toFixed(2)+(calibrated?' мм':' усл. ед. (масштаб не подтверждён)');}

/** Safely de-duplicate overlapping imported LINE hypotheses.
 * Never create geometry across ANY positive white/unknown gap. Unlike the
 * former implementation, merely sharing an angle/offset hash is insufficient.
 * For PDF vectors, preserve sub-millimetric parallel paths even if close.
 */
export function mergeAutoLines(entities:Entity[],tolerance=2):{entities:Entity[];removed:number} {
  type Candidate={e:Entity;a:Point;u:Point;n:Point;start:number;end:number;angle:number;offset:number;length:number};
  type Group=Candidate&{joinCount:number;worstConfidence:number};
  const bins=new Map<string,Candidate[]>();
  const result:Entity[]=[];
  const dot=(p:Point,q:Point)=>p.x*q.x+p.y*q.y;
  const diff=(p:Point,q:Point):Point=>({x:p.x-q.x,y:p.y-q.y});
  for(const e of entities){
    if(e.kind!=='line'||e.points.length!==2||e.verified||
      (e.origin!=='pdf'&&e.origin!=='trace')){
      result.push(e);continue;
    }
    let [a,b]=e.points;
    if(![a.x,a.y,b.x,b.y].every(Number.isFinite)){result.push(e);continue;}
    const len=Math.hypot(b.x-a.x,b.y-a.y);
    if(!Number.isFinite(len)||len<1){result.push(e);continue;}
    let dx=b.x-a.x,dy=b.y-a.y;
    if(dx<0||(Math.abs(dx)<1e-12&&dy<0)){[a,b]=[b,a];dx=-dx;dy=-dy;}
    const u={x:dx/len,y:dy/len},n={x:-u.y,y:u.x};
    const angle=Math.atan2(u.y,u.x),offset=dot(a,n);
    const candidate:Candidate={e,a,u,n,start:dot(a,u),end:dot(b,u),angle,offset,length:len};
    const crossTol=e.origin==='pdf'?1e-4:Math.min(.12,Math.max(1e-5,tolerance));
    const step=Math.max(1e-4,2*crossTol);
    const key=[e.layer,e.origin,Math.round(angle/(Math.PI/360)),Math.round(offset/step)].join('|');
    const bucket=bins.get(key)||[];bucket.push(candidate);bins.set(key,bucket);
  }
  let removed=0;
  for(const bucket of bins.values()){
    bucket.sort((a,b)=>a.start-b.start||b.length-a.length);
    let group:Group|null=null;
    const flush=()=>{
      if(!group)return;
      const g=group;
      if(g.joinCount===1){result.push(g.e);return;}
      const {u,n,offset,start,end,e}=g;
      result.push({...e,points:[
        {x:u.x*start+n.x*offset,y:u.y*start+n.y*offset},
        {x:u.x*end+n.x*offset,y:u.y*end+n.y*offset},
      ],verified:false,confidence:g.worstConfidence,
        reason:'Убраны только геометрически перекрывающиеся автоматические LINE; проверка по оригиналу обязательна'});
    };
    for(const p of bucket){
      if(!group){group={...p,joinCount:1,worstConfidence:p.e.confidence??1};continue;}
      const g=group;
      const cos=dot(g.u,p.u);
      const crossA=Math.abs(dot(diff(p.a,g.a),g.n));
      const crossB=Math.abs(dot(diff(p.e.points[1],g.a),g.n));
      const tol=p.e.origin==='pdf'?1e-4:Math.min(.12,Math.max(1e-5,tolerance));
      const projected=p.e.points.map(x=>dot(x,g.u));
      const lo=Math.min(...projected),hi=Math.max(...projected);
      const overlap=Math.min(g.end,hi)-Math.max(g.start,lo);
      // Actual positive overlap: touching endpoints or separated strokes are
      // not sufficient. No extrapolation, invented CAD line, or bridge.
      if(cos>=Math.cos(Math.PI/720)&&crossA<=tol&&crossB<=tol&&
        overlap>=Math.min(.05,Math.min(g.length,p.length)*.01)){
        group.end=Math.max(group.end,hi);
        group.start=Math.min(group.start,lo);
        group.joinCount++;
        group.worstConfidence=Math.min(group.worstConfidence,p.e.confidence??1);
        removed++;
      }else{
        flush();
        group={...p,joinCount:1,worstConfidence:p.e.confidence??1};
      }
    }
    flush();
  }
  return {entities:result,removed};
}
