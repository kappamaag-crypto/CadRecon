import {describe,it,expect} from 'vitest';
import {repairPdfText,suspiciousText} from './textRepair';
describe('PDF encoding repair',()=>{
 it('repairs Windows-1251 text extracted as Latin-1',()=>{
   expect(repairPdfText('Áîëò M24x90 10.9').text).toBe('Болт M24x90 10.9');
   expect(repairPdfText('Ñòàëü').text).toBe('Сталь');
 });
 it('does not alter correct Cyrillic, Latin brands, dimensions or single-letter marks',()=>{
  for(const text of ['Болт М24х90','AutoCAD','Ø16','Ra 3,2','1А-1А','Á-412']){
    expect(repairPdfText(text).text).toBe(text);
  }
 });
 it('flags ambiguous PDF glyph mappings without guessing their meaning',()=>{
   expect(suspiciousText('Áîëò')).toBe(true);
 });
});