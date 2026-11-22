import {describe,it,expect} from 'vitest';
import {newProject,entity,validateProject} from './model';
import {assessRecognitionQuality} from './recognitionQuality';
const pt=(x:number,y:number)=>({x,y});
describe('W1-W3 non-deceptive 2D recognition risk report',()=>{
 it('requires a drawing before pretending to have reconstructed anything',()=>{
   const q=assessRecognitionQuality(newProject().sheets[0]);
   expect(q.source).toBe('empty');
   expect(q.unverified).toBe(0);
   expect(q.nextSteps.join(' ')).toContain('Загрузите PDF');
 });
 it('marks vector+image PDFs mixed instead of silently skipping raster geometry',()=>{
   const sheet=newProject().sheets[0];sheet.sourceType='pdf';sheet.image='data:image/png;base64,AA';
   sheet.entities=[entity('line',[pt(0,0),pt(100,0)],'PDF векторы','pdf')];
   sheet.importWarnings=['В PDF обнаружено 2 растровых графических элементов'];
   const q=assessRecognitionQuality(sheet);
   expect(q.source).toBe('mixed-pdf');
   expect(q.nextSteps.join(' ')).toContain('Гибридный');
 });
 it('inspects typed ink evidence and does not call intentional dash gaps broken SOLID',()=>{
   const sheet=newProject().sheets[0];sheet.sourceType='image';sheet.image='data:image/png;base64,AA';
   const weak=entity('line',[pt(0,0),pt(100,0)],'Автообводка','trace');
   weak.scanEvidence={inkSupport:.19,blankRunRatio:.37};
   const dashed=entity('line',[pt(0,10),pt(100,10)],'Автообводка','trace');
   dashed.lineStyle='dashed';
   dashed.scanEvidence={inkSupport:.65,blankRunRatio:.24,patternMarks:9};
   sheet.entities=[weak,dashed];
   expect(validateProject({...newProject(),sheets:[sheet]}).sheets[0].entities).toHaveLength(2);
   const q=assessRecognitionQuality(sheet);
   expect(q.weakInk).toBe(1);
   expect(q.brokenSolid).toBe(1);
   expect(q.styledDashed).toBe(1);
   expect(q.styledCenter).toBe(0);
   expect(q.unverified).toBe(2);
   expect(sheet.entities.every(e=>!e.verified)).toBe(true);
 });
 it('recognizes lossy PDF fallback and weak OCR without inventing accuracy',()=>{
   const sheet=newProject().sheets[0];sheet.sourceType='pdf';sheet.image='data:image/jpeg;base64,AA';
   sheet.importWarnings=['ПОДЛОЖКА PDF сжата с потерями (JPEG)'];
   const t=entity('text',[pt(20,20)],'OCR','ocr');t.text='80OO';t.confidence=42;
   sheet.entities=[t];
   const q=assessRecognitionQuality(sheet);
   expect(q.source).toBe('raster-pdf');
   expect(q.missingPixels).toBe(true);
   expect(q.weakOcr).toBe(1);
   expect(q.warnings.join(' ')).toContain('потеря данных');
 });
});
