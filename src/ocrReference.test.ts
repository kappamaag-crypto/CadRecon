import {describe,it,expect} from 'vitest';
import {compareOcrReference,parseOcrReference} from './ocrReference';
const b=(id:string,text:string,x0:number,y0=10)=>({id,text,x0,y0,x1:x0+60,y1:y0+18});
const p=(text:string,x0:number,y0=10)=>({text,x0,y0,x1:x0+60,y1:y0+18});
const ref=(scope:'partial'|'complete',other:Record<string,unknown>={})=>({
  version:1,reviewed:true,scope,imageWidth:1024,imageHeight:724,
  ...(scope==='complete'?{region:{x0:10,y0:5,x1:400,y1:110}}:{}),
  labels:[b('diameter','Ø25,4',20),b('roughness','Ra 0,8',120)],...other,
});
describe('OCR independently reviewed region and partial annotation safety',()=>{
 it('does not give a fake precision score when only some text is labelled',()=>{
   const reference=parseOcrReference(ref('partial'),1024,724);
   const out=compareOcrReference(reference,[
     p('Ø25,4',20),p('Ra 0,8',120),p('UNLABELED title block',700,600)]);
   expect(out.scope).toBe('partial');
   expect(out.metrics.matched).toBe(2);
   expect(out.metrics.cer).toBe(0);
   expect(out.measuredPrecision).toBeNull();
   expect(out.measuredFalsePositives).toBeNull();
 });
 it('detects a wrong engineering dimension without changing a letter to digit',()=>{
   const reference=parseOcrReference(ref('partial'),1024,724);
   const out=compareOcrReference(reference,[p('Ø2S,4',20),p('Ra O,8',120)]);
   expect(out.metrics.criticalExact).toBe(0);
   expect(out.metrics.cer).toBeGreaterThan(0);
   expect(out.measuredPrecision).toBeNull();
 });
 it('counts extra OCR candidates only inside fully reviewed ROI',()=>{
   const reference=parseOcrReference(ref('complete'),1024,724);
   const out=compareOcrReference(reference,[
     p('Ø25,4',20),p('Ra 0,8',120),p('extra',300),p('outside',800)]);
   expect(out.scope).toBe('complete');
   expect(out.metrics.detected).toBe(3);
   expect(out.measuredFalsePositives).toBe(1);
   expect(out.measuredPrecision).toBeCloseTo(2/3);
 });
 it('requires approval and exact image dimensions; prevents complete without region',()=>{
   expect(()=>parseOcrReference(ref('partial',{reviewed:false}),1024,724)).toThrow(/reviewed/);
   expect(()=>parseOcrReference(ref('partial'),1023,724)).toThrow(/размеры/);
   expect(()=>parseOcrReference(ref('complete',{region:undefined}),1024,724)).toThrow(/region/);
 });
 it('keeps old array import but never claims precision from unknown coverage',()=>{
   const reference=parseOcrReference([b('one','300',100)],1024,724);
   const result=compareOcrReference(reference,[p('300',100),p('extra',500)]);
   expect(result.scope).toBe('legacy');
   expect(result.measuredPrecision).toBeNull();
   expect(result.measuredFalsePositives).toBeNull();
 });
 it('rejects duplicate ids, off-screen labels and partial overlap outside region',()=>{
   expect(()=>parseOcrReference(ref('partial',{labels:[b('same','A',20),b('same','B',120)]}),1024,724)).toThrow(/ID/);
   expect(()=>parseOcrReference(ref('partial',{labels:[b('far','A',1000)]}),1024,724)).toThrow(/bbox/);
   expect(()=>parseOcrReference(ref('complete',{labels:[b('outside','A',700)]}),1024,724)).toThrow(/bbox/);
 });
});
