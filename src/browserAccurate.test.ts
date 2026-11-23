import {beforeEach,describe,expect,it,vi} from 'vitest';
import {entity,newProject} from './model';
import {recognizeText} from './ocr';
import {traceImage} from './vectorize';
import {recognizeBrowserAccurate,uniqueCandidates,mergeRecognitionEntities} from './browserAccurate';

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
  it('can explicitly trace a mixed vector+raster PDF without losing native geometry',async ()=>{
    const sheet=newProject().sheets[0];sheet.sourceType='pdf';sheet.image='data:image/png;base64,fixture';
    const native=entity('line',[{x:0,y:0},{x:100,y:0}],'PDF векторы','pdf');
    const label=entity('text',[{x:10,y:20}],'Текст','pdf');label.text='5000';
    sheet.entities=[native,label];
    vi.mocked(traceImage).mockResolvedValue({entities:[line(0,30,100,30)],note:'scan'});
    vi.mocked(recognizeText).mockResolvedValue({entities:[ocr('R20',20,20)],text:'R20'});
    const result=await recognizeBrowserAccurate(sheet,undefined,undefined,'hybrid');
    expect(traceImage).toHaveBeenCalledOnce();
    expect(recognizeText).toHaveBeenCalledOnce();
    expect(result.entities.filter(e=>e.kind==='line')).toHaveLength(1);
    expect(result.entities.some(e=>e.kind==='text'&&e.text==='R20')).toBe(true);
    expect(result.warnings.join(' ')).toContain('Гибридный PDF');
    expect(sheet.entities).toHaveLength(2);
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
  it('honors opt-in vertical OCR from the main recognition workflow without a separate server',async()=>{
    const sheet=newProject().sheets[0];
    sheet.sourceType='image';sheet.image='data:image/png;base64,fixture';
    vi.mocked(traceImage).mockResolvedValue({entities:[],note:'trace'});
    vi.mocked(recognizeText).mockResolvedValue({entities:[],text:''});
    await recognizeBrowserAccurate(sheet,undefined,undefined,'auto','rus',true);
    expect(recognizeText).toHaveBeenCalledOnce();
    expect(vi.mocked(recognizeText).mock.calls[0][3]).toEqual({
      mode:'enhanced',languages:'rus',detectVertical:true,maxRetries:35,
    });
  });
  it('keeps browser geometry when OCR models are unavailable or offline',async ()=>{
    const sheet=newProject().sheets[0];sheet.sourceType='image';sheet.image='data:image/png;base64,fixture';
    vi.mocked(traceImage).mockResolvedValue({entities:[line(0,0,100,0)],note:'scan'});
    vi.mocked(recognizeText).mockRejectedValue(new Error('language models unavailable offline'));
    const result=await recognizeBrowserAccurate(sheet);
    expect(result.entities.some(e=>e.kind==='line')).toBe(true);
    expect(result.warnings.join(' ')).toContain('OCR RU/EN не выполнен');
    expect(result.entities.every(e=>!e.verified)).toBe(true);
  });
  it('keeps browser OCR when detailed line worker is unsupported',async ()=>{
    const sheet=newProject().sheets[0];sheet.sourceType='image';sheet.image='data:image/png;base64,fixture';
    vi.mocked(traceImage).mockRejectedValue(new Error('Web Worker unavailable'));
    vi.mocked(recognizeText).mockResolvedValue({entities:[ocr('R20',20,20)],text:'R20'});
    const result=await recognizeBrowserAccurate(sheet);
    expect(result.entities.filter(e=>e.kind==='text')).toHaveLength(1);
    expect(result.warnings.join(' ')).toContain('Автообводка не выполнена');
  });
  it('does not convert user cancellation into a partial successful reconstruction',async ()=>{
    const ctrl=new AbortController();
    const sheet=newProject().sheets[0];sheet.sourceType='image';sheet.image='data:image/png;base64,fixture';
    vi.mocked(traceImage).mockImplementation(async ()=>{
      ctrl.abort();
      throw new Error('Worker cancelled');
    });
    await expect(recognizeBrowserAccurate(sheet,undefined,ctrl.signal)).rejects.toThrow();
    expect(recognizeText).not.toHaveBeenCalled();
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
  it('is truly idempotent when OCR reruns disagree on a dimension in the same box',()=>{
    const original=ocr('Ø28',100,50);
    original.bbox={x0:100,y0:35,x1:135,y1:52};original.confidence=.85;
    const candidate=ocr('O28',101,51);
    candidate.bbox={x0:101,y0:35,x1:135,y1:52};candidate.confidence=.94;
    const a=mergeRecognitionEntities([original],[candidate]);
    expect(a.entities).toHaveLength(1);
    expect(a.entities[0].id).toBe(original.id);
    expect(a.entities[0].text).toBe('Ø28'); // no silent numerical correction
    expect(a.entities[0].reason).toContain('O28');
    const b=mergeRecognitionEntities(a.entities,[candidate]);
    expect(b.entities).toBe(a.entities);
    expect(b.added).toBe(0);
    expect(b.updated).toBe(0);
    expect(b.entities).toHaveLength(1);
  });
  it('keeps accepted and manually corrected OCR text untouched across reruns',()=>{
    const verified=ocr('Rz 20',30,40);verified.verified=true;
    const corrected=ocr('M20×1,5',90,40);
    corrected.reason='Объект изменён: требуется повторная проверка по оригиналу';
    const newer=ocr('M20×1,S',90,40);
    const result=mergeRecognitionEntities([verified,corrected],
      [ocr('Rz 2O',30,41),newer]);
    expect(result.added).toBe(0);
    expect(result.updated).toBe(0);
    expect(result.entities).toEqual([verified,corrected]);
  });
  it('recovers a clean nonnumeric OCR reading from a clearly broken one without changing its id',()=>{
    const damaged=ocr('Â�',15,20);damaged.confidence=.30;
    const clean=ocr('Вал',15,20);clean.confidence=.91;
    const result=mergeRecognitionEntities([damaged],[clean]);
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].text).toBe('Вал');
    expect(result.entities[0].id).toBe(damaged.id);
    expect(result.entities[0].verified).toBe(false);
    expect(result.entities[0].reason).toContain('Â�');
  });
  it('performs fallback OCR for broken native-PDF glyph mapping despite other valid digital text',async()=>{
    const sheet=newProject().sheets[0];sheet.sourceType='pdf';
    sheet.image='data:image/png;base64,fixture';
    const native=entity('line',[{x:0,y:0},{x:100,y:0}],'PDF','pdf');
    const good=entity('text',[{x:10,y:30}],'PDF','pdf');good.text='Вал';
    const broken=entity('text',[{x:25,y:50}],'PDF','pdf');
    broken.text='���';broken.reason='Возможна ошибка PDF-кодировки';
    sheet.entities=[native,good,broken];
    vi.mocked(recognizeText).mockResolvedValue({entities:[ocr('Сталь 45',25,50)],text:'Сталь 45'});
    const result=await recognizeBrowserAccurate(sheet);
    expect(result.scanned).toBe(false);
    expect(traceImage).not.toHaveBeenCalled();
    expect(recognizeText).toHaveBeenCalledOnce();
    expect(result.warnings.join(' ')).toContain('сомнительной кодировкой');
    expect(result.entities.some(e=>e.text==='Сталь 45')).toBe(true);
  });

});
