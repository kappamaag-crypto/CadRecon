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
function vectorPaths(list:any,vp:any):Entity[]{
  const entities:Entity[]=[];const ops=pdfjs.OPS;
  type Matrix=[number,number,number,number,number,number];
  let ctm:Matrix=[1,0,0,1,0,0];const stack:Matrix[]=[];
  const compose=(a:Matrix,b:Matrix):Matrix=>[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
  for(let n=0;n<list.fnArray.length;n++){
    const fn=list.fnArray[n];
    if(fn===ops.save){stack.push([...ctm] as Matrix);continue;}
    if(fn===ops.restore){ctm=stack.pop()||[1,0,0,1,0,0];continue;}
    if(fn===ops.transform){const tx=list.argsArray[n] as Matrix;if(tx?.length===6)ctm=compose(ctm,tx);continue;}
    if(fn!==ops.constructPath)continue;
    const arg=list.argsArray[n] as [number[],number[]];if(!arg||!Array.isArray(arg[0]))continue;
    const [commands,coords]=arg;let j=0;let last:{x:number;y:number}|null=null;let start:{x:number;y:number}|null=null;
    const point=(x:number,y:number)=>{const p=vp.convertToViewportPoint(ctm[0]*x+ctm[2]*y+ctm[4],ctm[1]*x+ctm[3]*y+ctm[5]);return {x:p[0],y:p[1]};};
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
      // Digital PDF text remains editable; scans are handled by OCR separately.
      const textContent=await page.getTextContent();
      for(const item of textContent.items){
        if(!('str' in item)||!item.str.trim())continue;
        const pos=vp.convertToViewportPoint(item.transform[4],item.transform[5]);
        const e=entity('text',[{x:pos[0],y:pos[1]}],'Текст','pdf');
        e.text=item.str.trim();
        e.size=Math.max(2,Math.hypot(item.transform[2],item.transform[3])*scale);
        entities.push(e);
      }
      sheets.push({id:newId(),name:file.name+' — '+pageIndex,width:canvas.width,height:canvas.height,image:canvas.toDataURL('image/jpeg',.92),entities,calibrated:false,sourceType:'pdf'});
      page.cleanup();
    }
    return sheets;
  }finally{await pdf.destroy();}
}