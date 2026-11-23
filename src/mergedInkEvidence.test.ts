import {describe,it,expect,vi} from 'vitest';
import {entity} from './model';
import {applyRecheckedLineEvidence,remeasureMergedScanLines} from './mergedInkEvidence';
import type {Evidence} from './lineEvidence';
const evidence=(support:number,blankRunRatio:number,adjustedScore:number):Evidence=>
 ({support,blankRunRatio,adjustedScore,samples:200,longestBlankRun:10,blankRunPixels:8});
const line=()=>{
 const e=entity('line',[{x:0,y:20},{x:150,y:20}],'Автообводка','trace');
 e.confidence=.7;
 e.reason='Пиксельная опора итогового отрезка не пересчитана';
 return e;
};
describe('W3 source re-measure after line consolidation',()=>{
 it('measures the entire NEW length and keeps unverified status',()=>{
   const e=line(),out=applyRecheckedLineEvidence(e,evidence(.9,.08,.65),200);
   expect(out.scanEvidence?.blankRunPixels).toBeCloseTo(16);
   expect(out.scanEvidence?.inkSupport).toBe(.9);
   expect(out.scanEvidence?.blankRunRatio).toBe(.08);
   expect(out.reason).toContain('исходный штрих');
   expect(out.verified).toBe(false);
   expect(out.points).toEqual(e.points);
   expect(e.scanEvidence).toBeUndefined();
 });
 it('can downgrade but never increase original conservative confidence',()=>{
   const e=line(),out=applyRecheckedLineEvidence(e,evidence(1,0,.94),150);
   expect(out.confidence).toBe(.7);
   const reduced=applyRecheckedLineEvidence(e,evidence(.2,.5,.15),150);
   expect(reduced.confidence).toBe(.15);
 });
 it('resamples merged evidence from one bounded opaque raster strip',async()=>{
   const previous=globalThis.document;
   const canvas={width:0,height:0,getContext:()=>context};
   const context={setTransform:vi.fn(),fillStyle:'',fillRect:vi.fn(),
     translate:vi.fn(),scale:vi.fn(),rotate:vi.fn(),drawImage:vi.fn(),
     getImageData:vi.fn(()=>{
       const rgba=new Uint8ClampedArray(canvas.width*canvas.height*4);
       rgba.fill(255);
       for(let x=0;x<canvas.width;x++){
         if(x>=35&&x<=42)continue;
         const i=(4*canvas.width+x)*4;rgba[i]=rgba[i+1]=rgba[i+2]=0;
       }
       return {data:rgba};
     })};
   Object.defineProperty(globalThis,'document',{configurable:true,
     value:{createElement:()=>canvas}});
   try{
     const e=line();e.points=[{x:0,y:20},{x:200,y:20}];
     const res=await remeasureMergedScanLines([e],{} as HTMLImageElement,
       {width:200,height:120},200,120);
     expect(res.reviewed).toBe(1);
     expect(res.skipped).toBe(0);
     expect(res.entities[0].scanEvidence?.inkSupport).toBeLessThan(1);
     expect(res.entities[0].scanEvidence?.blankRunPixels).toBeGreaterThan(8);
     expect(res.entities[0].verified).toBe(false);
     expect(res.entities[0].confidence).toBeLessThanOrEqual(.7);
     expect(res.entities[0].reason).toContain('исходный штрих');
     expect(canvas.width).toBe(0); // bounded raster is released
     expect(context.drawImage).toHaveBeenCalledTimes(1);
     expect(context.fillRect).toHaveBeenCalledWith(0,0,100,9);
     expect(e.scanEvidence).toBeUndefined();
   }finally{
     Object.defineProperty(globalThis,'document',{configurable:true,value:previous});
   }
 });
 it('keeps unknown evidence and warns when resample limit is reached',async()=>{
   const prev=globalThis.document;
   Object.defineProperty(globalThis,'document',{configurable:true,
     value:{createElement:()=>({getContext:()=>({})})}});
   try{
     const e=line();
     const out=await remeasureMergedScanLines([e],{} as HTMLImageElement,
       {width:200,height:120},200,120,undefined,undefined,0);
     expect(out.reviewed).toBe(0);
     expect(out.skipped).toBe(1);
     expect(out.entities[0]).toBe(e);
     expect(out.warning).toContain('неизмеренной');
   }finally{Object.defineProperty(globalThis,'document',{configurable:true,value:prev});}
 });
 it('never modifies manually approved geometry, OCR or empty evidence',()=>{
   const approved=line();approved.verified=true;
   expect(applyRecheckedLineEvidence(approved,evidence(.8,.2,.3),100)).toBe(approved);
   const manual=line();manual.origin='manual';
   expect(applyRecheckedLineEvidence(manual,evidence(.8,.2,.3),100)).toBe(manual);
   expect(applyRecheckedLineEvidence(line(),{...evidence(.8,.2,.3),samples:0},100).scanEvidence).toBeUndefined();
 });
});
