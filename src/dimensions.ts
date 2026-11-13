import {entity,type Entity,type Point,type Sheet} from './model';
import {dist} from './geometry';

export interface Chain {id:string;orientation:'horizontal'|'vertical';dimensionIds:string[];confidence:number;sum:number|null;}
export interface Recognition {dimensions:Entity[];chains:Chain[];inspected:number;warnings:string[];}
type Orientation='horizontal'|'vertical';
interface Segment {a:Point;b:Point;orientation:Orientation;pos:number;lo:number;hi:number;len:number;source:Entity;}
type Bounds={x0:number;y0:number;x1:number;y1:number};
const numeric=/^\s*(\d{1,7}(?:[.,]\d{1,3})?)\s*(?:мм)?\s*$/i;
const parsed=(s:string)=>{const m=numeric.exec(s);return m?Number(m[1].replace(',','.')):null;};
const clamp=(x:number)=>Math.max(0,Math.min(1,x));
function sourceConfidence(e:Entity):number {
  const n=e.confidence??(e.origin==='pdf'?.97:.7);
  return clamp(n>1?n/100:n);
}
function bounds(e:Entity):Bounds {
  if(e.bbox)return e.bbox;
  const p=e.points[0]||{x:0,y:0},h=Math.max(2,e.size||8);
  return {x0:p.x,y0:p.y-h,x1:p.x+(e.text||'').length*h*.62,y1:p.y};
}
function axisLines(entities:Entity[],max=24000):Segment[]{
  const result:Segment[]=[];
  for(const e of entities){
    if(e.kind!=='line'&&e.kind!=='axis')continue;
    if(e.origin==='manual'||e.points.length!==2)continue;
    const [a,b]=e.points,dx=b.x-a.x,dy=b.y-a.y,len=dist(a,b);
    if(len<9)continue;
    const h=Math.abs(dy)/len<.045,v=Math.abs(dx)/len<.045;
    if(!h&&!v)continue;
    const orientation=h?'horizontal':'vertical';
    result.push({a,b,orientation,pos:h?(a.y+b.y)/2:(a.x+b.x)/2,
      lo:h?Math.min(a.x,b.x):Math.min(a.y,b.y),
      hi:h?Math.max(a.x,b.x):Math.max(a.y,b.y),len,source:e});
    if(result.length>=max)break;
  }
  return result;
}
function hasWitness(at:number,level:number,orientation:Orientation,segments:Segment[],tol:number):boolean{
  const wanted=orientation==='horizontal'?'vertical':'horizontal';
  return segments.some(s=>s.orientation===wanted&&Math.abs(s.pos-at)<=tol
    &&s.lo<=level+tol && s.hi>=level-tol
    && Math.min(Math.abs(s.lo-level),Math.abs(s.hi-level))<=tol*2.5);
}
function candidatesForText(label:Entity,lines:Segment[],sheet:Sheet):{line:Segment;score:number;reason:string}|null{
  const bbox=bounds(label),cx=(bbox.x0+bbox.x1)/2,cy=(bbox.y0+bbox.y1)/2;
  const h=Math.max(3,bbox.y1-bbox.y0),w=Math.max(3,bbox.x1-bbox.x0);
  let best:{line:Segment;score:number;reason:string}|null=null;
  for(const line of lines){
    const horizontal=line.orientation==='horizontal';
    if(horizontal&&line.len<Math.max(14,w*.85))continue;
    if(!horizontal&&line.len<Math.max(14,h*.85))continue;
    const middle=horizontal?cx:cy;
    if(middle<line.lo-line.len*.04||middle>line.hi+line.len*.04)continue;
    // Recognized number should sit near the dimension baseline, not far away on the drawing.
    const d=horizontal?Math.abs(line.pos-bbox.y1):Math.abs(line.pos-bbox.x1);
    const limit=horizontal?Math.max(7,h*3):Math.max(8,w*2);
    if(d>limit)continue;
    const witnessTol=Math.max(3,Math.min(10,h*.85));
    const left=hasWitness(line.lo,line.pos,line.orientation,lines,witnessTol);
    const right=hasWitness(line.hi,line.pos,line.orientation,lines,witnessTol);
    if(!left&&!right)continue; // Avoid inferring dimensions from arbitrary long geometry lines
    const centerScore=1-Math.min(1,Math.abs(middle-(line.lo+line.hi)/2)/(line.len*.58));
    const proximity=1-d/limit;
    const score=.35*centerScore+.30*proximity+.20*Number(left)+.15*Number(right);
    if(score>.30&&(!best||score>best.score)){
      best={line,score,reason:(left&&right?'Подтверждены обе выносные линии':'Обнаружена только одна выносная линия')};
    }
  }
  return best;
}
function pointsFromLine(s:Segment):[Point,Point]{
  if(s.orientation==='horizontal')return [{x:s.lo,y:s.pos},{x:s.hi,y:s.pos}];
  return [{x:s.pos,y:s.lo},{x:s.pos,y:s.hi}];
}
function groupChains(dimensions:Entity[]):Chain[] {
  const assigned=new Set<string>(),chains:Chain[]=[];
  for(const dim of dimensions){
    if(assigned.has(dim.id))continue;
    const horizontal=Math.abs(dim.points[1].x-dim.points[0].x)>=Math.abs(dim.points[1].y-dim.points[0].y);
    const orientation=horizontal?'horizontal':'vertical',level=horizontal?dim.points[0].y:dim.points[0].x;
    const tolerance=Math.max(5,(dim.size||5)*2),members=[dim];
    assigned.add(dim.id);
    let changed=true;
    while(changed){
      changed=false;
      for(const other of dimensions){
        if(assigned.has(other.id))continue;
        const sameOrientation=(Math.abs(other.points[1].x-other.points[0].x)>=Math.abs(other.points[1].y-other.points[0].y))===horizontal;
        if(!sameOrientation)continue;
        const otherLevel=horizontal?other.points[0].y:other.points[0].x;
        if(Math.abs(level-otherLevel)>tolerance)continue;
        const a=horizontal?Math.min(other.points[0].x,other.points[1].x):Math.min(other.points[0].y,other.points[1].y);
        const b=horizontal?Math.max(other.points[0].x,other.points[1].x):Math.max(other.points[0].y,other.points[1].y);
        const connected=members.some(m=>{
          const lo=horizontal?Math.min(m.points[0].x,m.points[1].x):Math.min(m.points[0].y,m.points[1].y);
          const hi=horizontal?Math.max(m.points[0].x,m.points[1].x):Math.max(m.points[0].y,m.points[1].y);
          return Math.abs(a-hi)<tolerance||Math.abs(b-lo)<tolerance;
        });
        if(connected){assigned.add(other.id);members.push(other);changed=true;}
      }
    }
    if(members.length<2)continue;
    const id='chain-'+orientation+'-'+Math.round(level)+'-'+chains.length;
    for(const m of members)m.chainId=id;
    const values=members.map(m=>parsed(m.text||''));
    chains.push({id,orientation,dimensionIds:members.map(m=>m.id),
      confidence:Math.min(...members.map(m=>m.confidence||0)),
      sum:values.every(v=>v!==null)?values.reduce<number>((s,v)=>s+(v||0),0):null});
  }
  return chains;
}
export function reconstructDimensionChains(sheet:Sheet,allEntities:Entity[]=sheet.entities):Recognition{
  const warnings:string[]=[];
  const texts=allEntities.filter(e=>e.kind==='text'&&e.origin!=='manual'&&!e.verified&&e.text&&parsed(e.text)!==null&&e.points.length);
  const lines=axisLines(allEntities);
  const dimensions:Entity[]=[];
  const used=new Set<string>();
  for(const label of texts){
    if((label.confidence??100)<35)continue;
    const fit=candidatesForText(label,lines,sheet);
    if(!fit||used.has(fit.line.source.id))continue;
    used.add(fit.line.source.id);
    const [a,b]=pointsFromLine(fit.line);
    const dim=entity('dimension',[a,b],'Авторазмеры','ocr');
    const raw=label.text!.trim();const value=parsed(raw)!;
    dim.text=raw;dim.size=Math.max(3,label.size||6);dim.offset=0;
    dim.sourceId=label.id;dim.verified=false;
    dim.reason=fit.reason+(sheet.calibrated?'':' · Требуется калибровка');
    // Do not stretch to the OCR number: this would fabricate geometry.
    const mismatch=sheet.calibrated?Math.abs(dist(a,b)-value)/Math.max(1,value):0;
    if(sheet.calibrated&&mismatch>.025)dim.reason+=' · ЧИСЛО НЕ СОВПАДАЕТ С ГЕОМЕТРИЕЙ';
    const confidence=sourceConfidence(label)*fit.score*(sheet.calibrated&&mismatch>.025?.42:1);
    dim.confidence=Math.max(.05,Math.min(.89,Number(confidence.toFixed(3))));
    dimensions.push(dim);
  }
  if(!sheet.calibrated&&dimensions.length)warnings.push('Лист не калиброван: текстовые размеры перенесены без изменения геометрии.');
  if(!lines.length)warnings.push('Нет обнаруженных горизонтальных/вертикальных отрезков; проверьте векторизацию.');
  if(texts.length>dimensions.length)warnings.push('Часть цифровых надписей нельзя связать с размерными линиями: '+(texts.length-dimensions.length));
  return {dimensions,chains:groupChains(dimensions),inspected:texts.length,warnings};
}
