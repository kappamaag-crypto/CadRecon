/** Pages-only PDF render retention policy.
 * The rendered scan is the SOURCE for subsequent tracing/OCR: lossy JPEG
 * re-encoding before reconstruction can erase thin strokes and tiny glyphs.
 * Prefer lossless PNG, with an explicit bounded fallback when it is too
 * expensive for client-side memory/IndexedDB.
 */
export interface DataUrlCanvas {toDataURL(type?:string,quality?:number):string}
export interface PdfRenderRaster {
  image:string;lossless:boolean;warning?:string;
}
const MAX_PNG_DATA_URL=72_000_000;
const MAX_PIXELS=22_000_000;
export function preservePdfRaster(canvas:DataUrlCanvas,pixels:number):PdfRenderRaster{
  if(!Number.isInteger(pixels)||pixels<1||pixels>MAX_PIXELS)
    throw new Error('PDF: неверный размер растровой страницы');
  let cause='';
  try {
    const png=canvas.toDataURL('image/png');
    if(png.startsWith('data:image/png;base64,')&&png.length<=MAX_PNG_DATA_URL)
      return {image:png,lossless:true};
    cause=png.startsWith('data:image/png;base64,')?
      'PNG превышает лимит памяти '+Math.round(MAX_PNG_DATA_URL/1e6)+' МБ':
      'PNG в браузере не поддерживается';
  }catch(e){cause='Не удалось получить PNG: '+String(e).slice(0,100);}
  const jpeg=canvas.toDataURL('image/jpeg',.985);
  if(!jpeg.startsWith('data:image/jpeg;base64,')||
    jpeg.length>MAX_PNG_DATA_URL*2)throw new Error('PDF: нельзя безопасно сохранить растровую подложку');
  return {image:jpeg,lossless:false,warning:
    'ПОДЛОЖКА PDF сжата с потерями (JPEG) после отказа от PNG: '+cause+
    '. Тонкие линии и мелкий текст могут пострадать. Для точности импортируйте исходный PNG/TIFF или разбейте PDF на страницы.'};
}
