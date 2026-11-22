import {createWorker,PSM} from 'tesseract.js';
import {entity,type Entity,type Sheet} from './model';
import {planOcrTiles,unrotateOcrBox,type OcrBox} from './ocrTiles';
import {reconcileOcrReadings,type OcrReading} from './ocrConsensus';
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
export type OcrMode='standard'|'enhanced';
export type OcrLanguages='rus+eng'|'rus'|'eng';
export interface OcrOptions {
  mode?:OcrMode;
  languages?:OcrLanguages;
  /** Opt-in: two whole-page 90° rotations; only when sheet <=3 million pixels. */
  detectVertical?:boolean;
  /** Bound expensive local re-reading of short/uncertain engineering text. */
  maxRetries?:number;
}
export interface OcrDiagnostics {
  tiles:number;initialReadings:number;retried:number;rotations:number;
  duplicates:number;conflicts:number;promoted:number;kept:number;
}
type RawLine={text?:string;confidence?:number;bbox?:OcrBox};
type TesseractText={text?:string;confidence?:number;blocks?:Array<{
  paragraphs?:Array<{lines?:RawLine[]}>
}>};
const NORMALIZE_CONF=(n:unknown)=>typeof n==='number'&&Number.isFinite(n)
  ?Math.max(0,Math.min(1,n/100)):0;

function linesFromData(raw:TesseractText):RawLine[]{
  const lines:RawLine[]=[];
  for(const block of raw.blocks||[])
    for(const paragraph of block.paragraphs||[])
      for(const line of paragraph.lines||[])lines.push(line);
  return lines;
}
/** Extract exact source-image bounding boxes; no auto-filling dimensions. */
export async function recognizeText(
  sheet:Sheet,progress?:(s:string)=>void,signal?:AbortSignal,
  options:OcrOptions={}
):Promise<{entities:Entity[];text:string;diagnostics?:OcrDiagnostics;warnings?:string[]}> {
  if(!sheet.image)throw new Error('Для OCR нужен скан или PDF');
  const assertActive=()=>{if(signal?.aborted)throw new DOMException('OCR отменён','AbortError');};
  const enhanced=options.mode==='enhanced',warnings:string[]=[];
  assertActive();
  progress?.('Загрузка OCR-моделей русского и английского языков на устройство…');
  const worker=await createWorker(options.languages==='rus'?['rus']:
    options.languages==='eng'?['eng']:['rus','eng'],1,{logger:m=>{
    if(m.status)progress?.(m.status+' '+Math.round((m.progress||0)*100)+'%');
  }});
  const onAbort=()=>{void worker.terminate().catch(()=>{});};
  signal?.addEventListener('abort',onAbort,{once:true});
  try {
    assertActive();
    // Sparse technical labels + section/position numbers, not an ordinary page.
    await worker.setParameters({
      tessedit_pageseg_mode:PSM.SPARSE_TEXT,
      preserve_interword_spaces:'1',
      user_defined_dpi:'300',
    });
    const img=new Image();img.src=sheet.image;
    await img.decode();assertActive();
    const width=img.naturalWidth,height=img.naturalHeight;
    const tiles=planOcrTiles(width,height),tiled=tiles.length>1;
    const sx=sheet.width/width,sy=sheet.height/height;
    const readings:OcrReading[]=[],fallback:string[]=[];
    let retried=0,rotations=0;
    const addLines=(raw:TesseractText,
      origin:{x:number;y:number;width:number;height:number},
      pass:'primary'|'rotated',
      transform?:(box:OcrBox)=>OcrBox)=>{
      if(raw.text)fallback.push(raw.text);
      for(const line of linesFromData(raw)){
        const value=(line.text||'').trim().slice(0,4000);
        if(!value||!line.bbox)continue;
        const {x0,y0,x1,y1}=line.bbox;
        if(![x0,y0,x1,y1].every(Number.isFinite)||x1<=x0||y1<=y0)continue;
        if(x1<0||y1<0||x0>origin.width||y0>origin.height)continue;
        const local:OcrBox={text:value,
          x0:Math.max(0,x0),y0:Math.max(0,y0),
          x1:Math.min(origin.width,x1),y1:Math.min(origin.height,y1)};
        const b=transform?transform(local):local;
        if(![b.x0,b.y0,b.x1,b.y1].every(Number.isFinite)||
          b.x1<=b.x0||b.y1<=b.y0)continue;
        readings.push({...b,x0:b.x0+origin.x,y0:b.y0+origin.y,
          x1:b.x1+origin.x,y1:b.y1+origin.y,
          confidence:NORMALIZE_CONF(line.confidence),pass});
      }
    };
    const cv=tiled||enhanced?document.createElement('canvas'):null;
    const ctx=cv?.getContext('2d',{willReadFrequently:true})||null;
    // Do not require Canvas when the whole image is already a usable data URL.
    if(tiled&&!ctx)throw new Error('OCR: Canvas недоступен для тайлов');
    for(let k=0;k<tiles.length;k++){
      assertActive();
      const tile=tiles[k];
      progress?.('OCR: основной анализ '+(k+1)+' / '+tiles.length);
      let image:string|HTMLCanvasElement=sheet.image;
      if(tiled){
        cv!.width=tile.width;cv!.height=tile.height;
        ctx!.drawImage(img,tile.x,tile.y,tile.width,tile.height,
          0,0,tile.width,tile.height);
        image=cv!;
      }
      const result=await worker.recognize(image,{}, {blocks:true,text:true});
      assertActive();
      addLines(result.data as unknown as TesseractText,tile,'primary');
    }
    const initialReadings=readings.length;
    // Secondary pass: only low-confidence / tiny lines, and strictly limited.
    // 2.5× local crop, no remote upload and no full-page multiply-upscale.
    if(enhanced&&readings.length){
      const maxRetries=Math.max(0,Math.min(80,
        Number.isFinite(options.maxRetries)?Math.floor(options.maxRetries!):50));
      const order=readings.map((reading,i)=>({reading,i}))
        .filter(({reading})=>
          reading.confidence<.76||(reading.y1-reading.y0)<15)
        .sort((a,b)=>a.reading.confidence-b.reading.confidence)
        .slice(0,maxRetries);
      if(order.length&&ctx){
        await worker.setParameters({tessedit_pageseg_mode:PSM.SINGLE_LINE});
        for(const {reading} of order){
          assertActive();
          const pad=Math.max(4,Math.min(16,(reading.y1-reading.y0)*.45));
          const x=Math.floor(Math.max(0,reading.x0-pad));
          const y=Math.floor(Math.max(0,reading.y0-pad));
          const right=Math.ceil(Math.min(width,reading.x1+pad));
          const bottom=Math.ceil(Math.min(height,reading.y1+pad));
          const cw=right-x,ch=bottom-y;
          // Skip huge stamps and hostile/degenerate boxes.
          if(cw<3||ch<3||cw>850||ch>300)continue;
          const zoom=Math.min(3,Math.max(1.5,28/Math.max(1,ch)));
          cv!.width=Math.ceil(cw*zoom);cv!.height=Math.ceil(ch*zoom);
          if(cv!.width*cv!.height>1_500_000)continue;
          ctx.save();
          ctx.filter='grayscale(1) contrast(1.6)';
          ctx.imageSmoothingEnabled=true;
          ctx.imageSmoothingQuality='high';
          ctx.drawImage(img,x,y,cw,ch,0,0,cv!.width,cv!.height);
          ctx.restore();
          progress?.('OCR: повторная проверка мелких надписей '+(retried+1)+' / '+order.length);
          const result=await worker.recognize(cv!,{}, {blocks:true,text:true});
          assertActive();retried++;
          const data=result.data as unknown as TesseractText;
          const found=linesFromData(data).filter(l=>l.text?.trim());
          const candidate=found.length===1?found[0]:null;
          // Keep the SOURCE bbox for the re-read, not the crop's frame.
          const value=(candidate?.text||(!found.length?data.text:'')||'').trim();
          const confidence=NORMALIZE_CONF(candidate?.confidence??data.confidence);
          if(value&&value.length<=4000&&!value.includes('\n')&&confidence>0)
            readings.push({...reading,text:value,confidence,pass:'retry'});
        }
        await worker.setParameters({tessedit_pageseg_mode:PSM.SPARSE_TEXT});
      }else if(order.length)warnings.push('Повторный проход OCR недоступен: Canvas отсутствует.');
      if(readings.length>initialReadings&&readings.length>15000)
        warnings.push('OCR: слишком много кандидатов, проверьте качество скана.');
    }
    // Optional vertical labels are expensive: no 90° whole-page pass on huge
    // A0 scans, where this could freeze the browser or overflow Canvas memory.
    if(enhanced&&options.detectVertical){
      if(tiles.length!==1||width*height>3_000_000||!ctx){
        warnings.push('Поворот OCR ±90° пропущен из-за большого размера скана.');
      }else{
        for(const angle of [90,-90] as const){
          assertActive();
          cv!.width=height;cv!.height=width;
          ctx.save();
          if(angle===90){ctx.translate(height,0);ctx.rotate(Math.PI/2);}
          else{ctx.translate(0,width);ctx.rotate(-Math.PI/2);}
          ctx.drawImage(img,0,0,width,height);
          ctx.restore();
          progress?.('OCR: вертикальные надписи, поворот '+angle+'°');
          const result=await worker.recognize(cv!,{}, {blocks:true,text:true});
          assertActive();rotations++;
          const transform=(b:OcrBox):OcrBox=>unrotateOcrBox(b,width,height,angle);
          addLines(result.data as unknown as TesseractText,
            {x:0,y:0,width:height,height:width},'rotated',transform);
        }
      }
    }
    if(cv){cv.width=0;cv.height=0;}
    const merged=reconcileOcrReadings(readings);
    const entities=merged.readings.map(r=>{
      const e=entity('text',[{x:r.x0*sx,y:r.y1*sy}],'OCR','ocr');
      e.text=r.text;e.size=Math.max(2,(r.y1-r.y0)*sy*.75);
      e.confidence=r.confidence;e.verified=false;
      e.bbox={x0:r.x0*sx,y0:r.y0*sy,x1:r.x1*sx,y1:r.y1*sy};
      const alternatives=r.alternatives||[];
      e.reason='Браузерный Tesseract RU/EN: надпись не проверена'+
        (tiled?'; обработка по перекрывающимся фрагментам':'')+
        (r.pass==='retry'?'; повторное увеличение слабого текста':
          r.pass==='rotated'?'; поворот исходного скана на ±90°':'')+
        (alternatives.length?'; КОНФЛИКТ OCR: возможны '+alternatives
          .slice(0,5).join(' / ')+'. Сверьте знаки, размеры и допуски по оригиналу':'');
      return e;
    });
    const diagnostics:OcrDiagnostics={tiles:tiles.length,initialReadings,retried,rotations,
      duplicates:merged.duplicates,conflicts:merged.conflicts,
      promoted:merged.promoted,kept:entities.length};
    // The legacy raw.text of each overlapping tile repeats lines. Use the
    // deduplicated coordinate-anchored list for operator review and copying.
    return {entities,text:entities.length?entities.map(e=>e.text).join('\n'):
      fallback.join(tiled?'\n':'').slice(0,100000),diagnostics,warnings};
  }finally{
    signal?.removeEventListener('abort',onAbort);
    await worker.terminate().catch(()=>{});
  }
}
