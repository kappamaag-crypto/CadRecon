import * as pdfjs from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import * as UTIF from 'utif';
import {entity,newId,type Entity,type Sheet} from './model';
import {repairPdfText,suspiciousText} from './textRepair';
import {extractPdfPaths} from './pdfPaths';
pdfjs.GlobalWorkerOptions.workerSrc=pdfWorker;
async function imagePage(file:File):Promise<Sheet>{
  let url:string;
  if(/\.tiff?$/i.test(file.name)||file.type==='image/tiff'){
    const buf=await file.arrayBuffer();const pages=UTIF.decode(buf);if(!pages.length)throw new Error('TIFF пуст');
    UTIF.decodeImage(buf,pages[0]);const rgba=UTIF.toRGBA8(pages[0]);const c=document.createElement('canvas');c.width=pages[0].width;c.height=pages[0].height;
    const ctx=c.getContext('2d');if(!ctx)throw new Error('Canvas недоступен');
    ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba),c.width,c.height),0,0);url=c.toDataURL('image/png');
  } else {url=await new Promise<string>((res,rej)=>{const r=new FileReader();r.onload=()=>res(String(r.result));r.onerror=()=>rej(r.error);r.readAsDataURL(file);});}
  const img=new Image();img.src=url;await img.decode();
  return {id:newId(),name:file.name,width:img.naturalWidth,height:img.naturalHeight,image:url,entities:[],calibrated:false,sourceType:'image'};
}
export async function importDrawing(file:File,onProgress?:(s:string)=>void):Promise<Sheet[]>{
  if(file.size>90*1024*1024)throw new Error('Файл более 90 МБ: уменьшите разрешение или разбейте PDF');
  if(!/\.pdf$/i.test(file.name)&&file.type!=='application/pdf')return [await imagePage(file)];
  const src=new Uint8Array(await file.arrayBuffer());const pdf=await pdfjs.getDocument({data:src,useSystemFonts:true}).promise;
  try {
    const sheets:Sheet[]=[];if(pdf.numPages>40)onProgress?.('Будут загружены первые 40 листов, чтобы не переполнить память браузера.');
    for(let pageIndex=1;pageIndex<=Math.min(pdf.numPages,40);pageIndex++){
      onProgress?.('Обработка страницы '+pageIndex+' из '+pdf.numPages);
      const page=await pdf.getPage(pageIndex);
      const initial=page.getViewport({scale:1});
      const list=await page.getOperatorList();
      const paths=list.fnArray.filter(fn=>fn===pdfjs.OPS.constructPath).length;
      const longest=paths>25?3200:4800;
      const pixelLimit=22000000;
      const scale=Math.min(5,Math.max(1,Math.min(longest/Math.max(initial.width,initial.height),
        Math.sqrt(pixelLimit/(initial.width*initial.height)))));
      const vp=page.getViewport({scale});
      // Decode BEFORE render: PDF.js may reuse/cache mutable operator-list path buffers.
      const vectorResult=extractPdfPaths(list,vp,pdfjs.OPS);
      const canvas=document.createElement('canvas');canvas.width=Math.ceil(vp.width);canvas.height=Math.ceil(vp.height);
      const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Canvas недоступен');
      await page.render({canvasContext:ctx,canvas,viewport:vp}).promise;
      const entities=vectorResult.entities;
      // Digital PDF text remains editable; scans are handled by OCR separately.
      const textContent=await page.getTextContent();
      for(const item of textContent.items){
        if(!('str' in item)||!item.str.trim())continue;
        const pos=vp.convertToViewportPoint(item.transform[4],item.transform[5]);
        const e=entity('text',[{x:pos[0],y:pos[1]}],'Текст','pdf');
        const decoded=repairPdfText(item.str.trim());
        e.text=decoded.text;
        if(decoded.changed){e.reason=decoded.reason;e.confidence=decoded.confidence;}
        else if(suspiciousText(item.str)){e.reason='Возможна ошибка PDF-кодировки. Сверьте по оригиналу.';e.confidence=.4;}
        e.size=Math.max(2,Math.hypot(item.transform[2],item.transform[3])*scale);
        e.bbox={x0:pos[0],y0:pos[1]-e.size,x1:pos[0]+Math.abs(item.width||0)*scale,y1:pos[1]};
        entities.push(e);
      }
      sheets.push({id:newId(),name:file.name+' — '+pageIndex,width:canvas.width,height:canvas.height,image:canvas.toDataURL('image/jpeg',.985),entities,calibrated:false,importWarnings:vectorResult.warnings,sourceType:'pdf'});
      page.cleanup();
    }
    return sheets;
  }finally{await pdf.destroy();}
}