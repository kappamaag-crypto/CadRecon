import * as pdfjs from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import * as UTIF from 'utif';
import {entity,newId,type Entity,type Sheet} from './model';
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
function vectorPaths(list:Awaited<ReturnType<Awaited<ReturnType<typeof pdfjs.getDocument>['promise']>['getPage']>['getOperatorList']>>,vp:ReturnType<Awaited<ReturnType<Awaited<ReturnType<typeof pdfjs.getDocument>['promise']>['getPage']>['getViewport']>>):Entity[]{
  const entities:Entity[]=[];const ops=pdfjs.OPS;
  for(let n=0;n<list.fnArray.length;n++){
    if(list.fnArray[n]!==ops.constructPath)continue;
    const arg=list.argsArray[n] as [number[],number[]];if(!arg||!Array.isArray(arg[0]))continue;
    const [commands,coords]=arg;let j=0;let last:{x:number;y:number}|null=null;let start:{x:number;y:number}|null=null;
    const point=(x:number,y:number)=>{const p=vp.convertToViewportPoint(x,y);return {x:p[0],y:p[1]};};
    const push=(a:{x:number;y:number}|null,b:{x:number;y:number})=>{if(!a||Math.hypot(a.x-b.x,a.y-b.y)<1)return;if(entities.length<30000)entities.push(entity('line',[a,b],'PDF векторы','pdf'));};
    for(const c of commands) {
      if(c===ops.moveTo){last=point(coords[j++],coords[j++]);start=last;}
      else if(c===ops.lineTo){const b=point(coords[j++],coords[j++]);push(last,b);last=b;}
      else if(c===ops.curveTo){const c1=point(coords[j++],coords[j++]),c2=point(coords[j++],coords[j++]),b=point(coords[j++],coords[j++]);if(last){let prev=last;for(let k=1;k<=8;k++){const t=k/8,u=1-t,p={x:u*u*u*last.x+3*u*u*t*c1.x+3*u*t*t*c2.x+t*t*t*b.x,y:u*u*u*last.y+3*u*u*t*c1.y+3*u*t*t*c2.y+t*t*t*b.y};push(prev,p);prev=p;}}last=b;}
      else if(c===ops.rectangle){const x=coords[j++],y=coords[j++],w=coords[j++],h=coords[j++];const p=[point(x,y),point(x+w,y),point(x+w,y+h),point(x,y+h)];for(let k=0;k<4;k++)push(p[k],p[(k+1)%4]);last=p[0];start=last;}
      else if(c===ops.closePath){if(last&&start)push(last,start);last=start;}
    }
  }
  return entities;
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
      const initial=page.getViewport({scale:1});const scale=Math.min(3,Math.max(1,2400/Math.max(initial.width,initial.height)));
      const vp=page.getViewport({scale});
      const canvas=document.createElement('canvas');canvas.width=Math.ceil(vp.width);canvas.height=Math.ceil(vp.height);
      const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Canvas недоступен');
      await page.render({canvasContext:ctx,canvas,viewport:vp}).promise;
      const list=await page.getOperatorList();
      const entities=vectorPaths(list,vp);
      sheets.push({id:newId(),name:file.name+' — '+pageIndex,width:canvas.width,height:canvas.height,image:canvas.toDataURL('image/jpeg',.92),entities,calibrated:false,sourceType:'pdf'});
      page.cleanup();
    }
    return sheets;
  }finally{await pdf.destroy();}
}