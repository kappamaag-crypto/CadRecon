import {describe,it,expect} from 'vitest';
import {evaluateOcrAccuracy} from './ocrMetrics';
const g=(id:string,text:string,x:number)=>({id,text,x0:x,y0:10,x1:x+80,y1:28});
const p=(text:string,x:number)=>({text,x0:x,y0:10,x1:x+80,y1:28});
describe('Independently annotated OCR quality reporting',()=>{
 it('reports perfect exact-match lines (synthetic, not measured browser OCR)',()=>{
   const m=evaluateOcrAccuracy([g('1','6000',0),g('2','М16',120)],
     [p('6000',0),p('М16',120)]);
   expect(m.precision).toBe(1);expect(m.recall).toBe(1);
   expect(m.cer).toBe(0);expect(m.wer).toBe(0);
   expect(m.criticalExactRate).toBe(1);
 });
 it('exposes one wrong critical dimension without forgiving digit confusion',()=>{
   const m=evaluateOcrAccuracy([g('1','6000',0)],[p('8000',0)]);
   expect(m.matched).toBe(1);
   expect(m.cer).toBeCloseTo(.25);
   expect(m.wer).toBe(1);
   expect(m.criticalExactRate).toBe(0);
 });
 it('counts missed labels and duplicates, even when recognized text matches',()=>{
   const m=evaluateOcrAccuracy([g('1','6000',0),g('2','R20',120)],
     [p('6000',0),p('6000',0)]);
   expect(m.matched).toBe(1);
   expect(m.missed).toBe(1);
   expect(m.falsePositive).toBe(1);
   expect(m.precision).toBe(.5);expect(m.recall).toBe(.5);
   expect(m.criticalExact).toBe(1);
   expect(m.criticalTokens).toBe(2);
 });
 it('does not assign a nearby label without enough box overlap',()=>{
   const m=evaluateOcrAccuracy([g('1','6000',0)],[p('6000',150)]);
   expect(m.missed).toBe(1);
   expect(m.falsePositive).toBe(1);
   expect(m.cer).toBe(2);
 });
 it('rejects invalid and huge unbounded benchmarks',()=>{
   expect(()=>evaluateOcrAccuracy([],[p('A',0)],2)).toThrow();
   expect(()=>evaluateOcrAccuracy(Array.from({length:2001},(_,i)=>g(String(i),'x',i)),[])).toThrow();
   expect(()=>evaluateOcrAccuracy([{...g('1','A',0),x0:NaN}],[])).toThrow();
 });
});
