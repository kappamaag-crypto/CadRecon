import type {CadProject,Entity,Point,Sheet} from './model';
import {dimensionLength,mid,add,mul,sub} from './geometry';
import {eskdParts} from './eskd';
type Pair=string|number;
const emit=(...pairs:Pair[])=>pairs.map(String).join('\n')+'\n';
const v=(p:Point)=>emit(10,p.x,20,-p.y,30,0);
const p2=(code:number,p:Point)=>emit(code,p.x,code+10,-p.y,code+20,0);
const unicode=(s:string)=>[...s].map(ch=>{const c=ch.codePointAt(0)!;return c>127?'\\U+'+c.toString(16).toUpperCase().padStart(4,'0'):ch;}).join('');
const escapeText=(s:string)=>unicode(s.replace(/\r?\n/g,' '));
const clamp=(n:number)=>Number.isFinite(n)?Number(n.toFixed(6)):0;
const col=(hex:string)=>{const colors:Record<string,number>={'#4ade80':3,'#38bdf8':4,'#f9bd5a':2,'#e4ebf4':7,'#94a3b8':8,'#a78bfa':6,'#22d3ee':4,'#fb7185':1};return colors[hex.toLowerCase()]||7;};
function dxfLine(a:Point,b:Point,layer:string,lineType='') {return emit(0,'LINE',100,'AcDbEntity',8,layer,100,'AcDbLine')+(lineType?emit(6,lineType):'')+v(a)+p2(11,b);}
function dxfCircle(c:Point,r:number,layer:string) {return emit(0,'CIRCLE',100,'AcDbEntity',8,layer,100,'AcDbCircle')+v(c)+emit(40,clamp(r));}
function dxfText(p:Point,text:string,height:number,layer:string){return emit(0,'TEXT',100,'AcDbEntity',8,layer,100,'AcDbText')+v(p)+emit(40,clamp(height),1,escapeText(text||' '),7,'Standard',50,0);}
function polygon(points:Point[],layer:string,closed=true){
  if(points.length<2)return '';
  return emit(0,'LWPOLYLINE',100,'AcDbEntity',8,layer,100,'AcDbPolyline',90,points.length,70,closed?1:0)+points.map(p=>emit(10,clamp(p.x),20,clamp(-p.y))).join('');
}
function solidHatch(points:Point[],layer:string){
  if(points.length<3)return polygon(points,layer,true);
  return emit(0,'HATCH',100,'AcDbEntity',8,layer,100,'AcDbHatch',10,0,20,0,30,0,210,0,220,0,230,1,2,'SOLID',70,1,71,0,91,1,92,2,72,0,73,1,93,points.length)
  +points.map(p=>emit(10,clamp(p.x),20,clamp(-p.y))).join('')
  +emit(97,0,75,0,76,1,98,0);
}
function table(e:Entity,layer:string){
  const a=e.points[0]||{x:0,y:0};const rows=Math.max(1,e.rows||3),cols=Math.max(1,e.cols||3),w=e.width||120,h=e.height||60;let out='';
  for(let i=0;i<=rows;i++)out+=dxfLine({x:a.x,y:a.y+i*h/rows},{x:a.x+w,y:a.y+i*h/rows},layer);
  for(let i=0;i<=cols;i++)out+=dxfLine({x:a.x+i*w/cols,y:a.y},{x:a.x+i*w/cols,y:a.y+h},layer);
  if(e.text)out+=dxfText({x:a.x+3,y:a.y+h/rows*.7},e.text,Math.min(4,h/rows*.45),layer);return out;
}
function entityDxf(e:Entity){
  const layer=e.layer,pts=e.points;
  switch(e.kind){
    case 'line':case 'axis':return pts.length>=2?dxfLine(pts[0],pts[1],layer,e.kind==='axis'?'CENTER':''):'';
    case 'polyline':return polygon(pts,layer,!!e.closed);
    case 'hatch':return solidHatch(pts,layer);
    case 'circle':return e.center && e.radius?dxfCircle(e.center,e.radius,layer):'';
    case 'arc':{
      if(!e.center||!e.radius)return '';
      const a=(e.startAngle||0)*180/Math.PI,b=(e.endAngle||0)*180/Math.PI;
      return emit(0,'ARC',100,'AcDbEntity',8,layer,100,'AcDbCircle')+v(e.center)+emit(40,clamp(e.radius),100,'AcDbArc',50,clamp((360-b%360)%360),51,clamp((360-a%360)%360));
    }
    case 'text':return dxfText(pts[0],e.text||' ',e.size||4,layer);
    case 'leader':{
      if(pts.length<2)return '';
      const a=pts[0],b=pts[1],d=sub(b,a),len=Math.hypot(d.x,d.y)||1,u=mul(d,1/len),n={x:-u.y,y:u.x};
      return dxfLine(a,b,layer)+polygon([a,add(a,add(mul(u,8),mul(n,2))),add(a,add(mul(u,8),mul(n,-2)))],layer,true)+(e.text?dxfText(add(b,{x:2,y:-2}),e.text,e.size||3.5,layer):'');
    }
    case 'table':case 'stamp':return table({...e,rows:e.rows|| (e.kind==='stamp'?5:3),cols:e.cols|| (e.kind==='stamp'?4:3),width:e.width|| (e.kind==='stamp'?185:120),height:e.height|| (e.kind==='stamp'?55:60)},layer);
    default:return '';
  }
}
interface DimBlock {name:string;data:string;entity:string;}
function dimensionBlock(e:Entity,i:number):DimBlock {
  const [a,b]=e.points,layer=e.layer,name='*D'+String(i+1);
  const d=sub(b,a),len=Math.max(1e-9,Math.hypot(d.x,d.y)),n={x:-d.y/len,y:d.x/len},shift=mul(n,e.offset??20),aa=add(a,shift),bb=add(b,shift),m=mid(aa,bb),height=Math.max(2,e.size||3.5);
  const u=mul(d,1/len),arrow=5,arr=(p:Point,dir:number)=>polygon([p,add(p,add(mul(u,dir*arrow),mul(n,arrow/4))),add(p,add(mul(u,dir*arrow),mul(n,-arrow/4)))],layer,true);
  const label=e.text||Number(dimensionLength(e).toFixed(2)).toString();
  const parts=dxfLine(a,aa,layer)+dxfLine(b,bb,layer)+dxfLine(aa,bb,layer)+arr(aa,1)+arr(bb,-1)+dxfText(add(m,mul(n,-height*.7)),label,height,layer);
  const block=emit(0,'BLOCK',100,'AcDbEntity',8,layer,100,'AcDbBlockBegin',2,name,70,1,10,0,20,0,30,0,3,name,1,'')+parts+emit(0,'ENDBLK',100,'AcDbEntity',8,layer,100,'AcDbBlockEnd');
  const obj=emit(0,'DIMENSION',100,'AcDbEntity',8,layer,100,'AcDbDimension',2,name,3,'Standard',70,32,1,escapeText(e.text||''),42,clamp(dimensionLength(e)),10,clamp(m.x),20,clamp(-m.y),30,0,11,clamp(m.x),21,clamp(-m.y),31,0)+emit(100,'AcDbAlignedDimension')+p2(13,a)+p2(14,b);
  return {name,data:block,entity:obj};
}
function eskdBlock(e:Entity,i:number):DimBlock{
  const name='ESKD_'+(i+1),layer=e.layer,anchor=e.points[0];
  const parts=eskdParts(e,true).map(entityDxf).join('');
  const block=emit(0,'BLOCK',100,'AcDbEntity',8,layer,100,'AcDbBlockBegin',2,name,70,0,10,0,20,0,30,0,3,name,1,'')
    +parts+emit(0,'ENDBLK',100,'AcDbEntity',8,layer,100,'AcDbBlockEnd');
  const obj=emit(0,'INSERT',100,'AcDbEntity',8,layer,100,'AcDbBlockReference',2,name)+v(anchor);
  return {name,data:block,entity:obj};
}
export function createDxf(sheet:Sheet,project:CadProject) {
  const dims=sheet.entities.filter(e=>e.kind==='dimension'&&e.points.length>=2).map(dimensionBlock);
  const symbols=sheet.entities.filter(e=>e.kind==='eskd'&&e.points.length>=1).map(eskdBlock);
  let out=emit(0,'SECTION',2,'HEADER',9,'$ACADVER',1,'AC1015',9,'$INSUNITS',70,4,9,'$MEASUREMENT',70,1,9,'$LUNITS',70,2,9,'$LUPREC',70,4,9,'$DWGCODEPAGE',3,'ANSI_1251',0,'ENDSEC');
  out+=emit(0,'SECTION',2,'TABLES',0,'TABLE',2,'LTYPE',70,2,0,'LTYPE',2,'CONTINUOUS',70,0,3,'Solid line',72,65,73,0,40,0,0,'LTYPE',2,'CENTER',70,0,3,'Center line',72,65,73,4,40,30,49,15,74,0,49,-5,74,0,49,5,74,0,49,-5,74,0,0,'ENDTAB');
  out+=emit(0,'TABLE',2,'LAYER',70,project.layers.length+1);
  for(const l of [...project.layers,{name:'0',color:'#e4ebf4',visible:true,locked:false}])out+=emit(0,'LAYER',2,l.name,70,l.locked?4:0,62,l.visible?col(l.color):-col(l.color),6,'CONTINUOUS');
  out+=emit(0,'ENDTAB',0,'TABLE',2,'STYLE',70,1,0,'STYLE',2,'Standard',70,0,40,0,41,1,50,0,71,0,42,2.5,3,'txt',4,'',0,'ENDTAB');
  out+=emit(0,'TABLE',2,'DIMSTYLE',70,1,0,'DIMSTYLE',2,'Standard',70,0,3,'',4,'',5,'',6,'',7,'',40,1,41,2.5,42,.625,43,3.75,44,1.25,140,2.5,141,2.5,147,.625,71,0,72,0,73,0,74,0,75,0,76,0,77,1,78,8,170,0,171,3,172,1,173,0,174,0,175,0,176,0,177,0,178,0,0,'ENDTAB',0,'ENDSEC');
  out+=emit(0,'SECTION',2,'BLOCKS');
  for(const b of [...dims,...symbols])out+=b.data;
  out+=emit(0,'ENDSEC',0,'SECTION',2,'ENTITIES');
  let j=0,k=0;
  for(const e of sheet.entities) {
    if(e.kind==='dimension'){if(e.points.length>=2)out+=dims[j++].entity;}
    else if(e.kind==='eskd'){if(e.points.length)out+=symbols[k++].entity;}
    else out+=entityDxf(e);
  }
  out+=emit(0,'ENDSEC',0,'EOF');
  return out;
}