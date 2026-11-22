import {describe,it,expect} from 'vitest';
import {reconcileOcrReadings,overlappingOcrRegions,type OcrReading} from './ocrConsensus';
const r=(text:string,x0=10,y0=10,confidence=.6,pass:'primary'|'retry'|'rotated'='primary'):OcrReading=>({
  text,x0,y0,x1:x0+80,y1:y0+15,confidence,pass,
});
describe('OCR multi-tile/multi-pass consensus without fabricated CAD text',()=>{
 it('deduplicates same text from adjacent tile and keeps best confidence',()=>{
   const out=reconcileOcrReadings([r('6000'),r('6000',12,10,.9)]);
   expect(out.readings).toHaveLength(1);
   expect(out.duplicates).toBe(1);
   expect(out.readings[0].confidence).toBe(.9);
 });
 it('does not merge repeated adjacent notes, even with the same content',()=>{
   const out=reconcileOcrReadings([r('R20',10),r('R20',96),r('R20',10,45)]);
   expect(out.readings).toHaveLength(3);
 });
 it('keeps original technical dimension when alternative has too little support',()=>{
   const out=reconcileOcrReadings([r('6000',10,10,.8),r('8000',11,10,.88,'retry')]);
   expect(out.readings[0].text).toBe('6000');
   expect(out.readings[0].alternatives).toEqual(['8000']);
   expect(out.conflicts).toBe(1);
 });
 it('promotes high-confidence re-read of weak OCR, but preserves alternatives',()=>{
   const out=reconcileOcrReadings([r('8O0',10,10,.4),r('800',11,10,.93,'retry')]);
   expect(out.readings[0].text).toBe('800');
   expect(out.readings[0].alternatives).toContain('8O0');
   expect(out.promoted).toBe(1);
 });
 it('never merges nearby labels with unequal scale or disjoint bbox',()=>{
   expect(overlappingOcrRegions(r('A'),{...r('B'),y0:35,y1:50})).toBe(false);
   const out=reconcileOcrReadings([r('6000'),{...r('R20'),y0:11,y1:51,x0:11,x1:91}]);
   expect(out.readings).toHaveLength(2);
 });
 it('rejects malformed boxes and unsafe confidence without NaN',()=>{
   const out=reconcileOcrReadings([r('R20',0,0,Infinity),r('R20',0,0,5)]);
   expect(out.readings).toHaveLength(1);
   expect(out.readings[0].confidence).toBe(1);
 });
});
