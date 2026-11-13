import {entity,type Entity,type Sheet} from './model';
export interface TraceResult {entities:Entity[];note:string;}
type VecLine={a:{x:number;y:number};b:{x:number;y:number};confidence:number};
type VecCircle={x:number;y:number;radius:number;confidence:number};
type WorkerResponse={lines?:VecLine[];circles?:VecCircle[];error?:string};

/**
 * Detail mode processes the ORIGINAL scan in overlapping tiles. Previously every page
 * was reduced to 1100px: thin steel outlines, bolts and small leader lines vanished.
 * Restrict the total pixel count for predictable browser memory usage.
 */
export async function traceImage(
  sheet:Sheet,minLength=12,onProgress?:(message:string)=>void,
  quality:'fast'|'detailed'='detailed'
):Promise<TraceResult>{
  if(!sheet.image)throw new Error('На листе отсутствует растровая подложка');
  const img=new Image();img.src=sheet.image;await img.decode();
  const maxPixels=quality==='detailed'?26000000:4000000;
  const maxSide=quality==='detailed'?8500:2300;
  const factor=Math.min(1,maxSide/Math.max(img.naturalWidth,img.naturalHeight),
    Math.sqrt(maxPixels/(img.naturalWidth*img.naturalHeight)));
  const fullWidth=Math.max(2,Math.round(img.naturalWidth*factor));
  const fullHeight=Math.max(2,Math.round(img.naturalHeight*factor));
  const tileSize=quality==='detailed'?1250:1150,overlap=quality==='detailed'?90:40;
  const step=tileSize-overlap;
  const tiles:Array<{x:number;y:number;w:number;h:number}>=[];
  for(let y=0;y<fullHeight;y+=step)for(let x=0;x<fullWidth;x+=step){
    tiles.push({x,y,w:Math.min(tileSize,fullWidth-x),h:Math.min(tileSize,fullHeight-y)});
    if(x+tileSize>=fullWidth)break;
  }
  const finalTiles=tiles.length>0?tiles:[{x:0,y:0,w:fullWidth,h:fullHeight}];
  const worker=new Worker(new URL('./trace.worker.ts',import.meta.url),{type:'module'});
  const cv=document.createElement('canvas'),ctx=cv.getContext('2d',{willReadFrequently:true});
  if(!ctx){worker.terminate();throw new Error('Canvas недоступен');}
  const lines:Entity[]=[],circles:Entity[]=[],seen=new Set<string>();
  const sx=sheet.width/fullWidth,sy=sheet.height/fullHeight;
  function lineKey(a:{x:number;y:number},b:{x:number;y:number}){
    const first=a.x<b.x||(a.x===b.x&&a.y<b.y)?a:b,second=first===a?b:a;
    return [first.x,first.y,second.x,second.y].map(n=>Math.round(n/3)).join(':');
  }
  try{
    for(let k=0;k<finalTiles.length;k++){
      const t=finalTiles[k];
      onProgress?.('Обводка исходного разрешения: участок '+(k+1)+' / '+finalTiles.length);
      cv.width=t.w;cv.height=t.h;
      ctx.drawImage(img,t.x/factor,t.y/factor,t.w/factor,t.h/factor,0,0,t.w,t.h);
      const rgba=ctx.getImageData(0,0,t.w,t.h).data;
      const data=await new Promise<WorkerResponse>((resolve,reject)=>{
        worker.onmessage=(ev:MessageEvent<WorkerResponse>)=>resolve(ev.data);
        worker.onerror=ev=>reject(new Error(ev.message));
        worker.postMessage({rgba,width:t.w,height:t.h,scale:1,minLength:Math.max(7,minLength*factor)});
      });
      if(data.error)throw new Error(data.error);
      for(const l of data.lines||[]){
        const a={x:(t.x+l.a.x)*sx,y:(t.y+l.a.y)*sy};
        const b={x:(t.x+l.b.x)*sx,y:(t.y+l.b.y)*sy};
        const key=lineKey(a,b);if(seen.has(key))continue;seen.add(key);
        const e=entity('line',[a,b],'Автообводка','trace');e.confidence=l.confidence;lines.push(e);
      }
      for(const c of data.circles||[]){
        const center={x:(t.x+c.x)*sx,y:(t.y+c.y)*sy};
        const radius=c.radius*(sx+sy)/2;
        const key='circle:'+Math.round(center.x/3)+':'+Math.round(center.y/3)+':'+Math.round(radius/3);
        if(seen.has(key))continue;seen.add(key);
        const e=entity('circle',[center],'Автообводка','trace');e.center=center;e.radius=radius;e.confidence=c.confidence;circles.push(e);
      }
    }
    return {entities:[...lines,...circles].slice(0,30000),
      note:'Детальная обводка: '+lines.length+' отрезков и '+circles.length+
      ' окружностей ('+finalTiles.length+' участков, '+fullWidth+'×'+fullHeight+' пикс.). Требуется проверка.'};
  }finally{worker.terminate();}
}
