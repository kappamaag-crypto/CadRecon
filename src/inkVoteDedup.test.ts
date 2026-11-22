import {describe,it,expect} from 'vitest';
import {deduplicateInkStrokeVotes,type StrokeSegment} from './inkVoteDedup';
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
  it('preserves TWO parallel strokes separated by WHITE paper',()=>{
    const m=white();m.paint(10,19,180,20);m.paint(10,26,180,27);
    const out=deduplicateInkStrokeVotes([
      line(10,20,180,20),line(10,26,180,26),
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
  it('safely ignores corrupt or absent raster evidence',()=>{
    const lines=[line(1,2,30,2),line(1,2,30,2)];
    expect(deduplicateInkStrokeVotes(lines,new Uint8ClampedArray(0),200,100)).toEqual({lines,removed:0});
  });
});