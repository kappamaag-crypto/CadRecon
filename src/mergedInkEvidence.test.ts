import {describe,it,expect} from 'vitest';
import {entity} from './model';
import {applyRecheckedLineEvidence} from './mergedInkEvidence';
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
 it('never modifies manually approved geometry, OCR or empty evidence',()=>{
   const approved=line();approved.verified=true;
   expect(applyRecheckedLineEvidence(approved,evidence(.8,.2,.3),100)).toBe(approved);
   const manual=line();manual.origin='manual';
   expect(applyRecheckedLineEvidence(manual,evidence(.8,.2,.3),100)).toBe(manual);
   expect(applyRecheckedLineEvidence(line(),{...evidence(.8,.2,.3),samples:0},100).scanEvidence).toBeUndefined();
 });
});
