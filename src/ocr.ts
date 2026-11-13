import {createWorker,PSM} from 'tesseract.js';
import {entity,type Entity,type Sheet} from './model';
export async function recognizeText(sheet:Sheet,progress?:(s:string)=>void):Promise<{entities:Entity[];text:string}> {
  if(!sheet.image)throw new Error('Для OCR нужен скан или PDF');
  progress?.('Загрузка OCR-моделей русского и английского языков…');
  const worker=await createWorker(['rus','eng'],1,{logger:m=>{if(m.status)progress?.(m.status+' '+Math.round((m.progress||0)*100)+'%');}});
  try {
    // Scattered labels on an engineering sheet are not one continuous paragraph.
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.SPARSE_TEXT,
      preserve_interword_spaces:'1',
      user_defined_dpi:'300',
    });
    const result=await worker.recognize(sheet.image,{}, {blocks:true, text:true});
    const raw=result.data as unknown as {text?:string;blocks?:Array<{paragraphs?:Array<{lines?:Array<{text?:string;confidence?:number;bbox?:{x0:number;y0:number;x1:number;y1:number}}>} >}>};
    const img=new Image();img.src=sheet.image;await img.decode();const sx=sheet.width/img.naturalWidth,sy=sheet.height/img.naturalHeight;
    const entities:Entity[]=[];
    for(const block of raw.blocks||[])for(const para of block.paragraphs||[])for(const line of para.lines||[]){
      const text=(line.text||'').trim();if(!text||!line.bbox)continue;
      const {x0,y1,y0,x1}=line.bbox;const e=entity('text',[{x:x0*sx,y:y1*sy}],'OCR','ocr');
      e.text=text;e.size=Math.max(2,(y1-y0)*sy*.75);e.confidence=line.confidence;
      e.bbox={x0:x0*sx,y0:y0*sy,x1:x1*sx,y1:y1*sy};entities.push(e);
    }
    return {entities,text:raw.text||''};
  } finally {await worker.terminate();}
}