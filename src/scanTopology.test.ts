import {describe,it,expect} from 'vitest';
import {entity,type Point,type Entity} from './model';
import {consolidateScanLines} from './scanTopology';
const p=(x:number,y:number):Point=>({x,y});
function line(a:Point,b:Point,origin:'trace'|'manual'|'pdf'='trace'):Entity {
  const e=entity('line',[a,b],'Автообводка',origin);
  e.confidence=.86;
  return e;
}
describe('conservative browser scan topology',()=>{
  it('combines true overlapping votes, never marks engineer approval',()=>{
    const a=line(p(0,10),p(120,10)),b=line(p(15,10.25),p(112,10.25));
    const c=line(p(80,10.15),p(200,10.15));
    const out=consolidateScanLines([a,b,c]);
    expect(out.removed).toBe(2);
    expect(out.entities).toHaveLength(1);
    expect(out.entities[0].verified).toBe(false);
    expect(out.entities[0].points[0].x).toBeCloseTo(0,1);
    expect(out.entities[0].points[1].x).toBeCloseTo(200,1);
  });
  it('keeps gaps, crossing strokes and parallel nearby contours separate',()=>{
    const parts=[
      line(p(0,10),p(100,10)),
      line(p(105,10),p(200,10)), // gap: 5 pixels of missing evidence
      line(p(0,12.5),p(200,12.5)), // parallel but different stroke
      line(p(50,-40),p(50,70)), // crossing at right angle
    ];
    const out=consolidateScanLines(parts);
    expect(out.removed).toBe(0);
    expect(out.entities).toHaveLength(4);
  });
  it('never merges different print patterns into a false solid or centerline',()=>{
    const solid=line(p(0,60),p(120,60));
    const dashed=line(p(15,60),p(110,60));dashed.lineStyle='dashed';
    const center=line(p(15,60),p(110,60));center.lineStyle='center';
    const out=consolidateScanLines([solid,dashed,center]);
    expect(out.removed).toBe(0);
    expect(out.entities.map(e=>e.lineStyle||'solid').sort()).toEqual(['center','dashed','solid']);
  });
  it('retains short dimension ticks, manual and verified entities',()=>{
    const manual=line(p(0,20),p(100,20),'manual');
    const verified=line(p(0,25),p(100,25));verified.verified=true;
    const ticks=[line(p(20,0),p(20,9)),line(p(20,0),p(20,9))];
    const out=consolidateScanLines([manual,verified,...ticks]);
    expect(out.removed).toBe(0);
    expect(out.entities).toHaveLength(4);
  });
  it('is deterministic and bounded on thousands of distinct scan lines',()=>{
    const lines=Array.from({length:1800},(_,i)=>line(p(0,i*3),p(300,i*3)));
    const a=consolidateScanLines(lines);
    const b=consolidateScanLines(lines);
    expect(a.removed).toBe(0);
    expect(a.entities).toHaveLength(1800);
    expect(a.entities.map(x=>x.id)).toEqual(b.entities.map(x=>x.id));
  });
});
