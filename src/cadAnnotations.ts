/** W4 editable CAD annotations, not a GOST sign-certification engine.
 * All inserted positions/dimensions require engineering review.
 */
import {entity,type Entity,type Sheet,type Point} from './model';
const valid=(p:Point)=>Number.isFinite(p.x)&&Number.isFinite(p.y);
export function circleDimensionLeader(
  source:Entity,sheet:Sheet,mode:'radius'|'diameter'
):Entity|null{
  if(source.kind!=='circle'||!source.center||!valid(source.center)||!source.radius||
    !Number.isFinite(source.radius)||source.radius<1e-6)return null;
  const c=source.center,r=source.radius;
  const tip={x:c.x+r*Math.SQRT1_2,y:c.y-r*Math.SQRT1_2};
  const outside=Math.max(12,Math.min(55,r*.55));
  const end={x:tip.x+outside,y:tip.y-outside};
  const e=entity('leader',[tip,end],'Размеры');
  e.text=(mode==='radius'?'R':'⌀')+
    (sheet.calibrated?Number((r*(mode==='radius'?1:2)).toFixed(3)).toString():'?');
  e.size=sheet.calibrated?3.5:Math.max(9,sheet.width/180);
  e.sourceId=source.id;
  e.reason=(mode==='radius'?'Радиальная':'Диаметральная')+
    ' редактируемая выноска — НЕ ассоциативный CAD DIMRADIUS/DIMDIAMETER. '+
    (sheet.calibrated?'Сверьте радиус/диаметр с чертежом.':'Масштаб не калиброван; значение намеренно скрыто.');
  return e;
}
export function centerAxes(source:Entity,existing:Entity[]=[]):Entity[] {
  if(source.kind!=='circle'||!source.center||!valid(source.center)||!source.radius||
    !Number.isFinite(source.radius)||source.radius<1e-6||
    existing.some(e=>e.kind==='axis'&&e.sourceId===source.id))return [];
  const c=source.center,span=source.radius*1.3;
  const h=entity('axis',[{x:c.x-span,y:c.y},{x:c.x+span,y:c.y}],'Оси');
  const v=entity('axis',[{x:c.x,y:c.y-span},{x:c.x,y:c.y+span}],'Оси');
  for(const e of [h,v]){
    e.sourceId=source.id;e.reason='Центральные оси окружности, добавлены вручную; проверьте назначение элемента';
  }
  return [h,v];
}
/** Plain text ESKD technical requirements with conservative numbering. */
export function numberTechnicalRequirements(input:string):string[]{
  if(input.length>10000)throw new Error('Технические требования: текст слишком длинный');
  const lines=input.replace(/\r\n?/g,'\n').split('\n').map(v=>v.trim()).filter(Boolean);
  if(lines.length>60||lines.some(v=>v.length>160))
    throw new Error('Технические требования: максимум 60 пунктов по 160 символов');
  return lines.map((line,i)=>String(i+1)+'. '+line.replace(/^\d{1,3}[.)]\s*/,''));
}
export function makeRequirements(
  sheet:Sheet,anchor:Point,input:string
):Entity[]{
  if(!valid(anchor))throw new Error('Технические требования: неверное положение');
  const lines=numberTechnicalRequirements(input),size=sheet.calibrated?3.5:Math.max(9,sheet.width/180);
  return lines.map((t,i)=>{
    const e=entity('text',[{x:anchor.x,y:anchor.y+i*size*1.8}],'Текст');
    e.text=t;e.size=size;
    e.reason='Технические требования с нумерацией: нужна ручная проверка ГОСТ, содержания и расположения';
    return e;
  });
}
