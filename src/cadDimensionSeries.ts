/** Non-associative W4 angular and chain dimension proposals. The algebra is
 * exact for finite straight LINEs; no constraint solver is implied.
 */
import {entity,type Entity,type Point,type Sheet} from './model';
const EPS=1e-7;
const cross=(a:Point,b:Point)=>a.x*b.y-a.y*b.x;
const sub=(a:Point,b:Point):Point=>({x:a.x-b.x,y:a.y-b.y});
const add=(a:Point,b:Point):Point=>({x:a.x+b.x,y:a.y+b.y});
const len=(p:Point)=>Math.hypot(p.x,p.y);
const scale=(p:Point,k:number):Point=>({x:p.x*k,y:p.y*k});
const valid=(p:Point)=>Number.isFinite(p.x)&&Number.isFinite(p.y);
const zero=(n:number)=>Number.isFinite(n)&&Math.abs(n)<EPS;
/** Two selectable segments must intersect in their finite extents.
 * Angular annotation uses a native CAD ARC plus editable TEXT, *not* DIMANGULAR.
 */
export function angularDimension(
  first:Entity,second:Entity,pickFirst:Point,pickSecond:Point,sheet:Sheet
):Entity[]|null{
  if(first.kind!=='line'||second.kind!=='line'||first.id===second.id||
    first.points.length!==2||second.points.length!==2||
    ![...first.points,...second.points,pickFirst,pickSecond].every(valid))return null;
  const [a,b]=first.points,[c,d]=second.points,
    u=sub(b,a),v=sub(d,c),denom=cross(u,v);
  if(len(u)<EPS||len(v)<EPS||zero(denom))return null;
  const t=cross(sub(c,a),v)/denom,s=cross(sub(c,a),u)/denom;
  if(t< -1e-6||t>1+1e-6||s< -1e-6||s>1+1e-6)return null;
  const at=add(a,scale(u,t)),firstClick=sub(pickFirst,at),
    secondClick=sub(pickSecond,at);
  const signA=Math.sign(firstClick.x*u.x+firstClick.y*u.y),
    signB=Math.sign(secondClick.x*v.x+secondClick.y*v.y);
  if(!signA||!signB)return null;
  const rayA=scale(u,signA/len(u)),rayB=scale(v,signB/len(v));
  const cosine=Math.max(-1,Math.min(1,rayA.x*rayB.x+rayA.y*rayB.y));
  const radians=Math.acos(cosine);
  if(radians<1e-4||radians>Math.PI-1e-4)return null;
  const availableA=signA>0?len(sub(b,at)):len(sub(a,at));
  const availableB=signB>0?len(sub(d,at)):len(sub(c,at));
  const radius=Math.min(40,Math.min(availableA,availableB)*.48);
  if(radius<2||!Number.isFinite(radius))return null;
  const wrap=(n:number)=>(n%(Math.PI*2)+Math.PI*2)%(Math.PI*2);
  let start=Math.atan2(rayA.y,rayA.x),
    end=Math.atan2(rayB.y,rayB.x);
  if(wrap(end-start)>Math.PI){[start,end]=[end,start];}
  end=start+radians;
  const firstPoint={x:at.x+radius*Math.cos(start),y:at.y+radius*Math.sin(start)},
    lastPoint={x:at.x+radius*Math.cos(end),y:at.y+radius*Math.sin(end)};
  const arc=entity('arc',[firstPoint,lastPoint],'Размеры','manual');
  arc.center=at;arc.radius=radius;arc.startAngle=start;arc.endAngle=end;
  arc.reason='Угловой размер: вспомогательная ARC, не ассоциативная DIMANGULAR; проверить угол';
  const text=entity('text',[{x:at.x+(radius+6)*Math.cos((start+end)/2),
    y:at.y+(radius+6)*Math.sin((start+end)/2)}],'Размеры','manual');
  text.text=Number((radians*180/Math.PI).toFixed(3)).toString()+'°';
  text.size=sheet.calibrated?3.5:Math.max(8,sheet.width/180);
  text.reason='Угол между выбранными лучами без привязки к параметрическому решателю; сверить направление';
  return [arc,text];
}
export function dimensionsAlongPolyline(
  source:Entity,sheet:Sheet,mode:'chain'|'baseline'
):Entity[]|null{
  if(source.kind!=='polyline'||source.points.length<3||source.points.length>40||
    source.points.some(p=>!valid(p)))return null;
  const entries:Entity[]=[];
  for(let i=1;i<source.points.length;i++){
    const a=source.points[mode==='chain'?i-1:0],b=source.points[i],
      length=Math.hypot(a.x-b.x,a.y-b.y);
    if(length<EPS)continue;
    const e=entity('dimension',[{...a},{...b}],'Размеры','manual');
    e.sourceId=source.id;e.chainId=source.id+'_'+mode;
    e.offset=Math.max(10,Math.min(length*.12,40))+(mode==='baseline'?i*11:0);
    e.size=sheet.calibrated?3.5:Math.max(9,sheet.width/180);
    e.text=sheet.calibrated?Number(length.toFixed(3)).toString():'?';
    e.reason=(mode==='chain'?'Цепная':'От общей базы')+
      ' серия по узлам выбранной полилинии; НЕ ассоциативная, проверить пересечения выносных линий и геометрию';
    entries.push(e);
  }
  return entries.length?entries:null;
}
