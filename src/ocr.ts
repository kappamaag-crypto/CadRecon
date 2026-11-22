import {createWorker,PSM} from 'tesseract.js';
import {entity,type Entity,type Sheet} from './model';
import {planOcrTiles,sameOcrLine,type OcrBox} from './ocrTiles';
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
export async function recognizeText(
  sheet:Sheet,progress?:(s:string)=>void,signal?:AbortSignal
):Promise<{entities:Entity[];text:string}> {
  if(!sheet.image)throw new Error('Для OCR нужен скан или PDF');
  const assertActive=()=>{if(signal?.aborted)throw new DOMException('OCR отменён','AbortError');};
  assertActive();
  progress?.('Загрузка OCR-моделей русского и английского языков…');
  const worker=await createWorker(['rus','eng'],1,{logger:m=>{
    if(m.status)progress?.(m.status+' '+Math.round((m.progress||0)*100)+'%');
  }});
  const onAbort=()=>{void worker.terminate().catch(()=>{});};
  signal?.addEventListener('abort',onAbort,{once:true});
  try {
    assertActive();
    // Scattered engineering labels are not a continuous paragraph.
    await worker.setParameters({
      tessedit_pageseg_mode:PSM.SPARSE_TEXT,
      preserve_interword_spaces:'1',
      user_defined_dpi:'300',
    });
    const img=new Image();img.src=sheet.image;
    await img.decode();assertActive();
    const tiles=planOcrTiles(img.naturalWidth,img.naturalHeight);
    const tiled=tiles.length>1;
    const sx=sheet.width/img.naturalWidth,sy=sheet.height/img.naturalHeight;
    const entities:Entity[]=[],texts:string[]=[];
    const seen=new Map<string,OcrBox[]>();
    let canvas:HTMLCanvasElement|null=null,ctx:CanvasRenderingContext2D|null=null;
    if(tiled){
      canvas=document.createElement('canvas');
      ctx=canvas.getContext('2d',{willReadFrequently:true});
      if(!ctx)throw new Error('OCR: Canvas недоступен для тайлов');
    }
    for(let k=0;k<tiles.length;k++){
      assertActive();
      const tile=tiles[k];
      progress?.('OCR на устройстве: участок '+(k+1)+' / '+tiles.length);
      let image:string|HTMLCanvasElement=sheet.image;
      if(tiled){
        canvas!.width=tile.width;canvas!.height=tile.height;
        ctx!.drawImage(img,tile.x,tile.y,tile.width,tile.height,0,0,tile.width,tile.height);
        image=canvas!;
      }
      const result=await worker.recognize(image,{}, {blocks:true,text:true});
      assertActive();
      const raw=result.data as unknown as {
        text?:string;
        blocks?:Array<{paragraphs?:Array<{lines?:Array<{
          text?:string;confidence?:number;
          bbox?:{x0:number;y0:number;x1:number;y1:number}
        }>}>}>;
      };
      if(raw.text)texts.push(raw.text);
      for(const block of raw.blocks||[])for(const para of block.paragraphs||[])for(const line of para.lines||[]){
        const label=(line.text||'').trim().slice(0,4000);
        if(!label||!line.bbox)continue;
        const {x0,y0,x1,y1}=line.bbox;
        if(![x0,y0,x1,y1].every(Number.isFinite)||x1<=x0||y1<=y0)continue;
        const box:OcrBox={text:label,x0:x0+tile.x,y0:y0+tile.y,
          x1:x1+tile.x,y1:y1+tile.y};
        // A note crossing two neighboring OCR tiles can be emitted twice.
        // Suppress only substantially OVERLAPPING exact-text boxes.
        const cx=Math.floor((box.x0+box.x1)/64),cy=Math.floor((box.y0+box.y1)/64);
        const prefixKey=label+':';
        let duplicate=false;
        for(let dy=-1;dy<=1&&!duplicate;dy++)for(let dx=-1;dx<=1;dx++){
          const key=prefixKey+(cx+dx)+':'+(cy+dy);
          if(seen.get(key)?.some(old=>sameOcrLine(old,box))){duplicate=true;break;}
        }
        if(duplicate)continue;
        const key=prefixKey+cx+':'+cy;
        const previous=seen.get(key)||[];previous.push(box);seen.set(key,previous);
        const e=entity('text',[{x:box.x0*sx,y:box.y1*sy}],'OCR','ocr');
        e.text=label;e.size=Math.max(2,(box.y1-box.y0)*sy*.75);
        // Tesseract.js emits 0..100. CAD stores all confidence in 0..1.
        e.confidence=Number.isFinite(line.confidence)?
          Math.max(0,Math.min(1,(line.confidence||0)/100)):0;
        e.reason='Браузерный Tesseract OCR: текст не проверен инженером'+
          (tiled?'; распознан на фрагменте скана':'');
        e.bbox={x0:box.x0*sx,y0:box.y0*sy,x1:box.x1*sx,y1:box.y1*sy};
        entities.push(e);
      }
    }
    if(canvas){canvas.width=0;canvas.height=0;}
    return {entities,text:texts.join(tiled?'\n':'')};
  } finally {
    signal?.removeEventListener('abort',onAbort);
    await worker.terminate().catch(()=>{});
  }
}
