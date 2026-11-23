import {describe,it,expect} from 'vitest';
import {otsuInkThreshold,scanInkTone} from './scanInkThreshold';
const hist=(values:Array<[number,number]>)=>{
 const h=new Uint32Array(256);
 for(const [g,count] of values)h[g]=count;
 return h;
};
describe('W3 adaptive contrast threshold for pale engineering scans',()=>{
 it('detects standard KOMPAS-style cyan, green and blue strokes without damaging grey pencil',()=>{
  const white=scanInkTone(255,255,255);
  const cyan=scanInkTone(0,220,220),green=scanInkTone(0,250,0);
  const blue=scanInkTone(65,100,240);
  expect(white).toBe(255);
  expect(cyan).toBeLessThan(100);
  expect(green).toBeLessThan(100);
  expect(blue).toBeLessThan(115);
  expect(scanInkTone(185,185,185)).toBe(185);
  const h=hist([[cyan,400],[white,400000]]);
  expect(cyan).toBeLessThanOrEqual(otsuInkThreshold(h));
 });
 it('accepts grey 185-level ink on white 250 paper, never just black <165',()=>{
   const threshold=otsuInkThreshold(hist([[185,2400],[250,600000]]));
   expect(threshold).toBe(185);
   expect(185<=threshold).toBe(true);
   expect(250>threshold).toBe(true);
 });
 it('separates nearly black on white without converting paper into ink',()=>{
   expect(otsuInkThreshold(hist([[0,800],[255,250000]]))).toBe(40);
 });
 it('has a safe fallback for empty and uniform images',()=>{
   expect(otsuInkThreshold(new Uint32Array(256))).toBe(165);
   expect(otsuInkThreshold(hist([[255,1000]]))).toBe(165);
 });
 it('avoids promoting near-white paper texture as CAD geometry',()=>{
   expect(otsuInkThreshold(hist([[248,50],[254,500000]]))).toBeLessThanOrEqual(240);
 });
});
