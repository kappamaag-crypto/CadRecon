import {describe,it,expect} from 'vitest';
import {entity} from './model';
import {mirrorEntity,arrayEntity,stretchVertex} from './geometryTransform';
const p=(x:number,y:number)=>({x,y});
describe('W4 browser CAD transforms: MIRROR / ARRAY / vertex STRETCH',()=>{
 it('mirrors a finite line across exact user axis without touching original',()=>{
   const e=entity('line',[p(10,15),p(30,15)]);e.verified=true;
   const out=mirrorEntity(e,p(20,0),p(20,100))!;
   expect(out.additions).toHaveLength(1);
   expect(out.additions[0].points).toEqual([p(30,15),p(10,15)]);
   expect(out.additions[0].id).not.toBe(e.id);
   expect(out.additions[0].verified).toBe(false);
   expect(e.verified).toBe(true);
 });
 it('mirrors a circle keeping diameter and source untouched',()=>{
   const e=entity('circle',[p(10,30)]);e.center=p(10,30);e.radius=12;
   const out=mirrorEntity(e,p(20,0),p(20,100))!;
   expect(out.additions[0].center).toEqual(p(30,30));
   expect(out.additions[0].radius).toBe(12);
   expect(out.additions[0].verified).toBe(false);
 });
 it('builds 3-by-2 array as five independent editable CAD copies',()=>{
   const e=entity('line',[p(0,0),p(10,0)]);
   const out=arrayEntity(e,3,2,25,40)!;
   expect(out.additions).toHaveLength(5);
   expect(out.additions.at(-1)?.points).toEqual([p(50,40),p(60,40)]);
   expect(new Set(out.additions.map(x=>x.id)).size).toBe(5);
   expect(out.additions.every(x=>!x.verified&&x.origin==='manual')).toBe(true);
   expect(e.points[0]).toEqual(p(0,0));
 });
 it('rejects invalid arrays, degenerate mirror axis and non-CAD annotations',()=>{
   const e=entity('line',[p(0,0),p(10,0)]);
   expect(mirrorEntity(e,p(0,0),p(0,0))).toBeNull();
   expect(arrayEntity(e,100,100,10,10)).toBeNull();
   expect(arrayEntity(e,3,2,0,5)).toBeNull();
   const annotation=entity('dimension',[p(0,0),p(20,0)]);
   expect(mirrorEntity(annotation,p(0,0),p(0,10))).toBeNull();
 });
 it('moves a chosen polyline vertex only and never verifies it',()=>{
   const e=entity('polyline',[p(0,0),p(30,0),p(30,30)]);
   e.verified=true;
   const out=stretchVertex(e,1,p(35,5))!;
   expect(out.replacements[0].points).toEqual([p(0,0),p(35,5),p(30,30)]);
   expect(out.replacements[0].verified).toBe(false);
   expect(e.points[1]).toEqual(p(30,0));
   expect(e.verified).toBe(true);
 });
 it('rejects zero-length and self-crossing edits',()=>{
   const e=entity('polyline',[p(0,0),p(50,0),p(50,50),p(0,50)]);
   expect(stretchVertex(e,1,p(0,0))).toBeNull();
   expect(stretchVertex(e,1,p(-10,60))).toBeNull();
   expect(stretchVertex(e,15,p(10,10))).toBeNull();
 });
});
