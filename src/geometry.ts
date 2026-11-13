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
  return {...sheet,width:sheet.width*factor,height:sheet.height*factor,calibrated:true,entities:sheet.entities.map(e=>({...e,points:e.points.map(p=>mul(p,factor)),center:e.center?mul(e.center,factor):undefined,radius:e.radius===undefined?undefined:e.radius*factor,size:e.size===undefined?undefined:e.size*factor,offset:e.offset===undefined?undefined:e.offset*factor,width:e.width===undefined?undefined:e.width*factor,height:e.height===undefined?undefined:e.height*factor,bbox:e.bbox?{x0:e.bbox.x0*factor,y0:e.bbox.y0*factor,x1:e.bbox.x1*factor,y1:e.bbox.y1*factor}:undefined}))};
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
  const nonManual=sheet.entities.filter(e=>e.origin==='ocr'||e.origin==='trace'||e.origin==='pdf');
  if(nonManual.length)issues.push({severity:'info',message:'Автоматически восстановлено объектов: '+nonManual.length+'; потребуется сверка.'});
  if(!issues.length)issues.push({severity:'info',message:'Базовые проверки пройдены. Для выпуска КМ/КМД необходима инженерная экспертиза.'});
  return issues;
}
export function measure(p:Point,q:Point) {return dist(p,q).toFixed(2)+' мм';}

/** Merge only automatically imported, nearly collinear and contiguous LINE objects.
 * This is deliberately conservative and preserves all manual CAD geometry. */
export function mergeAutoLines(entities:Entity[],tolerance=2):{entities:Entity[];removed:number} {
  const buckets=new Map<string,Array<{e:Entity;start:number;end:number;ux:number;uy:number;off:number}>>();
  const keep:Entity[]=[];
  const angStep=Math.PI/360;
  for(const e of entities){
    if(e.kind!=='line'||e.points.length!==2||e.verified||e.origin==='manual'){keep.push(e);continue;}
    let a=e.points[0],b=e.points[1],dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy);
    if(len<1e-6){keep.push(e);continue;}
    if(dx<0 || (Math.abs(dx)<1e-10&&dy<0)){[a,b]=[b,a];dx=-dx;dy=-dy;}
    const ux=dx/len,uy=dy/len,angle=Math.atan2(uy,ux),off=-uy*a.x+ux*a.y;
    const key=e.layer+':'+Math.round(angle/angStep)+':'+Math.round(off/Math.max(.01,tolerance));
    const t1=ux*a.x+uy*a.y,t2=ux*b.x+uy*b.y;
    const list=buckets.get(key)||[];list.push({e,start:Math.min(t1,t2),end:Math.max(t1,t2),ux,uy,off});buckets.set(key,list);
  }
  let removed=0;
  for(const list of buckets.values()){
    list.sort((a,b)=>a.start-b.start);
    let cur=list[0];if(!cur)continue;
    for(let i=1;i<list.length;i++){
      const next=list[i];
      if(next.start<=cur.end+Math.max(.01,tolerance)){
        cur={...cur,end:Math.max(cur.end,next.end)};removed++;
      }else{
        const e={...cur.e,verified:false,points:[{x:cur.ux*cur.start-cur.uy*cur.off,y:cur.uy*cur.start+cur.ux*cur.off},{x:cur.ux*cur.end-cur.uy*cur.off,y:cur.uy*cur.end+cur.ux*cur.off}]};keep.push(e);cur=next;
      }
    }
    keep.push({...cur.e,verified:false,points:[{x:cur.ux*cur.start-cur.uy*cur.off,y:cur.uy*cur.start+cur.ux*cur.off},{x:cur.ux*cur.end-cur.uy*cur.off,y:cur.uy*cur.end+cur.ux*cur.off}]});
  }
  return {entities:keep,removed};
}
