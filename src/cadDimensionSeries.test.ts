import {describe,it,expect} from 'vitest';
import {entity,newProject} from './model';
import {angularDimension,dimensionsAlongPolyline} from './cadDimensionSeries';
const p=(x:number,y:number)=>({x,y});
describe('W4 angular sketch dimensions and linear series',()=>{
 it('creates truthful 90 degree angular ARC and editable TEXT from finite intersecting LINEs',()=>{
   const a=entity('line',[p(-50,0),p(50,0)]),
     b=entity('line',[p(0,-50),p(0,50)]);
   const out=angularDimension(a,b,p(30,0),p(0,30),newProject().sheets[0])!;
   expect(out).toHaveLength(2);
   expect(out[0].kind).toBe('arc');
   expect(out[0].center).toEqual(p(0,0));
   expect(out[1].text).toBe('90°');
   expect(out.every(e=>!e.verified)).toBe(true);
 });
 it('rejects parallel, nonintersecting and ambiguous center clicks',()=>{
   const a=entity('line',[p(0,0),p(20,0)]),
     b=entity('line',[p(0,5),p(20,5)]);
   const s=newProject().sheets[0];
   expect(angularDimension(a,b,p(10,0),p(10,5),s)).toBeNull();
   const c=entity('line',[p(100,-20),p(100,20)]);
   expect(angularDimension(a,c,p(10,0),p(100,10),s)).toBeNull();
   const d=entity('line',[p(10,-20),p(10,20)]);
   expect(angularDimension(a,d,p(10,0),p(10,10),s)).toBeNull();
 });
 it('creates chain and baseline from real polyline vertices in a single operation',()=>{
   const source=entity('polyline',[p(0,0),p(100,0),p(150,0)]);
   const s=newProject().sheets[0];s.calibrated=true;
   const chain=dimensionsAlongPolyline(source,s,'chain')!;
   const base=dimensionsAlongPolyline(source,s,'baseline')!;
   expect(chain.map(e=>e.text)).toEqual(['100','50']);
   expect(base.map(e=>e.text)).toEqual(['100','150']);
   expect(base[1].offset).toBeGreaterThan(base[0].offset!);
   expect(chain.every(e=>e.sourceId===source.id&&!e.verified)).toBe(true);
   s.calibrated=false;
   expect(dimensionsAlongPolyline(source,s,'chain')?.map(e=>e.text)).toEqual(['?','?']);
 });
 it('rejects unrelated entities and preserves originals',()=>{
   const s=newProject().sheets[0],line=entity('line',[p(0,0),p(100,0)]);
   expect(dimensionsAlongPolyline(line,s,'chain')).toBeNull();
   expect(line.points).toEqual([p(0,0),p(100,0)]);
 });
});
