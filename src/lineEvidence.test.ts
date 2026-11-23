import {describe,it,expect} from 'vitest';
import {rankLineByInkEvidence} from './lineEvidence';
function raster(w=240,h=120){
 const rgba=new Uint8ClampedArray(w*h*4);rgba.fill(255);
 const draw=(x0:number,x1:number,y0:number,y1:number)=>{
  for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
   const i=(y*w+x)*4;rgba[i]=rgba[i+1]=rgba[i+2]=0;
  }
 };
 return {rgba,w,h,draw};
}
const line=(y:number)=>({a:{x:10,y},b:{x:230,y},confidence:.9});
describe('W3 non-destructive source-ink confidence ranking',()=>{
 it('retains high support for genuine printed straight ink',()=>{
  const im=raster();im.draw(10,230,50,52);
  const e=rankLineByInkEvidence(line(51),im.rgba,im.w,im.h);
  expect(e.support).toBe(1);expect(e.adjustedScore).toBeCloseTo(.9);
 });
 it('lowers rank for a false positive line with no ink',()=>{
  const im=raster();
  const e=rankLineByInkEvidence(line(51),im.rgba,im.w,im.h);
  expect(e.support).toBe(0);
  expect(e.adjustedScore).toBeCloseTo(.12);
 });
 it('does not misrepresent dashed lines as fully supported',()=>{
  const im=raster();
  for(let x=10;x<230;x+=40)im.draw(x,Math.min(x+16,230),50,52);
  const e=rankLineByInkEvidence(line(51),im.rgba,im.w,im.h);
  expect(e.support).toBeGreaterThan(.3);
  expect(e.support).toBeLessThan(.8);
  expect(e.adjustedScore).toBeLessThan(.9);
 });
 it('penalizes sustained white gap without deleting the raster candidate',()=>{
  const continuous=raster(),separated=raster();
  continuous.draw(10,230,50,52);
  separated.draw(10,95,50,52);separated.draw(145,230,50,52);
  const a=rankLineByInkEvidence(line(51),continuous.rgba,continuous.w,continuous.h);
  const b=rankLineByInkEvidence(line(51),separated.rgba,separated.w,separated.h);
  expect(a.blankRunRatio).toBe(0);
  expect(b.blankRunRatio).toBeGreaterThan(.15);
  expect(b.adjustedScore).toBeLessThan(.7);
  expect(b.adjustedScore).toBeLessThan(a.adjustedScore);
  expect(b.longestBlankRun).toBeGreaterThan(0);
 });
 it('detects a real 12px hole on a 1600px line that the old 80-point sample missed',()=>{
  const im=raster(1650,100);
  im.draw(10,1610,50,52);
  // Former 80 samples at x=20,40... never visited x=127..138.
  for(let x=127;x<=138;x++)for(let y=50;y<=52;y++){
    const i=(y*im.w+x)*4;
    im.rgba[i]=im.rgba[i+1]=im.rgba[i+2]=255;
  }
  const e=rankLineByInkEvidence({a:{x:10,y:51},b:{x:1610,y:51},confidence:.9},
    im.rgba,im.w,im.h);
  expect(e.samples).toBeGreaterThan(80);
  expect(e.blankRunPixels).toBeGreaterThan(8);
  expect(e.blankRunRatio).toBeLessThan(.03);
  expect(e.support).toBeLessThan(1);
 });
 it('keeps evidence in [0,1] and never auto-approves or increases votes',()=>{
  const im=raster();im.draw(10,230,50,52);
  const e=rankLineByInkEvidence({...line(51),confidence:.42},im.rgba,im.w,im.h);
  expect(e.adjustedScore).toBeCloseTo(.42);
  expect(e.support).toBe(1);
 });
 it('declines invalid coordinates or missing ink buffer',()=>{
  const im=raster();
  expect(rankLineByInkEvidence(line(51),new Uint8ClampedArray(0),im.w,im.h).samples).toBe(0);
  expect(rankLineByInkEvidence({...line(51),a:{x:NaN,y:20}},im.rgba,im.w,im.h).adjustedScore).toBe(0);
 });
});
