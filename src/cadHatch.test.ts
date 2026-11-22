import {describe,it,expect} from 'vitest';
import {hatchStrokeSegments} from './cadHatch';
const p=(x:number,y:number)=>({x,y});
const rect=[p(0,0),p(100,0),p(100,60),p(0,60)];
describe('Browser hatch strokes clipped to CAD polygons',()=>{
  it('generates 45 degree diagonal strokes strictly inside a rectangle',()=>{
    const out=hatchStrokeSegments(rect,'diagonal',12);
    expect(out.truncated).toBe(false);
    expect(out.segments.length).toBeGreaterThan(5);
    for(const s of out.segments)for(const pt of [s.a,s.b]){
      expect(pt.x).toBeGreaterThanOrEqual(-1e-6);
      expect(pt.x).toBeLessThanOrEqual(100+1e-6);
      expect(pt.y).toBeGreaterThanOrEqual(-1e-6);
      expect(pt.y).toBeLessThanOrEqual(60+1e-6);
    }
  });
  it('cross hatch contains more geometry than single diagonal, solid is separate',()=>{
    const single=hatchStrokeSegments(rect,'diagonal',15);
    const cross=hatchStrokeSegments(rect,'cross',15);
    expect(cross.segments.length).toBeGreaterThan(single.segments.length);
    expect(hatchStrokeSegments(rect,'solid').segments).toHaveLength(0);
  });
  it('refuses an hourglass with crossed boundaries instead of using invalid fill',()=>{
    const crossed=[p(0,0),p(100,50),p(0,50),p(100,0)];
    const out=hatchStrokeSegments(crossed,'diagonal',10);
    expect(out.segments).toHaveLength(0);
    expect(out.warning).toContain('самопересечений');
  });
  it('bounds massive dense hatch and rejects invalid spacing',()=>{
    expect(hatchStrokeSegments([p(0,0),p(10000,0),p(10000,10000),p(0,10000)],
      'cross',1).truncated).toBe(true);
    expect(hatchStrokeSegments(rect,'diagonal',0).warning).toContain('Шаг');
  });
});
