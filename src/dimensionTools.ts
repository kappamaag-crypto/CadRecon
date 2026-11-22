/** Opt-in dimension candidates for selected / all geometric CAD objects.
 * The action DOES NOT infer physical dimensions from uncalibrated scans.
 * Candidates use sourceId and remain unverified until engineer review.
 */
import {entity,type Entity,type Point,type Sheet} from './model';
import {dist} from './geometry';
export interface AutoDimensions {additions:Entity[];skipped:number;limited:boolean}
const MAX=200;
const valid=(p:Point)=>Number.isFinite(p.x)&&Number.isFinite(p.y);
export function autoDimensionCandidate(source:Entity,sheet:Sheet):Entity|null{
  if(source.kind==='line'&&source.lineStyle===undefined&&source.points.length===2&&
    source.points.every(valid)&&dist(source.points[0],source.points[1])>=5){
    const [a,b]=source.points;
    const dim=entity('dimension',[{...a},{...b}],'Авторазмеры','manual');
    const measured=dist(a,b);
    dim.offset=Math.max(8,Math.min(measured*.12,60));
    dim.size=sheet.calibrated?3.5:Math.max(9,sheet.width/180);
    dim.text=sheet.calibrated?Number(measured.toFixed(2)).toString():'?';
    dim.sourceId=source.id;dim.verified=false;dim.confidence=undefined;
    dim.reason='Размер-кандидат по двум точкам CAD-LINE. '+
      (sheet.calibrated?'Уточните соответствие геометрии оригиналу и отметку масштаба.':
       'Нет независимой калибровки: числовое значение намеренно скрыто.');
    return dim;
  }
  if(source.kind==='circle'&&source.center&&valid(source.center)&&
    Number.isFinite(source.radius)&&source.radius!>=2){
    const c=source.center,r=source.radius!;
    const k=Math.SQRT1_2,tip={x:c.x+r*k,y:c.y-r*k};
    const end={x:tip.x+Math.max(18,r*.6),y:tip.y-Math.max(18,r*.6)};
    const leader=entity('leader',[tip,end],'Авторазмеры','manual');
    leader.size=sheet.calibrated?3.5:Math.max(9,sheet.width/180);
    leader.text='⌀'+(sheet.calibrated?Number((2*r).toFixed(2)).toString():'?');
    leader.sourceId=source.id;leader.verified=false;
    leader.reason='Предложен текст диаметра с выноской (НЕ ассоциативный DIMDIAMETER). '+
      (sheet.calibrated?'Проверьте диаметр и реальный смысл окружности (отверстие не подтверждено).':
       'Без калибровки диаметр намеренно не указан.');
    return leader;
  }
  return null;
}
export function proposeAutoDimensions(
  sheet:Sheet,sources:Entity[]=sheet.entities,max=MAX
):AutoDimensions{
  const allowed=Math.min(MAX,Math.max(0,Number.isFinite(max)?Math.floor(max):MAX));
  const existing=new Set(sheet.entities
    .filter(e=>(e.kind==='dimension'||e.kind==='leader')&&e.sourceId)
    .map(e=>e.sourceId));
  const emitted=new Set<string>(),additions:Entity[]=[];
  let skipped=0,limited=false;
  for(const src of sources){
    if(existing.has(src.id)||emitted.has(src.id)){skipped++;continue;}
    const candidate=autoDimensionCandidate(src,sheet);
    if(!candidate){skipped++;continue;}
    if(additions.length>=allowed){limited=true;break;}
    additions.push(candidate);emitted.add(src.id);
  }
  return {additions,skipped,limited};
}
