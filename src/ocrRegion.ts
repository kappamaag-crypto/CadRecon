/** Browser-only region-of-interest OCR preparation. Coordinates always map
 * to original sheet units (unknown millimeters until calibrated).
 * Neither the source image nor the crop is transmitted to an OCR server.
 */
import type {Entity,Point,Sheet} from './model';
export interface SheetRect {x0:number;y0:number;x1:number;y1:number;}
export interface PixelRegion {
  x:number;y:number;width:number;height:number;
  offset:Point;sheetWidth:number;sheetHeight:number;
}
export function regionToSourcePixels(
  sheet:Pick<Sheet,'width'|'height'>,
  imgWidth:number,imgHeight:number,rect:SheetRect
):PixelRegion{
  const nums=[sheet.width,sheet.height,imgWidth,imgHeight,rect.x0,rect.y0,rect.x1,rect.y1];
  if(!nums.every(Number.isFinite)||sheet.width<=0||sheet.height<=0||
    imgWidth<2||imgHeight<2)throw new Error('OCR область: недопустимые координаты');
  const left=Math.max(0,Math.min(sheet.width,Math.min(rect.x0,rect.x1)));
  const right=Math.max(0,Math.min(sheet.width,Math.max(rect.x0,rect.x1)));
  const top=Math.max(0,Math.min(sheet.height,Math.min(rect.y0,rect.y1)));
  const bottom=Math.max(0,Math.min(sheet.height,Math.max(rect.y0,rect.y1)));
  const x=Math.max(0,Math.min(imgWidth,Math.floor(left*imgWidth/sheet.width)));
  const y=Math.max(0,Math.min(imgHeight,Math.floor(top*imgHeight/sheet.height)));
  const rx=Math.max(0,Math.min(imgWidth,Math.ceil(right*imgWidth/sheet.width)));
  const by=Math.max(0,Math.min(imgHeight,Math.ceil(bottom*imgHeight/sheet.height)));
  const width=rx-x,height=by-y;
  if(width<12||height<12)throw new Error('OCR область: выделите прямоугольник не меньше 12×12 пикселей');
  if(width*height>6_000_000)throw new Error('OCR область: не более 6 Мп за операцию. Выделите меньший фрагмент.');
  return {x,y,width,height,offset:{
    x:x*sheet.width/imgWidth,y:y*sheet.height/imgHeight,
  },sheetWidth:width*sheet.width/imgWidth,sheetHeight:height*sheet.height/imgHeight};
}
export async function cropOcrRegion(
  sheet:Sheet,rect:SheetRect,
):Promise<{sheet:Sheet;offset:Point;pixels:PixelRegion}>{
  if(!sheet.image)throw new Error('OCR область: у листа нет исходной подложки');
  const img=new Image();img.src=sheet.image;await img.decode();
  const pixels=regionToSourcePixels(sheet,img.naturalWidth,img.naturalHeight,rect);
  const canvas=document.createElement('canvas');
  canvas.width=pixels.width;canvas.height=pixels.height;
  const context=canvas.getContext('2d',{willReadFrequently:true});
  if(!context)throw new Error('OCR область: Canvas недоступен');
  // Engineering scans often contain alpha. Explicit paper background is
  // necessary before PNG encoding; transparent black is not real ink.
  context.fillStyle='#fff';
  context.fillRect(0,0,pixels.width,pixels.height);
  context.drawImage(img,pixels.x,pixels.y,pixels.width,pixels.height,0,0,pixels.width,pixels.height);
  const crop:Sheet={id:sheet.id,name:sheet.name+' — выделенная область',
    width:pixels.sheetWidth,height:pixels.sheetHeight,
    image:canvas.toDataURL('image/png'),entities:[],calibrated:sheet.calibrated,sourceType:'image'};
  canvas.width=0;canvas.height=0;
  return {sheet:crop,offset:pixels.offset,pixels};
}
export function placeOcrRegionReadings(entities:Entity[],offset:Point):Entity[]{
  return entities.map(e=>({...e,verified:false,
    points:e.points.map(p=>({x:p.x+offset.x,y:p.y+offset.y})),
    bbox:e.bbox?{x0:e.bbox.x0+offset.x,y0:e.bbox.y0+offset.y,
      x1:e.bbox.x1+offset.x,y1:e.bbox.y1+offset.y}:undefined,
    reason:(e.reason||'OCR')+'; повторное распознавание выделенной пользователем области'}));
}
