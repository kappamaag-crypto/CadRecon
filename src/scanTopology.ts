/** Conservative scan line reconciliation, executed entirely in the browser.
 *
 * Hough voting may return repeated line fragments from the SAME ink stroke.
 * Merge only overlapping, nearly identical collinear candidates. Never
 * bridge a visible gap, connect parallel adjacent contours, or mark results
 * as verified. This is NOT a complete contour-topology reconstruction.
 */
import type {Entity,Point} from './model';

type Unit={x:number;y:number};
type Item={e:Entity;u:Unit;n:Unit;angle:number;offset:number;start:number;end:number;length:number};
type Group=Item&{joined:number;worstConfidence:number};
export interface Consolidation {
  entities:Entity[];
  removed:number;
  candidates:number;
  warning?:string;
}
const dot=(a:Point,b:Point)=>a.x*b.x+a.y*b.y;
const sub=(a:Point,b:Point):Point=>({x:a.x-b.x,y:a.y-b.y});
const d=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y);
const EPS=1e-7;

function candidate(e:Entity):Item|null {
  if(e.kind!=='line'||e.origin!=='trace'||e.verified||e.points.length!==2)return null;
  let [a,b]=e.points;
  if(![a.x,a.y,b.x,b.y].every(Number.isFinite))return null;
  const len=d(a,b);
  if(len<16||!Number.isFinite(len))return null;
  let dx=b.x-a.x,dy=b.y-a.y;
  if(dx<0||(Math.abs(dx)<EPS&&dy<0)){[a,b]=[b,a];dx=-dx;dy=-dy;}
  const u={x:dx/len,y:dy/len},n={x:-u.y,y:u.x};
  return {e,u,n,angle:Math.atan2(u.y,u.x),offset:dot(a,n),
    start:dot(a,u),end:dot(b,u),length:len};
}

/** A guarantee of "not joining gaps" is stronger than a high recall claim.
 * Neighboring fragments separated by > 0.75 source pixels stay separate.
 */
export function consolidateScanLines(
  input:Entity[],
  maxCrossTrack=0.85,
  maxGap=0.75,
):Consolidation {
  const bins=new Map<string,Group[]>();
  const passthrough:Entity[]=[];
  const usable:Item[]=[];
  for(const e of input){
    const p=candidate(e);
    if(p)usable.push(p);else passthrough.push(e);
  }
  usable.sort((a,b)=>b.length-a.length); // longest evidence becomes reference
  const angleBin=(angle:number)=>Math.floor(angle/(Math.PI/360)); // half-degree
  const offsetBin=(off:number)=>Math.floor(off/1.25);
  const key=(a:number,o:number,layer:string)=>layer+':'+a+':'+o;
  const recorded=new Set<Group>();
  for(const p of usable){
    const ai=angleBin(p.angle),oi=offsetBin(p.offset);
    let best:Group|null=null;
    for(let da=-1;da<=1;da++)for(let dn=-1;dn<=1;dn++){
      const list=bins.get(key(ai+da,oi+dn,p.e.layer));
      if(!list)continue;
      for(const g of list){
        if(g.e.origin!==p.e.origin)continue;
        const cos=dot(p.u,g.u);
        if(cos<Math.cos(Math.PI/180))continue;
        const a=p.e.points[0],b=p.e.points[1];
        const xa=dot(sub(a,g.e.points[0]),g.n);
        const xb=dot(sub(b,g.e.points[0]),g.n);
        if(Math.abs(xa)>maxCrossTrack||Math.abs(xb)>maxCrossTrack)continue;
        const v0=dot(a,g.u),v1=dot(b,g.u);
        const lo=Math.min(v0,v1),hi=Math.max(v0,v1);
        // No bridge across missing strokes: only actual overlap or
        // subpixel endpoint rasterization.
        if(hi<g.start-maxGap||lo>g.end+maxGap)continue;
        best=g;break;
      }
      if(best)break;
    }
    if(best){
      const vals=p.e.points.map(x=>dot(x,best.u));
      best.start=Math.min(best.start,...vals);
      best.end=Math.max(best.end,...vals);
      best.joined++;
      best.worstConfidence=Math.min(best.worstConfidence,p.e.confidence??0);
    }else{
      const group:Group={...p,joined:1,worstConfidence:p.e.confidence??0};
      const k=key(ai,oi,p.e.layer);
      const list=bins.get(k)||[];list.push(group);bins.set(k,list);
      recorded.add(group);
    }
  }
  const output:Entity[]=[...passthrough];
  let removed=0;
  for(const group of recorded){
    if(group.joined===1){output.push(group.e);continue;}
    removed+=group.joined-1;
    const {u,n,offset,start,end,e}=group;
    output.push({...e,points:[
      {x:u.x*start+n.x*offset,y:u.y*start+n.y*offset},
      {x:u.x*end+n.x*offset,y:u.y*end+n.y*offset},
    ],confidence:group.worstConfidence,verified:false,
      reason:'Совпадающие фрагменты автообводки объединены без соединения видимых разрывов; проверьте чертёж'});
  }
  return {
    entities:output,
    removed,
    candidates:usable.length,
    warning:removed?'Объединено '+removed+
      ' почти совпадающих фрагментов без заполнения разрывов. Это не доказательство полной топологии.':undefined,
  };
}
