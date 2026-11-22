import {createWorker,PSM} from 'tesseract.js';
import {entity,type Entity,type Sheet} from './model';
/** Optional explicit download of public RU/EN OCR language packs.
 * Models and worker binaries are fetched to the user's browser. Tesseract.js
 * manages its own browser cache; this does not promise guaranteed offline use
 * after a cache clear or across all browser engines. Drawing data is not used. */
export async function preloadOcrModels(progress?:(message:string)=>void):Promise<void>{
  progress?.('Загрузка языковых моделей OCR на этот компьютер…');
  const worker=await createWorker(['rus','eng'],1,{
    logger:m=>{if(m.status)progress?.('OCR-модели: '+m.status+' '+Math.round((m.progress||0)*100)+'%');},
  });
  try{progress?.('OCR-модели русского и английского готовы в текущем браузере.');}
  finally{await worker.terminate();}
}
export async function recognizeText(sheet:Sheet,progress?:(s:string)=>void,signal?:AbortSignal):Promise<{entities:Entity[];text:string}> {
  if(!sheet.image)throw new Error('Для OCR нужен скан или PDF');
  const assertActive=()=>{if(signal?.aborted)throw new DOMException('OCR отменён','AbortError');};
  assertActive();
  progress?.('Загрузка OCR-моделей русского и английского языков…');
  const worker=await createWorker(['rus','eng'],1,{logger:m=>{if(m.status)progress?.(m.status+' '+Math.round((m.progress||0)*100)+'%');}});
  const onAbort=()=>{void worker.terminate().catch(()=>{});};
  signal?.addEventListener('abort',onAbort,{once:true});
  try {
    assertActive();
    // Scattered labels on an engineering sheet are not one continuous paragraph.
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.SPARSE_TEXT,
      preserve_interword_spaces:'1',
      user_defined_dpi:'300',
    });
    assertActive();
    const result=await worker.recognize(sheet.image,{}, {blocks:true, text:true});
    assertActive();
    const raw=result.data as unknown as {text?:string;blocks?:Array<{paragraphs?:Array<{lines?:Array<{text?:string;confidence?:number;bbox?:{x0:number;y0:number;x1:number;y1:number}}>} >}>};
    const img=new Image();img.src=sheet.image;await img.decode();const sx=sheet.width/img.naturalWidth,sy=sheet.height/img.naturalHeight;
    const entities:Entity[]=[];
    for(const block of raw.blocks||[])for(const para of block.paragraphs||[])for(const line of para.lines||[]){
      const text=(line.text||'').trim();if(!text||!line.bbox)continue;
      const {x0,y1,y0,x1}=line.bbox;const e=entity('text',[{x:x0*sx,y:y1*sy}],'OCR','ocr');
      e.text=text;e.size=Math.max(2,(y1-y0)*sy*.75);
      // Tesseract.js emits 0..100; CAD stores all confidence in 0..1.
      e.confidence=Number.isFinite(line.confidence)?Math.max(0,Math.min(1,(line.confidence||0)/100)):0;
      e.reason='Браузерный Tesseract OCR: текст не проверен инженером';
      e.bbox={x0:x0*sx,y0:y0*sy,x1:x1*sx,y1:y1*sy};entities.push(e);
    }
    return {entities,text:raw.text||''};
  } finally {signal?.removeEventListener('abort',onAbort);await worker.terminate();}
}