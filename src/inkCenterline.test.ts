import {describe,it,expect} from 'vitest';
import {refineStrokeCenterline,refineStrokeCenters} from './inkCenterline';
import type {StrokeSegment} from './inkVoteDedup';
const line=(x0:number,y0:number,x1:number,y1:number):StrokeSegment=>({
  a:{x:x0,y:y0},b:{x:x1,y:y1},confidence:.8,
});
function raster(width=210,height=120) {
 const rgba=new Uint8ClampedArray(width*height*4);rgba.fill(255);
 return {rgba,width,height,paint:(x0:number,y0:number,x1:number,y1:number)=>{
  for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
    const k=(y*width+x)*4;rgba[k]=rgba[k+1]=rgba[k+2]=0;
  }
 }};
}
describe('W3 pixel-backed centerline refinement',()=>{
 it('centers both edge hypotheses on the SAME 5px thick print stroke',()=>{
  const im=raster();im.paint(10,38,180,42);
  const top=line(12,38,178,38),bottom=line(12,42,178,42);
  const before=[top,bottom].map(x=>JSON.stringify(x));
  const result=refineStrokeCenters([top,bottom],im.rgba,im.width,im.height);
  expect(result.adjusted).toBe(2);
  for(const e of result.lines){expect(e.a.y).toBeCloseTo(40,4);expect(e.b.y).toBeCloseTo(40,4);}
  expect(JSON.stringify(top)).toBe(before[0]);
  expect(JSON.stringify(bottom)).toBe(before[1]);
 });
 it('preserves two distinct parallel strokes separated by white paper',()=>{
  const im=raster();im.paint(10,19,180,20);im.paint(10,24,180,25);
  const a=refineStrokeCenterline(line(12,20,178,20),im.rgba,im.width,im.height);
  const b=refineStrokeCenterline(line(12,24,178,24),im.rgba,im.width,im.height);
  expect(Math.abs(a.a.y-b.a.y)).toBeGreaterThanOrEqual(3);
  expect(a.confidence).toBe(.8);expect(b.confidence).toBe(.8);
 });
 it('refuses to snap a hypothetical white-gap line into adjacent ink',()=>{
  const im=raster();im.paint(10,19,180,20);im.paint(10,24,180,25);
  const suspect=line(12,22,178,22);
  expect(refineStrokeCenterline(suspect,im.rgba,im.width,im.height)).toBe(suspect);
 });
 it('does not fabricate a line through wide black blobs or text-like strokes',()=>{
  const im=raster();im.paint(10,30,180,48);
  const proposed=line(12,35,178,35);
  expect(refineStrokeCenterline(proposed,im.rgba,im.width,im.height)).toBe(proposed);
 });
 it('refuses very short, corrupt, out-of-bounds and unavailable raster evidence',()=>{
  const im=raster(),bad=line(10,40,15,40),empty=line(10,40,178,40);
  expect(refineStrokeCenterline(bad,im.rgba,im.width,im.height)).toBe(bad);
  expect(refineStrokeCenterline(empty,im.rgba,im.width,im.height)).toBe(empty);
  const broken=line(NaN,0,20,40);
  expect(refineStrokeCenterline(broken,im.rgba,im.width,im.height)).toBe(broken);
  expect(refineStrokeCenterline(line(0,0,40,0),new Uint8ClampedArray(0),210,120).a).toEqual({x:0,y:0});
 });
 it('handles crossing strokes by using robust internal median',()=>{
  const im=raster();im.paint(10,39,180,43);im.paint(88,10,92,110);
  const out=refineStrokeCenterline(line(12,39,178,39),im.rgba,im.width,im.height);
  expect(out.a.y).toBeCloseTo(41,1);
  expect(out.b.y).toBeCloseTo(41,1);
 });
});
