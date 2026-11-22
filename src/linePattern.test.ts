import {describe,it,expect} from 'vitest';
import {classifyLinePattern} from './linePattern';
const w=420,h=180;
function raster(){const data=new Uint8ClampedArray(w*h*4);data.fill(255);
 const bar=(x0:number,x1:number,y0:number,y1:number)=>{
   for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
     const i=(y*w+x)*4;data[i]=data[i+1]=data[i+2]=0;
   }
 };
 return {data,bar};
}
const hline=(x:number,y:number,xx:number)=>({a:{x,y},b:{x:xx,y},confidence:.65});
describe('W3 repeated line pattern candidates (pixel-only, unverified)',()=>{
 it('identifies a regularly interrupted dashed scan as one editable styled candidate',()=>{
   const r=raster();
   for(let x=15;x<360;x+=32)r.bar(x,x+19,60,61);
   const found=classifyLinePattern(hline(15,60,354),r.data,w,h);
   expect(found?.style).toBe('dashed');
   expect(found!.marks).toBeGreaterThanOrEqual(8);
 });
 it('recognizes long–dot–long–dot–long centre pattern separately from normal dash',()=>{
   const r=raster();let x=16;
   for(const len of [35,4,35,4,35,4,35]){
     r.bar(x,x+len-1,90,91);x+=len+8;
   }
   const found=classifyLinePattern(hline(16,90,x-9),r.data,w,h);
   expect(found?.style).toBe('center');
 });
 it('preserves solid outlines and one broken line as not classifiable',()=>{
   const r=raster();r.bar(15,360,60,62);
   expect(classifyLinePattern(hline(15,61,360),r.data,w,h)).toBeNull();
   const split=raster();split.bar(15,150,60,62);split.bar(175,360,60,62);
   expect(classifyLinePattern(hline(15,61,360),split.data,w,h)).toBeNull();
 });
 it('does not confuse unrelated nearby parallel solid with dashed axis',()=>{
   const r=raster();r.bar(15,360,50,51);
   for(let x=15;x<360;x+=30)r.bar(x,x+15,70,71);
   expect(classifyLinePattern(hline(15,50,360),r.data,w,h)).toBeNull();
   expect(classifyLinePattern(hline(15,70,360),r.data,w,h)?.style).toBe('dashed');
 });
 it('declines invalid data, overlong geometry and random marks',()=>{
   const r=raster();r.bar(10,12,70,71);r.bar(150,153,70,71);r.bar(300,303,70,71);
   expect(classifyLinePattern(hline(10,70,303),r.data,w,h)).toBeNull();
   expect(classifyLinePattern(hline(NaN,30,200),r.data,w,h)).toBeNull();
   expect(classifyLinePattern(hline(0,60,350),new Uint8ClampedArray(0),w,h)).toBeNull();
 });
});
