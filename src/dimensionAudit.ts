/** Conservative audit of nominal dimension-chain text.
 * This is NOT a GOST rules engine or proof of physical geometry.
 * Missing/ambiguous values are never silently replaced.
 */
import type {Entity,Sheet} from './model';

export type DimensionFinding={
  severity:'warning'|'info';
  message:string;
  id?:string;
};
function value(text?:string):number|null {
  if(!text)return null;
  const m=/^\s*(\d{1,9}(?:[.,]\d{1,4})?)\s*(?:мм)?\s*$/i.exec(text);
  if(!m)return null;
  const v=Number(m[1].replace(',','.'));
  return Number.isFinite(v)?v:null;
}
const eps=1e-6;
const projection=(e:Entity,axis:'x'|'y')=>{
  const [a,b]=e.points;
  return [Math.min(a[axis],b[axis]),Math.max(a[axis],b[axis])] as const;
};
const sameOrientation=(e:Entity,axis:'x'|'y')=>{
  if(e.points.length<2)return false;
  const [a,b]=e.points,dx=Math.abs(a.x-b.x),dy=Math.abs(a.y-b.y);
  return axis==='x'?dx>dy*8:dy>dx*8;
};
export function auditNominalChains(sheet:Sheet):DimensionFinding[] {
  const findings:DimensionFinding[]=[];
  const dimensions=sheet.entities.filter(e=>e.kind==='dimension'&&e.points.length>=2);
  const groups=new Map<string,Entity[]>();
  for(const d of dimensions){
    if(!d.chainId)continue;
    const list=groups.get(d.chainId)||[];
    list.push(d);groups.set(d.chainId,list);
  }
  for(const [id,items] of groups){
    if(items.length<2)continue;
    const ref=items[0];
    const [a,b]=ref.points;
    const axis: 'x'|'y'=Math.abs(a.x-b.x)>=Math.abs(a.y-b.y)?'x':'y';
    if(!items.every(x=>sameOrientation(x,axis))){
      findings.push({severity:'warning',id:ref.id,
        message:'Размерная цепь '+id+': смешанные направления; проверьте назначения звеньев.'});
      continue;
    }
    const spans=items.map(e=>({e,ab:projection(e,axis),v:value(e.text)}))
      .sort((x,y)=>x.ab[0]-y.ab[0]);
    const total=spans.reduce((acc,x)=>acc+(x.v??0),0);
    const missing=spans.filter(x=>x.v===null);
    if(missing.length){
      findings.push({severity:'warning',id:missing[0].e.id,
        message:'Размерная цепь '+id+': '+missing.length+
          ' размера не распознано однозначно; сумма не подтверждена.'});
      continue;
    }
    // Overlap and gaps are measured in current drawing coordinates (may be px).
    const ends=spans.map(x=>x.ab);
    const spanSize=ends[ends.length-1][1]-ends[0][0];
    const tol=Math.max(.05,spanSize*.001);
    let broken=0,overlaps=0;
    for(let j=1;j<ends.length;j++){
      const gap=ends[j][0]-ends[j-1][1];
      if(gap>tol)broken++;
      if(gap< -tol)overlaps++;
    }
    if(broken||overlaps)findings.push({
      severity:'warning',id:ref.id,
      message:'Размерная цепь '+id+': разрывы звеньев '+broken+
        ', перекрытия '+overlaps+'. Требуется сверка выносных линий.'
    });
    const min=ends[0][0],max=ends[ends.length-1][1];
    const totals=dimensions.filter(e=>e.chainId!==id&&sameOrientation(e,axis)&&
      Math.abs(projection(e,axis)[0]-min)<=tol&&
      Math.abs(projection(e,axis)[1]-max)<=tol&&value(e.text)!==null);
    if(!totals.length){
      findings.push({severity:'info',id:ref.id,
        message:'Размерная цепь '+id+': сумма номиналов '+Number(total.toFixed(4))+
          ' (по надписям), общий контрольный размер не найден.'});
      continue;
    }
    const firstTotal=totals[0],stated=value(firstTotal.text)!;
    const tolerance=Math.max(.05,Math.abs(stated)*.001);
    if(Math.abs(total-stated)>tolerance+eps){
      findings.push({severity:'warning',id:firstTotal.id,
        message:'Размерная цепь '+id+': сумма звеньев '+Number(total.toFixed(4))+
          ' не совпадает с общим номиналом '+stated+
          '. Геометрия НЕ исправлялась автоматически.'});
    }else{
      findings.push({severity:'info',id:firstTotal.id,
        message:'Размерная цепь '+id+': номиналы звеньев согласованы с общим '+
          stated+'; это не подтверждает масштаб, допуски или ЕСКД.'});
    }
  }
  return findings;
}
