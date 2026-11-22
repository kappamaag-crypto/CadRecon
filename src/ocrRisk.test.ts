import {describe,it,expect} from 'vitest';
import {assessTechnicalOcr} from './ocrRisk';
describe('W2 technical dimension/OCR confusable audit without auto-substitution',()=>{
 it('flags high-confidence-looking 8O0, 6О00 and R2O for numeric re-read',()=>{
   for(const bad of ['8O0','6О00','R2O','M1l']){
     const r=assessTechnicalOcr(bad);
     expect(r.needsReread).toBe(true);
     expect(r.needsReview).toBe(true);
   }
 });
 it('preserves legitimate exact digits, radius and diameter characters',()=>{
   for(const valid of ['800','6000','R20','⌀25','Ø12','M16','+0.02','±0,5']){
     expect(assessTechnicalOcr(valid).needsReread).toBe(false);
   }
 });
 it('flags mixed Cyrillic/Latin inside same label but not normal RU+EN documentation',()=>{
   const r=assessTechnicalOcr('M16Х');
   expect(r.needsReview).toBe(true);
   expect(r.warnings.join(' ')).toContain('кириллица');
   expect(assessTechnicalOcr('ГОСТ 2.301 EN 10025').needsReview).toBe(false);
 });
 it('is bounded and never edits source text',()=>{
   const source='8O0';
   expect(assessTechnicalOcr(source).warnings.length).toBeGreaterThan(0);
   expect(source).toBe('8O0');
   expect(assessTechnicalOcr('x'.repeat(5000)).needsReread).toBe(false);
 });
});
