import {describe,it,expect} from 'vitest';
import {entity} from './model';
import {rotateCadEntity,scaleCadEntity,moveCadEntity,shearCadEntity,
  polarArrayCad,alignCadLine} from './affineCad';
const p=(x:number,y:number)=>({x,y});
describe('W4 safe affine transforms, undo-ready operations',()=>{
  it('rotates LINE +90 around explicit pivot and resets verified',()=>{
    const e=entity('line',[p(0,0),p(10,0)]);e.verified=true;
    const o=rotateCadEntity(e,p(0,0),90)!;
    expect(o.replacements[0].points[1].x).toBeCloseTo(0,8);
    expect(o.replacements[0].points[1].y).toBeCloseTo(10,8);
    expect(o.replacements[0].verified).toBe(false);
    expect(e.verified).toBe(true);
  });
  it('scales circle exactly, preserving its native geometry',()=>{
    const e=entity('circle',[p(20,30)]);e.center=p(20,30);e.radius=8;
    const o=scaleCadEntity(e,p(10,20),2)!;
    expect(o.replacements[0].center).toEqual(p(30,40));
    expect(o.replacements[0].radius).toBe(16);
    expect(e.radius).toBe(8);
  });
  it('rotates an ARC and preserves angles as true geometry',()=>{
    const e=entity('arc',[p(1,0),p(0,1)]);
    e.center=p(0,0);e.radius=1;e.startAngle=0;e.endAngle=Math.PI/2;
    const rotated=rotateCadEntity(e,p(0,0),90)!.replacements[0];
    expect(rotated.startAngle).toBeCloseTo(Math.PI/2);
    expect(rotated.endAngle).toBeCloseTo(Math.PI);
  });
  it('moves closed polyline and shear rejects circle and zero coefficient',()=>{
    const e=entity('polyline',[p(0,0),p(10,0),p(10,10),p(0,10)]);
    e.closed=true;
    const moved=moveCadEntity(e,5,2)!.replacements[0];
    expect(moved.points[0]).toEqual(p(5,2));
    expect(moved.closed).toBe(true);
    const sheared=shearCadEntity(e,p(0,0),.5)!.replacements[0];
    expect(sheared.points[2]).toEqual(p(15,10));
    const circle=entity('circle',[p(0,0)]);circle.center=p(0,0);circle.radius=5;
    expect(shearCadEntity(circle,p(0,0),.5)).toBeNull();
    expect(shearCadEntity(e,p(0,0),0)).toBeNull();
  });
  it('copies one circle by even-angle array without overwriting original',()=>{
    const e=entity('line',[p(10,0),p(20,0)]);
    const out=polarArrayCad(e,p(0,0),4)!;
    expect(out.additions).toHaveLength(3);
    expect(out.additions[0].points[0].x).toBeCloseTo(0,8);
    expect(out.additions[0].points[0].y).toBeCloseTo(10,8);
    expect(out.additions.every(x=>x.id!==e.id&&x.verified===false)).toBe(true);
    expect(polarArrayCad(e,p(0,0),65)).toBeNull();
  });
  it('one-shot align preserves length without pretending a parametric solver',()=>{
    const e=entity('line',[p(4,6),p(7,10)]);
    const a=alignCadLine(e,'horizontal')!.replacements[0];
    const b=alignCadLine(e,'vertical')!.replacements[0];
    expect(a.points[1]).toEqual(p(9,6));
    expect(b.points[1]).toEqual(p(4,11));
    expect(e.points[1]).toEqual(p(7,10));
  });
  it('rejects non-finite/unbounded transforms',()=>{
    const e=entity('line',[p(0,0),p(10,0)]);
    expect(rotateCadEntity(e,p(0,0),NaN)).toBeNull();
    expect(scaleCadEntity(e,p(0,0),-1)).toBeNull();
    expect(moveCadEntity(e,Infinity,3)).toBeNull();
  });
});
