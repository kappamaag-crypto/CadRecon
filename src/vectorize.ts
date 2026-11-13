import {entity,type Entity,type Sheet} from './model';
export interface TraceResult {entities:Entity[];note:string;}
export async function traceImage(sheet:Sheet,minLength=28):Promise<TraceResult>{
  if(!sheet.image)throw new Error('На листе отсутствует растровая подложка');
  const img=new Image();img.src=sheet.image;await img.decode();
  const scale=Math.min(1,1100/Math.max(img.naturalWidth,img.naturalHeight));
  const canvas=document.createElement('canvas');canvas.width=Math.max(2,Math.round(img.naturalWidth*scale));canvas.height=Math.max(2,Math.round(img.naturalHeight*scale));
  const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)throw new Error('Canvas недоступен');
  ctx.drawImage(img,0,0,canvas.width,canvas.height);
  const {data}=ctx.getImageData(0,0,canvas.width,canvas.height);
  const worker=new Worker(new URL('./trace.worker.ts',import.meta.url),{type:'module'});
  try {
    return await new Promise<TraceResult>((resolve,reject)=>{
      worker.onmessage=(ev:MessageEvent<{lines?:Array<{a:{x:number;y:number};b:{x:number;y:number};confidence:number}>;circles?:Array<{x:number;y:number;radius:number;confidence:number}>;error?:string}>)=>{
        if(ev.data.error)return reject(new Error(ev.data.error));
        const sx=sheet.width/img.naturalWidth,sy=sheet.height/img.naturalHeight;
        const entities=(ev.data.lines||[]).map(l=>({...entity('line',[{x:l.a.x*sx,y:l.a.y*sy},{x:l.b.x*sx,y:l.b.y*sy}],'Автообводка','trace'),confidence:l.confidence}));
        const circles=(ev.data.circles||[]).map(c=>{const e=entity('circle',[{x:c.x*sx,y:c.y*sy}],'Автообводка','trace');e.center={x:c.x*sx,y:c.y*sy};e.radius=c.radius*(sx+sy)/2;e.confidence=c.confidence;return e;});
        resolve({entities:[...entities,...circles],note:'Автообводка: '+entities.length+' отрезков и '+circles.length+' окружностей. Нужна проверка.'});
      };
      worker.onerror=ev=>reject(new Error(ev.message));
      worker.postMessage({rgba:data,width:canvas.width,height:canvas.height,scale:1/scale,minLength:minLength*scale});
    });
  } finally {worker.terminate();}
}