/** W4 read-only CAD measurements and contour diagnostics.
 * Sheet coordinate units only; not a proof of watertight 3D geometry.
 * Bounded scans avoid freezing a large GitHub Pages project.
 */
import type {Entity,Point} from './model';
const PI=Math.PI,EPS=1e-8;
const d=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y);
const finite=(p:Point)=>Number.isFinite(p.x)&&Number.isFinite(p.y);
export interface GeometryMeasure {
  kind:string;length?:number;perimeter?:number;area?:number;radius?:number;
  closed?:boolean;note:string;
}
const length=(points:Point[],closed=false)=>{
  let result=0;
  for(let i=1;i<points.length;i++)result+=d(points[i-1],points[i]);
  if(closed&&points.length>2)result+=d(points[points.length-1],points[0]);
  return result;
};
const polygonArea=(pts:Point[])=>Math.abs(pts.reduce((sum,p,i)=>{
  const next=pts[(i+1)%pts.length];return sum+p.x*next.y-next.x*p.y;
},0))*.5;
export function measureCadEntity(e:Entity):GeometryMeasure|null{
  if(!e.points.length||e.points.length>2000||!e.points.every(finite))return null;
  if(e.kind==='line'||e.kind==='axis'||e.kind==='construction'){
    if(e.points.length<2)return null;
    return {kind:e.kind,length:d(e.points[0],e.points[1]),note:
      e.kind==='construction'?'Определяющий вектор бесконечной линии (не длина линии)':'Длина в единицах листа'};
  }
  if(e.kind==='polyline'||e.kind==='hatch'){
    const closed=e.kind==='hatch'||!!e.closed;
    return {kind:e.kind,length:length(e.points,closed),perimeter:closed?length(e.points,true):undefined,
      area:closed&&e.points.length>=3?polygonArea(e.points):undefined,closed,
      note:closed?'Площадь по формуле Гаусса: применима только к простому несамопересекающемуся контуру':
        'Открытый контур: площадь не рассчитывается'};
  }
  if(e.kind==='circle'&&e.radius!==undefined&&Number.isFinite(e.radius)){
    return {kind:e.kind,radius:e.radius,length:2*PI*e.radius,
      perimeter:2*PI*e.radius,area:PI*e.radius*e.radius,closed:true,
      note:'Точная геометрия окружности в единицах листа'};
  }
  if(e.kind==='ellipse'&&e.radius&&e.axisRatio){
    const a=e.radius,b=a*e.axisRatio;
    const h=(a-b)*(a-b)/((a+b)*(a+b));
    return {kind:e.kind,area:PI*a*b,perimeter:PI*(a+b)*(1+3*h/(10+Math.sqrt(4-3*h))),
      closed:true,note:'Площадь эллипса точная; длина приблизительная (Рамануджан II)'};
  }
  if(e.kind==='arc'&&e.radius!==undefined){
    const delta=((e.endAngle||0)-(e.startAngle||0))%(2*PI);
    return {kind:e.kind,radius:e.radius,length:Math.abs(delta)*e.radius,
      note:'Длина круговой дуги; угол в радианах'};
  }
  return null;
}
export function angleBetweenCadLines(a:Entity,b:Entity):number|null{
  if(a.kind!=='line'||b.kind!=='line'||a.points.length!==2||b.points.length!==2||
    ![...a.points,...b.points].every(finite))return null;
  const u={x:a.points[1].x-a.points[0].x,y:a.points[1].y-a.points[0].y},
    v={x:b.points[1].x-b.points[0].x,y:b.points[1].y-b.points[0].y};
  const den=Math.hypot(u.x,u.y)*Math.hypot(v.x,v.y);
  if(den<EPS)return null;
  return Math.acos(Math.max(-1,Math.min(1,(u.x*v.x+u.y*v.y)/den)))*180/PI;
}
export interface TopologyFinding {
  kind:'open-end'|'gap'|'duplicate';entityId:string;relatedId?:string;description:string;
}
export interface TopologyReport {
  checked:number;openEnds:number;nearGaps:number;duplicates:number;closedPolylines:number;
  truncated:boolean;findings:TopologyFinding[];
}
/** Endpoint matching is deliberately exact to tolerance. A near-gap is
 * reported, NEVER filled. No inference that two lines belong to one contour.
 */
export function inspectCadTopology(entities:Entity[],tolerance=.01):TopologyReport{
  if(!Number.isFinite(tolerance)||tolerance<=0||tolerance>2)
    throw new Error('Топология: допуск должен быть от 0 до 2 ед. листа');
  const LIMIT=800;
  const segments=entities.filter(e=>e.kind==='line'&&e.points.length===2&&e.points.every(finite))
    .slice(0,LIMIT);
  const count=entities.filter(e=>e.kind==='line').length;
  const closedPolylines=entities.filter(e=>e.kind==='polyline'&&e.closed).length;
  const findings:TopologyFinding[]=[];
  const push=(finding:TopologyFinding)=>{if(findings.length<80)findings.push(finding);};
  let duplicates=0,openEnds=0,nearGaps=0;
  const ends:Array<{entity:Entity;point:Point;other:Point;connected:boolean}>=[];
  const fingerprints=new Set<string>();
  const pointKey=(p:Point)=>Math.round(p.x/tolerance)+':'+Math.round(p.y/tolerance);
  for(const e of segments){
    const [a,b]=e.points;
    if(d(a,b)<EPS)continue;
    const key=[pointKey(a),pointKey(b)].sort().join('|');
    if(fingerprints.has(key)){
      duplicates++;
      push({kind:'duplicate',entityId:e.id,description:'Совпадающий отрезок: проверить перед удалением'});
      // The duplicated segment is not a second real edge and must not
      // falsely mark both endpoints as connected in closure diagnostics.
      continue;
    }else fingerprints.add(key);
    ends.push({entity:e,point:a,other:b,connected:false},
      {entity:e,point:b,other:a,connected:false});
  }
  const cells=new Map<string,number[]>(),s=tolerance*2;
  const grid=(p:Point)=>[Math.floor(p.x/s),Math.floor(p.y/s)] as const;
  for(let i=0;i<ends.length;i++){
    const end=ends[i],g=grid(end.point);
    for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){
      const neighbors=cells.get((g[0]+dx)+':'+(g[1]+dy))||[];
      for(const j of neighbors){
        const previous=ends[j];
        if(previous.entity.id===end.entity.id)continue;
        if(d(previous.point,end.point)<=tolerance){previous.connected=end.connected=true;}
      }
    }
    const key=g[0]+':'+g[1];const list=cells.get(key)||[];list.push(i);cells.set(key,list);
  }
  const dangling=ends.filter(e=>!e.connected);
  openEnds=dangling.length;
  for(const e of dangling.slice(0,40))push({kind:'open-end',entityId:e.entity.id,
    description:'Свободный конец LINE; не обязательно ошибка, проверить замкнутость'});
  // Report only nearby endpoints of distinct lines with facing co-linear rays.
  // Bound to first 400 unmatched endpoints; no destructive auto-joining.
  const sample=dangling.slice(0,400),GAP=8;
  const dot=(u:Point,v:Point)=>u.x*v.x+u.y*v.y;
  for(let i=0;i<sample.length;i++)for(let j=i+1;j<sample.length;j++){
    const a=sample[i],b=sample[j];
    if(a.entity.id===b.entity.id)continue;
    const delta=d(a.point,b.point);
    if(delta<=tolerance||delta>GAP)continue;
    const toward={x:(b.point.x-a.point.x)/delta,y:(b.point.y-a.point.y)/delta};
    const ua={x:(a.point.x-a.other.x)/d(a.point,a.other),y:(a.point.y-a.other.y)/d(a.point,a.other)};
    const ub={x:(b.point.x-b.other.x)/d(b.point,b.other),y:(b.point.y-b.other.y)/d(b.point,b.other)};
    if(dot(ua,toward)<.985||dot(ub,toward)>-.985)continue;
    nearGaps++;push({kind:'gap',entityId:a.entity.id,relatedId:b.entity.id,
      description:'Потенциальный соосный зазор '+delta.toFixed(2)+' ед. листа. НЕ замкнут автоматически'});
  }
  return {checked:segments.length,openEnds,nearGaps,duplicates,closedPolylines,
    truncated:count>LIMIT||dangling.length>400||findings.length>=80,findings};
}
