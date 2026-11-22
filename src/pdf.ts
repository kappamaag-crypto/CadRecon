import * as pdfjs from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import * as UTIF from 'utif';
import {entity,newId,type Entity,type Sheet} from './model';
import {repairPdfText,suspiciousText} from './textRepair';
import {extractPdfPaths} from './pdfPaths';
import {preservePdfRaster} from './pdfRasterPolicy';
pdfjs.GlobalWorkerOptions.workerSrc=pdfWorker;
async function imagePages(file:File,onProgress?:(s:string)=>void):Promise<Sheet[]>{
  // Multi-page TIFF is common for scanner archives; never silently discard
  // all pages except the first. Decode one frame at a time on the user device.
  if(/\.tiff?$/i.test(file.name)||file.type==='image/tiff'){
    const buf=await file.arrayBuffer(),pages=UTIF.decode(buf);
    if(!pages.length)throw new Error('TIFF пуст');
    const limit=20,sheets:Sheet[]=[];
    for(let i=0;i<Math.min(pages.length,limit);i++){
      onProgress?.('Импорт TIFF: страница '+(i+1)+' / '+pages.length);
      const page=pages[i];
      const header=page as typeof page & {t256?:number[];t257?:number[]};
      const rawWidth=header.t256?.[0],rawHeight=header.t257?.[0];
      if(rawWidth!==undefined&&rawHeight!==undefined&&
        (!Number.isInteger(rawWidth)||!Number.isInteger(rawHeight)||rawWidth<2||rawHeight<2||
        rawWidth*rawHeight>24_000_000))
        throw new Error('Страница TIFF '+(i+1)+' превышает безопасный предел 24 Мп. Разбейте скан или уменьшите разрешение.');
      // UTIF only materializes page.width/.height after decodeImage().
      UTIF.decodeImage(buf,page);
      const width=page.width,height=page.height;
      if(!Number.isInteger(width)||!Number.isInteger(height)||width<2||height<2||
         width*height>24_000_000)
        throw new Error('Некорректные размеры страницы TIFF '+(i+1));
      const rgba=UTIF.toRGBA8(page);
      const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
      const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Canvas недоступен');
      ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba),width,height),0,0);
      const warnings=pages.length>limit&&i===0?[
        'TIFF содержит '+pages.length+' страниц. Загружены только первые '+limit+
        ' из-за ограничения памяти браузера; оставшиеся страницы НЕ обработаны.',
      ]:[];
      sheets.push({id:newId(),name:file.name+' — '+(i+1),width,height,
        image:canvas.toDataURL('image/png'),entities:[],calibrated:false,
        importWarnings:warnings,sourceType:'image'});
      canvas.width=0;canvas.height=0;
    }
    return sheets;
  }
  const url=await new Promise<string>((res,rej)=>{
    const reader=new FileReader();
    reader.onload=()=>res(String(reader.result));
    reader.onerror=()=>rej(reader.error);
    reader.readAsDataURL(file);
  });
  const img=new Image();img.src=url;await img.decode();
  if(!Number.isFinite(img.naturalWidth)||!Number.isFinite(img.naturalHeight)||
     img.naturalWidth<2||img.naturalHeight<2||
     img.naturalWidth*img.naturalHeight>80_000_000)
    throw new Error('Изображение слишком велико для безопасной работы браузера (более 80 Мп). Разбейте на несколько фрагментов.');
  return [{id:newId(),name:file.name,width:img.naturalWidth,height:img.naturalHeight,
    image:url,entities:[],calibrated:false,sourceType:'image'}];
}
export async function importDrawing(file:File,onProgress?:(s:string)=>void):Promise<Sheet[]>{
  if(file.size>90*1024*1024)throw new Error('Файл более 90 МБ: уменьшите разрешение или разбейте PDF');
  if(!/\.pdf$/i.test(file.name)&&file.type!=='application/pdf')return imagePages(file,onProgress);
  const src=new Uint8Array(await file.arrayBuffer());const pdf=await pdfjs.getDocument({data:src,useSystemFonts:true}).promise;
  try {
    const sheets:Sheet[]=[];const maxTotalPixels=65_000_000;let renderedPixels=0;
    if(pdf.numPages>40)onProgress?.('Будут загружены первые 40 листов, чтобы не переполнить память браузера.');
    for(let pageIndex=1;pageIndex<=Math.min(pdf.numPages,40);pageIndex++){
      onProgress?.('Обработка страницы '+pageIndex+' из '+pdf.numPages);
      const page=await pdf.getPage(pageIndex);
      const initial=page.getViewport({scale:1});
      if(!Number.isFinite(initial.width)||!Number.isFinite(initial.height)||initial.width<=0||initial.height<=0)throw new Error('Недопустимые размеры страницы PDF');
      const list=await page.getOperatorList();
      const paths=list.fnArray.filter(fn=>fn===pdfjs.OPS.constructPath).length;
      // A PDF with one native line and a large embedded scan is *mixed*.
      // Presence of a native path alone must not hide a raster-quality warning.
      const codes=pdfjs.OPS as unknown as Record<string,number>;
      const imageCodes=new Set([
        'paintImageXObject','paintInlineImageXObject','paintImageMaskXObject',
        'paintJpegXObject','paintImageXObjectRepeat','paintInlineImageXObjectGroup',
        'paintImageMaskXObjectRepeat',
      ].map(name=>codes[name]).filter(Number.isFinite));
      const embeddedImages=Array.from(list.fnArray).filter(fn=>imageCodes.has(fn)).length;
      const longest=paths>25?3200:4800;
      const pixelLimit=22000000;
      // A huge PDF MediaBox must be allowed to render below 1x; forcing
      // scale>=1 can allocate hundreds of megapixels and crash mobile Chrome.
      const scale=Math.min(5,longest/Math.max(initial.width,initial.height),
        Math.sqrt(pixelLimit/(initial.width*initial.height)));
      const vp=page.getViewport({scale});
      const pixels=Math.ceil(vp.width)*Math.ceil(vp.height);
      if(sheets.length&&renderedPixels+pixels>maxTotalPixels){
        sheets[0].importWarnings=[...(sheets[0].importWarnings||[]),
          'Достигнут лимит памяти импорта PDF (65 Мп суммарно). Загружено '+sheets.length+
          ' из '+pdf.numPages+' страниц. Остальные НЕ импортированы; разделите PDF на части.'];
        page.cleanup();break;
      }
      renderedPixels+=pixels;
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
      const warnings=[...vectorResult.warnings];
      if(embeddedImages)warnings.push('В PDF обнаружено '+embeddedImages+
        ' растровых графических элементов. Если они содержат линии/надписи чертежа, используйте «Гибридный» режим: даже наличие отдельных PDF-векторов НЕ означает, что весь чертёж цифровой.');
      // Do not turn a crisp PDF-sourced scan into lossy JPEG before OCR.
      // Fallback is explicit if lossless data would exceed client memory.
      const raster=preservePdfRaster(canvas,pixels);
      if(raster.warning)warnings.push(raster.warning);
      if(scale<.999)warnings.push('Масштаб растровой подложки PDF уменьшен до '+Number(scale.toFixed(4))+' из-за больших размеров страницы. Векторные объекты сохраняют координаты листа, но мелкие детали подложки могут быть утрачены.');
      if(pageIndex===40&&pdf.numPages>40)warnings.push('В PDF '+pdf.numPages+' страниц; импортированы только первые 40. Оставшиеся НЕ обработаны.');
      sheets.push({id:newId(),name:file.name+' — '+pageIndex,width:canvas.width,height:canvas.height,image:raster.image,entities,calibrated:false,importWarnings:warnings,sourceType:'pdf'});
      page.cleanup();
    }
    return sheets;
  }finally{await pdf.destroy();}
}