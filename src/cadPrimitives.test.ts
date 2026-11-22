import {describe,it,expect} from 'vitest';
import {newProject,validateProject} from './model';
import {circleByThreePoints,regularPolygon,ellipseFromAxes,constructionLine,
  visibleConstructionLine,angleBisector} from './cadPrimitives';
const p=(x:number,y:number)=>({x,y});
describe('W4 exact browser 2D primitives',()=>{
  it('reconstructs a 3-point circle without arbitrary ellipse fitting',()=>{
    const e=circleByThreePoints(p(10,0),p(0,10),p(-10,0))!;
    expect(e.kind).toBe('circle');expect(e.center?.x).toBeCloseTo(0,8);
    expect(e.center?.y).toBeCloseTo(0,8);expect(e.radius).toBeCloseTo(10,8);
    expect(e.verified).toBe(false);
    expect(circleByThreePoints(p(0,0),p(10,10),p(20,20))).toBeNull();
  });
  it('makes inscribed and circumscribed polygons distinguishable',()=>{
    const ins=regularPolygon(p(0,0),p(10,0),4,'inscribed')!;
    const out=regularPolygon(p(0,0),p(10,0),4,'circumscribed')!;
    expect(ins.points).toHaveLength(4);expect(ins.closed).toBe(true);
    expect(ins.points[0]).toEqual(p(10,0));
    expect(Math.hypot(out.points[0].x,out.points[0].y)).toBeCloseTo(10*Math.SQRT2,6);
    expect(regularPolygon(p(0,0),p(10,0),129)).toBeNull();
    expect(regularPolygon(p(0,0),p(0,0),6)).toBeNull();
  });
  it('creates an exact DXF-compatible ellipse with oriented major vector',()=>{
    const e=ellipseFromAxes(p(50,40),p(80,40),p(50,55))!;
    expect(e.kind).toBe('ellipse');expect(e.radius).toBe(30);
    expect(e.axisRatio).toBeCloseTo(.5);
    expect(e.points).toHaveLength(2);
    const project=newProject();project.sheets[0].entities=[e];
    expect(validateProject(project).sheets[0].entities[0].verified).toBe(false);
    expect(ellipseFromAxes(p(0,0),p(10,0),p(20,0))).toBeNull();
    expect(ellipseFromAxes(p(0,0),p(10,0),p(0,15))).toBeNull();
  });
  it('defines an infinite construction line, clipped to current sheet on screen',()=>{
    const e=constructionLine(p(0,40),p(30,40))!;
    expect(e.kind).toBe('construction');
    expect(visibleConstructionLine(e.points[0],e.points[1],100,80)).toEqual([p(0,40),p(100,40)]);
    expect(visibleConstructionLine(p(50,-100),p(50,300),100,80)).toEqual([p(50,0),p(50,80)]);
    expect(visibleConstructionLine(p(-100,-100),p(-90,-90),100,80)).toEqual([p(0,0),p(80,80)]);
    expect(constructionLine(p(0,0),p(0,0))).toBeNull();
    expect(visibleConstructionLine(p(-5,-5),p(-1,-5),100,80)).toBeNull();
  });
  it('constructs an angle bisector exactly from 3 points',()=>{
    const e=angleBisector(p(0,0),p(10,0),p(0,10))!;
    const d={x:e.points[1].x-e.points[0].x,y:e.points[1].y-e.points[0].y};
    expect(d.x).toBeCloseTo(Math.SQRT1_2,6);
    expect(d.y).toBeCloseTo(Math.SQRT1_2,6);
    expect(angleBisector(p(0,0),p(10,0),p(-10,0))).toBeNull();
  });
});
