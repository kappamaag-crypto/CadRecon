import {describe,it,expect} from 'vitest';
import {deduplicateInkStrokeVotes,sameFiniteLine,type StrokeSegment} from './inkVoteDedup';
const line=(x0:number,y0:number,x1:number,y1:number):StrokeSegment=>
 ({a:{x:x0,y:y0},b:{x:x1,y:y1},confidence:.8});
function white(width=200,height=100){
  const rgba=new Uint8ClampedArray(width*height*4);
  rgba.fill(255);
  return {rgba,width,height,paint:(x0:number,y0:number,x1:number,y1:number)=>{
    for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
      const i=(y*width+x)*4;rgba[i]=rgba[i+1]=rgba[i+2]=0;
    }
  }};
}
describe('W3 pixel-evidence Hough vote consolidation',()=>{
  it('removes opposite boundaries of the same 5px printed stroke',()=>{
    const m=white();m.paint(10,38,180,42);
    const out=deduplicateInkStrokeVotes([
      line(10,38,180,38),line(11,42,178,42),line(12,40,175,40),
    ],m.rgba,m.width,m.height);
    expect(out.removed).toBe(2);
    expect(out.lines).toHaveLength(1);
    expect(out.lines[0].confidence).toBe(.8);
  });
  it('never discards a dashed or centre line because an unstyled line overlaps',()=>{
    const m=white();m.paint(10,40,180,42);
    const solid=line(10,41,180,41);
    const dashed={...solid,lineStyle:'dashed' as const,confidence:.72};
    const center={...solid,lineStyle:'center' as const,confidence:.68};
    const result=deduplicateInkStrokeVotes([solid,dashed,center],m.rgba,m.width,m.height);
    expect(result.removed).toBe(0);
    expect(new Set(result.lines.map(x=>x.lineStyle||'solid')).size).toBe(3);
  });
  it('preserves TWO parallel strokes separated by WHITE paper',()=>{
    const m=white();m.paint(10,19,180,20);m.paint(10,24,180,25);
    // Gap 3px, separation 4px: inside deduplicator's 5.25px search
    // radius, so ONLY the underlying white ink evidence may reject a merge.
    const out=deduplicateInkStrokeVotes([
      line(10,20,180,20),line(10,24,180,24),
    ],m.rgba,m.width,m.height);
    expect(out.removed).toBe(0);
  });
  it('does not merge disjoint dashes, radial crossings or different directions',()=>{
    const m=white();m.paint(10,40,80,42);m.paint(92,40,180,42);
    const out=deduplicateInkStrokeVotes([
      line(10,40,80,40),line(92,40,180,40),line(60,5,60,95),
    ],m.rgba,m.width,m.height);
    expect(out.removed).toBe(0);
  });
  it('does not fuse long true straight with a shorter tangent beside it across white',()=>{
    const m=white();m.paint(10,40,180,42);
    const out=deduplicateInkStrokeVotes([
      line(10,40,180,40),line(50,45,120,45),
    ],m.rgba,m.width,m.height);
    expect(out.removed).toBe(0);
  });
  it('keeps disjoint diagonals even when x-start/y-end and slope match',()=>{
    const a=line(0,0,50,50),b=line(0,40,10,50);
    // Previously these wrongly collided in Hough's two-coordinate heuristic.
    expect(sameFiniteLine(a,b)).toBe(false);
    expect(sameFiniteLine(a,line(50,50,0,0))).toBe(true);
  });
  it('safely ignores corrupt or absent raster evidence',()=>{
    const lines=[line(1,2,30,2),line(1,2,30,2)];
    expect(deduplicateInkStrokeVotes(lines,new Uint8ClampedArray(0),200,100)).toEqual({lines,removed:0});
  });
});