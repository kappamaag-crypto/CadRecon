import {describe,it,expect} from 'vitest';
import {recoverThinAxisStrokes} from './axisRunRecovery';
import {otsuInkThreshold,scanInkTone} from './scanInkThreshold';
const raster=(w=280,h=180)=>{
 const rgba=new Uint8ClampedArray(w*h*4);rgba.fill(255);
 const paint=(x0:number,y0:number,x1:number,y1:number,r:number,g:number,b:number)=>{
  for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
   const at=(y*w+x)*4;rgba[at]=r;rgba[at+1]=g;rgba[at+2]=b;
  }
 };
 const tone=()=>{const gray=new Uint8Array(w*h),hist=new Uint32Array(256);
   for(let i=0;i<w*h;i++){const at=i*4;gray[i]=scanInkTone(rgba[at],rgba[at+1],rgba[at+2]);hist[gray[i]]++;}
   return {gray,threshold:otsuInkThreshold(hist)};
 };
 return {paint,tone,w,h};
};
describe('W3 thin coloured KOMPAS-3D axis stroke fallback',()=>{
 it('recovers bright cyan and green native 1px lines in both directions',()=>{
  const v=raster();
  v.paint(15,40,220,40,0,220,220);
  v.paint(240,25,240,154,0,250,0);
  const {gray,threshold}=v.tone();
  const lines=recoverThinAxisStrokes(gray,v.w,v.h,threshold);
  expect(lines.some(s=>s.a.y===40&&s.b.y===40&&s.a.x<=16&&s.b.x>=218)).toBe(true);
  expect(lines.some(s=>s.a.x===240&&s.b.x===240&&s.a.y<=26&&s.b.y>=152)).toBe(true);
  expect(lines.every(s=>s.confidence<1)).toBe(true);
 });
 it('does not bridge blank gaps or pretend a thick filled bar is one-pixel CAD ink',()=>{
  const v=raster();
  v.paint(10,40,105,40,0,210,210);
  v.paint(119,40,240,40,0,210,210);
  v.paint(12,82,220,88,0,220,220);
  const {gray,threshold}=v.tone();
  const lines=recoverThinAxisStrokes(gray,v.w,v.h,threshold);
  const horizontal=lines.filter(s=>s.a.y===40&&s.b.y===40);
  expect(horizontal.length).toBe(2);
  expect(horizontal.every(s=>!(s.a.x<106&&s.b.x>118))).toBe(true);
  expect(lines.some(s=>s.a.y>=82&&s.a.y<=88&&Math.abs(s.b.x-s.a.x)>60)).toBe(false);
 });
 it('rejects malformed buffers and bound large allocations',()=>{
  expect(recoverThinAxisStrokes(new Uint8Array(),100,100,140)).toEqual([]);
  expect(recoverThinAxisStrokes(new Uint8Array(16),4,4,140)).toEqual([]);
 });
});
