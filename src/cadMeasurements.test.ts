import {describe,it,expect} from 'vitest';
import {entity} from './model';
import {angleBetweenCadLines,inspectCadTopology,measureCadEntity} from './cadMeasurements';
const p=(x:number,y:number)=>({x,y});
const line=(a:{x:number;y:number},b:{x:number;y:number})=>entity('line',[a,b]);
describe('W4 read-only measurements and topological diagnostics',()=>{
 it('calculates perimeter and area of closed rectangle accurately',()=>{
   const e=entity('polyline',[p(0,0),p(30,0),p(30,20),p(0,20)]);
   e.closed=true;
   const out=measureCadEntity(e)!;
   expect(out.perimeter).toBe(100);
   expect(out.area).toBe(600);
   expect(out.closed).toBe(true);
 });
 it('refuses to call an open polyline area',()=>{
   const e=entity('polyline',[p(0,0),p(30,0),p(30,20)]);
   expect(measureCadEntity(e)?.area).toBeUndefined();
 });
 it('calculates circle and ellipse without pretending their perimeter is exact',()=>{
   const c=entity('circle',[p(0,0)]);c.center=p(0,0);c.radius=10;
   const e=entity('ellipse',[p(0,0),p(20,0)]);
   e.center=p(0,0);e.radius=20;e.axisRatio=.5;
   expect(measureCadEntity(c)?.area).toBeCloseTo(Math.PI*100);
   expect(measureCadEntity(e)?.area).toBeCloseTo(Math.PI*200);
   expect(measureCadEntity(e)?.note).toContain('приблизительная');
 });
 it('measures oriented angle between finite lines',()=>{
   expect(angleBetweenCadLines(line(p(0,0),p(10,0)),line(p(0,0),p(0,10)))).toBeCloseTo(90);
   expect(angleBetweenCadLines(line(p(0,0),p(10,0)),line(p(10,0),p(0,0)))).toBeCloseTo(180);
 });
 it('finds exact duplicates, disconnected endpoints and conservative near-gaps',()=>{
   const a=line(p(0,0),p(40,0)),b=line(p(42,0),p(70,0));
   const dup=line(p(40,0),p(0,0));
   const report=inspectCadTopology([a,b,dup]);
   expect(report.duplicates).toBe(1);
   expect(report.openEnds).toBeGreaterThan(0);
   expect(report.nearGaps).toBeGreaterThan(0);
   expect(a.points[1]).toEqual(p(40,0));
 });
 it('does not join a truly closed four-line chain',()=>{
   const items=[line(p(0,0),p(10,0)),line(p(10,0),p(10,10)),
     line(p(10,10),p(0,10)),line(p(0,10),p(0,0))];
   const result=inspectCadTopology(items);
   expect(result.openEnds).toBe(0);
   expect(result.nearGaps).toBe(0);
 });
 it('bounds scan and detects malformed tolerance',()=>{
   expect(()=>inspectCadTopology([],Infinity)).toThrow();
   const large=Array.from({length:1000},(_,i)=>line(p(i*20,0),p(i*20+10,0)));
   const report=inspectCadTopology(large);
   expect(report.checked).toBe(800);
   expect(report.truncated).toBe(true);
 });
});
