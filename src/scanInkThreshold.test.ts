import {describe,it,expect} from 'vitest';
import {otsuInkThreshold} from './scanInkThreshold';
const hist=(values:Array<[number,number]>)=>{
 const h=new Uint32Array(256);
 for(const [g,count] of values)h[g]=count;
 return h;
};
describe('W3 adaptive contrast threshold for pale engineering scans',()=>{
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
