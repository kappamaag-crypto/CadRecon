import {describe,it,expect} from 'vitest';
import {entity} from './model';
import {lineFromCoordinates,orientedLineAtPoint,tangentFromPoint,pointOnCurve} from './cadConstructions';
const p=(x:number,y:number)=>({x,y});
describe('W4 analytic coordinate, parallel, perpendicular, tangent and on-curve commands',()=>{
 it('creates an exact coordinate LINE and refuses zero length/invalid values',()=>{
   const e=lineFromCoordinates(12,4,45,-9)!;
   expect(e.points).toEqual([p(12,4),p(45,-9)]);
   expect(e.verified).toBe(false);
   expect(lineFromCoordinates(0,0,0,0)).toBeNull();
   expect(lineFromCoordinates(Infinity,0,2,2)).toBeNull();
 });
 it('orients parallel/perpendicular without changing the reference LINE',()=>{
   const r=lineFromCoordinates(0,0,10,0)!;
   const parallel=orientedLineAtPoint(r,p(10,20),'parallel',5)!;
   expect(parallel.points[1]).toEqual(p(15,20));
   const perpendicular=orientedLineAtPoint(r,p(10,20),'perpendicular',5)!;
   expect(perpendicular.points[1]).toEqual(p(10,25));
   const reversed=orientedLineAtPoint(r,p(10,20),'perpendicular',5,true)!;
   expect(reversed.points[1]).toEqual(p(10,15));
   expect(r.points[0]).toEqual(p(0,0));
 });
 it('generates BOTH exact tangencies and rejects internal points',()=>{
   const c=entity('circle',[p(0,0)]);c.center=p(0,0);c.radius=10;
   for(const side of ['left','right'] as const){
     const line=tangentFromPoint(c,p(20,0),side)!;
     const endpoint=line.points[1],radius={x:endpoint.x,y:endpoint.y},
       dir={x:endpoint.x-20,y:endpoint.y};
     expect(Math.hypot(radius.x,radius.y)).toBeCloseTo(10,7);
     expect(dir.x*radius.x+dir.y*radius.y).toBeCloseTo(0,6);
     expect(line.verified).toBe(false);
   }
   expect(tangentFromPoint(c,p(9,0))).toBeNull();
 });
 it('places points on analytic circle and cubic Bezier, not their control polygon',()=>{
   const c=entity('circle',[p(0,0)]);c.center=p(0,0);c.radius=20;
   const pc=pointOnCurve(c,.25)!;
   expect(pc.points[0].x).toBeCloseTo(0,7);
   expect(pc.points[0].y).toBeCloseTo(20,7);
   const b=entity('bezier',[p(0,0),p(10,20),p(20,20),p(30,0)]);
   expect(pointOnCurve(b,.5)?.points[0]).toEqual(p(15,15));
   expect(pointOnCurve(b,1.5)).toBeNull();
 });
 it('parameterizes a polyline by physical path length',()=>{
   const poly=entity('polyline',[p(0,0),p(10,0),p(10,30)]);
   expect(pointOnCurve(poly,.5)?.points[0]).toEqual(p(10,10));
 });
});
