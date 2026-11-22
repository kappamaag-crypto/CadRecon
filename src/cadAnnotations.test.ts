import {describe,it,expect} from 'vitest';
import {entity,newProject} from './model';
import {centerAxes,circleDimensionLeader,numberTechnicalRequirements,makeRequirements} from './cadAnnotations';
const p=(x:number,y:number)=>({x,y});
describe('W4 technical annotations with explicit unverified provenance',()=>{
 it('creates radius/diameter labels from true circle radius only',()=>{
   const sheet=newProject().sheets[0],circle=entity('circle',[p(100,100)]);
   circle.center=p(100,100);circle.radius=25;
   expect(circleDimensionLeader(circle,sheet,'radius')?.text).toBe('R?');
   sheet.calibrated=true;
   const diameter=circleDimensionLeader(circle,sheet,'diameter')!;
   expect(diameter.text).toBe('⌀50');
   expect(diameter.sourceId).toBe(circle.id);
   expect(diameter.kind).toBe('leader');
   expect(diameter.verified).toBe(false);
   expect(diameter.reason).toContain('НЕ ассоциативный');
 });
 it('creates 2 editable axis lines once, without stamping an existing pair',()=>{
   const c=entity('circle',[p(0,0)]);c.center=p(0,0);c.radius=40;
   const axes=centerAxes(c);
   expect(axes).toHaveLength(2);
   expect(axes.every(e=>e.kind==='axis'&&e.sourceId===c.id&&!e.verified)).toBe(true);
   expect(centerAxes(c,axes)).toHaveLength(0);
   expect(axes[0].points).toEqual([p(-52,0),p(52,0)]);
 });
 it('numbers technical requirements without duplicating existing numbering',()=>{
   expect(numberTechnicalRequirements('1. Очистить поверхность\n2) Нанести грунт\n\nКонтроль'))
     .toEqual(['1. Очистить поверхность','2. Нанести грунт','3. Контроль']);
   expect(()=>numberTechnicalRequirements('A'.repeat(10001))).toThrow();
 });
 it('places technical text individually on an editable layer',()=>{
   const sheet=newProject().sheets[0];
   const list=makeRequirements(sheet,p(20,30),'Качество\nЗащита');
   expect(list).toHaveLength(2);
   expect(list[1].points[0].y).toBeGreaterThan(30);
   expect(list.every(e=>e.kind==='text'&&!e.verified&&e.layer==='Текст')).toBe(true);
 });
});
