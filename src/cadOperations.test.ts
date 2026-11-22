import {describe,it,expect} from 'vitest';
import {entity,type Entity,type Point} from './model';
import {intersectLines,trimLine,extendLine,offsetLine,chamferLines,filletLines} from './cadOperations';
const p=(x:number,y:number):Point=>({x,y});
function line(a:Point,b:Point):Entity {
  return entity('line',[a,b],'Контуры','manual');
}
const near=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y)<1e-6;
describe('W4 deterministic 2D editing commands',()=>{
  it('computes line crossing using finite parameters',()=>{
    const a=line(p(0,0),p(100,0)),b=line(p(50,-50),p(50,50));
    const x=intersectLines(a,b);
    expect(x?.point).toEqual(p(50,0));
    expect(x?.t).toBeCloseTo(.5);
    expect(x?.u).toBeCloseTo(.5);
    expect(intersectLines(a,line(p(0,10),p(100,10)))).toBeNull();
  });
  it('trim removes the clicked half and never changes the cutting boundary',()=>{
    const b=line(p(50,-20),p(50,20)),s=line(p(0,0),p(100,0));
    const cut=trimLine(b,s,p(10,0));
    expect(cut).not.toBeNull();
    expect(cut!.replacements[0].points).toEqual([p(50,0),p(100,0)]);
    expect(cut!.replacements[0].verified).toBe(false);
    expect(s.points).toEqual([p(0,0),p(100,0)]);
    expect(trimLine(line(p(500,-10),p(500,10)),s,p(10,0))).toBeNull();
  });
  it('extend line endpoint to boundary infinite line only',()=>{
    const cutting=line(p(80,-20),p(80,20));
    const target=line(p(0,0),p(50,0));
    const out=extendLine(cutting,target,p(45,0));
    expect(out?.replacements[0].points).toEqual([p(0,0),p(80,0)]);
    expect(extendLine(cutting,target,p(45,0),.1)).toBeNull();
    expect(extendLine(line(p(10,-10),p(10,10)),target,p(0,0))).toBeNull();
  });
  it('OFFSET adds a parallel editable line on the explicitly picked side without moving original',()=>{
    const original=line(p(0,0),p(100,0));
    original.verified=true;
    const upper=offsetLine(original,12,p(50,4));
    const lower=offsetLine(original,12,p(50,-4));
    expect(upper?.replacements).toHaveLength(0);
    expect(upper?.additions).toHaveLength(1);
    expect(upper!.additions[0].points).toEqual([p(0,12),p(100,12)]);
    expect(lower!.additions[0].points).toEqual([p(0,-12),p(100,-12)]);
    expect(upper!.additions[0].verified).toBe(false);
    expect(original.verified).toBe(true);
    expect(original.points).toEqual([p(0,0),p(100,0)]);
    const vertical=line(p(0,0),p(0,100));
    expect(offsetLine(vertical,5,p(-2,30))?.additions[0].points).toEqual([p(-5,0),p(-5,100)]);
  });
  it('OFFSET refuses ambiguous side, invalid distance and degenerate source',()=>{
    const a=line(p(0,0),p(100,0));
    expect(offsetLine(a,10,p(50,0))).toBeNull();
    expect(offsetLine(a,0,p(50,2))).toBeNull();
    expect(offsetLine(a,Number.POSITIVE_INFINITY,p(50,2))).toBeNull();
    expect(offsetLine(line(p(0,0),p(0,0)),10,p(5,1))).toBeNull();
  });
  it('chamfer clips two perpendicular rays and adds one editable line',()=>{
    const a=line(p(0,0),p(100,0));
    const b=line(p(0,0),p(0,100));
    const out=chamferLines(a,b,p(70,0),p(0,70),20);
    expect(out).not.toBeNull();
    expect(out!.replacements[0].points).toEqual([p(100,0),p(20,0)]);
    expect(out!.replacements[1].points).toEqual([p(0,100),p(0,20)]);
    expect(out!.additions[0].points).toEqual([p(20,0),p(0,20)]);
    expect(out!.additions[0].verified).toBe(false);
    expect(chamferLines(a,b,p(70,0),p(0,70),110)).toBeNull();
  });
  it('fillet of perpendicular ray produces exactly tangent circle arc with R=10',()=>{
    const a=line(p(0,0),p(100,0)),b=line(p(0,0),p(0,100));
    const out=filletLines(a,b,p(60,0),p(0,60),10);
    expect(out).not.toBeNull();
    const arc=out!.additions[0];
    expect(arc.kind).toBe('arc');
    expect(arc.radius).toBe(10);
    expect(near(arc.center!,p(10,10))).toBe(true);
    expect(out!.replacements[0].points.some(pt=>near(pt,p(10,0)))).toBe(true);
    expect(out!.replacements[1].points.some(pt=>near(pt,p(0,10)))).toBe(true);
    expect(arc.verified).toBe(false);
    expect(filletLines(a,b,p(60,0),p(0,60),200)).toBeNull();
  });
  it('rejects parallel, near-parallel and degenerate inputs without geometry mutation',()=>{
    const a=line(p(0,0),p(0,0)),b=line(p(0,2),p(20,2));
    expect(intersectLines(a,b)).toBeNull();
    expect(chamferLines(a,b,p(0,0),p(10,2),5)).toBeNull();
    expect(filletLines(a,b,p(0,0),p(10,2),5)).toBeNull();
  });
});
