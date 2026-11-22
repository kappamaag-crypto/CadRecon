import {describe,it,expect} from 'vitest';
import {clipPdfCubicToRect,pdfCubicAt,splitPdfCubic,type PdfCubic} from './pdfBezierClip';
const r={x0:20,y0:20,x1:100,y1:100};
const p=(x:number,y:number)=>({x,y});
const pointInside=(x:number,y:number)=>x>=r.x0-1e-6&&x<=r.x1+1e-6&&
  y>=r.y0-1e-6&&y<=r.y1+1e-6;
describe('W1 exact-parametric cubic Bézier clipping to PDF W rectangle',()=>{
 it('clips straight cubic as a single native editable curve with boundary endpoints',()=>{
   const line:PdfCubic=[p(-50,60),p(20,60),p(80,60),p(150,60)];
   const out=clipPdfCubicToRect(line,r);
   expect(out).toHaveLength(1);
   expect(out[0][0].x).toBeCloseTo(20,6);
   expect(out[0][3].x).toBeCloseTo(100,6);
   expect(out[0].every(x=>Math.abs(x.y-60)<1e-8)).toBe(true);
 });
 it('preserves exact de Casteljau control-geometry on a curved segment',()=>{
   const curve:PdfCubic=[p(0,0),p(0,100),p(100,100),p(100,0)];
   const [left,right]=splitPdfCubic(curve,.4);
   const original=pdfCubicAt(curve,.4);
   expect(left[3]).toEqual(right[0]);
   expect(left[3].x).toBeCloseTo(original.x,12);
   expect(left[3].y).toBeCloseTo(original.y,12);
   const clipped=clipPdfCubicToRect(curve,r);
   expect(clipped.length).toBeGreaterThan(0);
   expect(clipped.every(piece=>Array.from({length:31},(_,i)=>pdfCubicAt(piece,i/30))
     .every(x=>pointInside(x.x,x.y)))).toBe(true);
 });
 it('keeps distinct visible pieces and NEVER creates a line across blank clipping area',()=>{
   const wave:PdfCubic=[p(0,50),p(20,180),p(100,-100),p(120,50)];
   const out=clipPdfCubicToRect(wave,r);
   expect(out.length).toBeGreaterThan(0);
   expect(out.every(piece=>Array.from({length:101},(_,i)=>pdfCubicAt(piece,i/100))
     .every(x=>pointInside(x.x,x.y)))).toBe(true);
   expect(out.every(piece=>piece.length===4)).toBe(true);
 });
 it('skips fully invisible curves even if control handles extend toward the frame',()=>{
   expect(clipPdfCubicToRect([p(150,50),p(200,200),p(200,-100),p(150,50)],r)).toHaveLength(0);
 });
 it('keeps fully visible curve unchanged and never alters source points',()=>{
   const c:PdfCubic=[p(30,40),p(40,90),p(60,90),p(70,40)];
   const before=JSON.stringify(c);
   expect(clipPdfCubicToRect(c,r)).toEqual([c]);
   expect(JSON.stringify(c)).toBe(before);
 });
 it('rejects empty, corrupt and degenerate clipping rectangles',()=>{
   const c:PdfCubic=[p(10,10),p(20,20),p(30,30),p(40,40)];
   expect(clipPdfCubicToRect(c,{...r,x0:110})).toHaveLength(0);
   expect(clipPdfCubicToRect([p(NaN,0),...c.slice(1)] as PdfCubic,r)).toHaveLength(0);
 });
});
