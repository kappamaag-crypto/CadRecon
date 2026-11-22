import {beforeEach,describe,expect,it,vi} from 'vitest';
import {entity,newProject} from './model';
import {recognizeText} from './ocr';
import {traceImage} from './vectorize';
import {recognizeBrowserAccurate,uniqueCandidates} from './browserAccurate';

vi.mock('./ocr',()=>({recognizeText:vi.fn()}));
vi.mock('./vectorize',()=>({traceImage:vi.fn()}));
beforeEach(()=>vi.resetAllMocks());

function line(x0:number,y0:number,x1:number,y1:number){
  return entity('line',[{x:x0,y:y0},{x:x1,y:y1}],'Автообводка','trace');
}
function ocr(text:string,x:number,y:number){
  const e=entity('text',[{x,y}],'OCR','ocr');
  e.text=text;e.confidence=93;return e;
}

describe('Pages-only Accurate reconstruction',()=>{
  it('never rerasterizes or reOCRs a native vector PDF with real editable text',async ()=>{
    const sheet=newProject().sheets[0];
    sheet.sourceType='pdf';
    sheet.image='data:image/png;base64,fixture';
    const native=entity('line',[{x:0,y:0},{x:100,y:0}],'PDF векторы','pdf');
    const label=entity('text',[{x:50,y:10}],'Текст','pdf');
    label.text='6000';sheet.entities=[native,label];
    const result=await recognizeBrowserAccurate(sheet);
    expect(result.scanned).toBe(false);
    expect(result.entities).toHaveLength(0);
    expect(traceImage).not.toHaveBeenCalled();
    expect(recognizeText).not.toHaveBeenCalled();
    expect(result.note).toContain('Исходный чертёж не отправлялся');
  });
  it('traces and OCRs scanned pages locally with unknown mm scale',async ()=>{
    const sheet=newProject().sheets[0];
    sheet.sourceType='image';
    sheet.image='data:image/png;base64,fixture';
    const detected=line(10,10,100,10);
    vi.mocked(traceImage).mockResolvedValue({
      entities:[detected],note:'Детальная обводка: 1 отрезков (1 участков, 900×600 пикс.)',
    });
    vi.mocked(recognizeText).mockResolvedValue({
      entities:[ocr('R20',60,30)],text:'R20',
    });
    const result=await recognizeBrowserAccurate(sheet);
    expect(result.scanned).toBe(true);
    expect(result.entities.some(e=>e.kind==='line')).toBe(true);
    expect(result.entities.some(e=>e.kind==='text'&&e.text==='R20')).toBe(true);
    expect(result.entities.every(e=>!e.verified)).toBe(true);
    expect(result.ocrText).toBe('R20');
    expect(result.warnings.join(' ')).toContain('Масштаб не калиброван');
    expect(traceImage).toHaveBeenCalledOnce();
    expect(recognizeText).toHaveBeenCalledOnce();
  });
  it('does not duplicate previously recovered candidate geometry/text on rerun',async ()=>{
    const sheet=newProject().sheets[0];
    sheet.sourceType='image';
    sheet.image='data:image/png;base64,fixture';
    sheet.entities=[line(0,0,100,0),ocr('R20',50,15)];
    vi.mocked(traceImage).mockResolvedValue({entities:[line(100,0,0,0)],note:'scan'});
    vi.mocked(recognizeText).mockResolvedValue({entities:[ocr('R20',51,15)],text:'R20'});
    const result=await recognizeBrowserAccurate(sheet);
    expect(result.entities.some(e=>e.kind==='line')).toBe(false);
    expect(result.entities.some(e=>e.kind==='text'&&e.text==='R20')).toBe(false);
  });
  it('preserves 2000 distinct line segments even when PDF path source ID is shared',()=>{
    const lines=Array.from({length:2000},(_,i)=>{
      const e=line(i*3,0,i*3+1,0);
      e.sourceId='pdf-path-op-17';return e;
    });
    const fresh=uniqueCandidates([],lines);
    expect(fresh).toHaveLength(2000);
    expect(uniqueCandidates(fresh,lines)).toHaveLength(0);
    expect(fresh.every(e=>!e.verified)).toBe(true);
  });
  it('does not merge different OCR values or adjacent but distinct lines',()=>{
    const existing=[line(0,0,100,0),ocr('60',50,15)];
    const newLine=line(0,2,100,2),newText=ocr('80',50,15);
    expect(uniqueCandidates(existing,[newLine,newText])).toHaveLength(2);
    expect(uniqueCandidates(existing,[line(100,0,0,0),ocr('60',50,16)])).toHaveLength(0);
  });
});
