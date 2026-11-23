import {entity,type Entity,type Sheet} from './model';
import {consolidateScanLines} from './scanTopology';
export interface TraceResult {entities:Entity[];note:string;warnings?:string[];sampledScale?:number;}
type VecLine={a:{x:number;y:number};b:{x:number;y:number};confidence:number;inkSupport?:number;blankRunRatio?:number;lineStyle?:'dashed'|'center';patternMarks?:number};
type VecCircle={x:number;y:number;radius:number;confidence:number};
type WorkerResponse={lines?:VecLine[];circles?:VecCircle[];circleStrokeDuplicates?:number;inkStrokeDuplicates?:number;centerlineAdjusted?:number;error?:string};

/**
 * Detail mode processes the ORIGINAL scan in overlapping tiles. Previously every page
 * was reduced to 1100px: thin steel outlines, bolts and small leader lines vanished.
 * Restrict the total pixel count for predictable browser memory usage.
 */
export async function traceImage(
  sheet:Sheet,minLength=12,onProgress?:(message:string)=>void,
  quality:'fast'|'detailed'='detailed',signal?:AbortSignal
):Promise<TraceResult>{
  if(!sheet.image)throw new Error('На листе отсутствует растровая подложка');
  const assertActive=()=>{if(signal?.aborted)throw new DOMException('Обработка отменена пользователем','AbortError');};
  assertActive();
  const img=new Image();img.src=sheet.image;await img.decode();assertActive();
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
  let circularDuplicates=0,inkDuplicates=0,centerlineAdjusted=0;
  const warnings:string[]=[];
  if(factor<.999)warnings.push('Исходный скан уменьшен для памяти: '+img.naturalWidth+'×'+img.naturalHeight+' → '+fullWidth+'×'+fullHeight+' пикселей. Мелкие элементы могут быть потеряны.');
  const sx=sheet.width/fullWidth,sy=sheet.height/fullHeight;
  function lineKey(a:{x:number;y:number},b:{x:number;y:number},style?:'dashed'|'center'){
    const first=a.x<b.x||(a.x===b.x&&a.y<b.y)?a:b,second=first===a?b:a;
    // Former 3-unit bucket silently discarded genuine close lines and could
    // swallow a dashed/CENTER proposal as a SOLID duplicate across tiles.
    // 0.5 input pixels preserves close outlines; actual tile duplicates may
    // still be handled by the conservative overlap reconciler below.
    const quant=Math.max(.05,.5*Math.min(sx,sy));
    return (style||'solid')+':'+
      [first.x,first.y,second.x,second.y].map(n=>Math.round(n/quant)).join(':');
  }
  try{
    for(let k=0;k<finalTiles.length;k++){
      const t=finalTiles[k];
      onProgress?.('Обводка исходного разрешения: участок '+(k+1)+' / '+finalTiles.length);
      cv.width=t.w;cv.height=t.h;
      // Explicit white sheet background: transparent PNG pixels otherwise
      // enter the grayscale worker with RGB=0 and become false black strokes.
      ctx.fillStyle='#fff';ctx.fillRect(0,0,t.w,t.h);
      ctx.drawImage(img,t.x/factor,t.y/factor,t.w/factor,t.h/factor,0,0,t.w,t.h);
      const rgba=ctx.getImageData(0,0,t.w,t.h).data;
      assertActive();
      const data=await new Promise<WorkerResponse>((resolve,reject)=>{
        let settled=false;
        const cleanup=()=>{
          clearTimeout(timeout);
          signal?.removeEventListener('abort',onAbort);
          worker.onmessage=null;worker.onerror=null;
        };
        const finish=(error?:Error,result?:WorkerResponse)=>{
          if(settled)return;settled=true;cleanup();
          if(error)reject(error);else resolve(result!);
        };
        const onAbort=()=>finish(new DOMException('Обработка отменена пользователем','AbortError'));
        const timeout=setTimeout(()=>finish(new Error('Обводка превысила 45 секунд на одном участке. Уменьшите разрешение или используйте быстрый режим.')),45000);
        signal?.addEventListener('abort',onAbort,{once:true});
        worker.onmessage=(ev:MessageEvent<WorkerResponse>)=>finish(undefined,ev.data);
        worker.onerror=ev=>finish(new Error(ev.message));
        try{
          if(signal?.aborted){onAbort();return;}
          // Move tile bytes instead of duplicating ~6 MB per tile in memory.
          worker.postMessage({rgba,width:t.w,height:t.h,scale:1,minLength:Math.max(7,minLength*factor)},[rgba.buffer]);
        }catch(err){finish(err instanceof Error?err:new Error(String(err)));}
      });
      assertActive();
      if(data.error)throw new Error(data.error);
      circularDuplicates+=data.circleStrokeDuplicates||0;
      inkDuplicates+=data.inkStrokeDuplicates||0;
      centerlineAdjusted+=data.centerlineAdjusted||0;
      for(const l of data.lines||[]){
        const a={x:(t.x+l.a.x)*sx,y:(t.y+l.a.y)*sy};
        const b={x:(t.x+l.b.x)*sx,y:(t.y+l.b.y)*sy};
        const key=lineKey(a,b,l.lineStyle);if(seen.has(key))continue;seen.add(key);
        const e=entity('line',[a,b],'Автообводка','trace');e.confidence=l.confidence;
        if(l.inkSupport!==undefined&&l.blankRunRatio!==undefined)
          e.scanEvidence={inkSupport:l.inkSupport,blankRunRatio:l.blankRunRatio,
            patternMarks:l.patternMarks};
        if(l.lineStyle)e.lineStyle=l.lineStyle;
        e.reason='Обводка: эвристический балл, опора на исходный штрих '+(l.inkSupport===undefined?'не измерена':Math.round(l.inkSupport*100)+'%')+
          '; неподтверждённый интервал '+(l.blankRunRatio===undefined?'не измерен':Math.round(l.blankRunRatio*100)+'%')+
          ' длины. '+(l.lineStyle==='center'?'Кандидат осевой (штрихпунктирной) линии. ':l.lineStyle==='dashed'?'Кандидат штриховой линии. ':'')+
          'Проверить по оригиналу.';
        lines.push(e);
      }
      for(const c of data.circles||[]){
        const center={x:(t.x+c.x)*sx,y:(t.y+c.y)*sy};
        const radius=c.radius*(sx+sy)/2;
        const key='circle:'+Math.round(center.x/3)+':'+Math.round(center.y/3)+':'+Math.round(radius/3);
        if(seen.has(key))continue;seen.add(key);
        const e=entity('circle',[center],'Автообводка','trace');e.center=center;e.radius=radius;e.confidence=c.confidence;circles.push(e);
      }
    }
    // Suppress true overlap duplicates; never bridge missing scan evidence.
    const scalePx=Math.max(sx,sy);
    const reconciled=quality==='detailed'
      ?consolidateScanLines(lines,.85*scalePx,.15*scalePx)
      :{entities:lines,removed:0,candidates:lines.length};
    if(reconciled.warning)warnings.push(reconciled.warning);
    if(reconciled.entities.length+circles.length>30000)warnings.push('Лимит 30 000 объектов: часть найденных отрезков не добавлена. Разбейте чертёж на листы.');
    return {entities:[...reconciled.entities,...circles].slice(0,30000),warnings,sampledScale:factor,
      note:'Детальная обводка: '+reconciled.entities.length+' отрезков ('+
      reconciled.removed+' перекрывающихся объединено, '+circularDuplicates+
      ' круговых повторов и '+inkDuplicates+' повторов штриха исключено; '+centerlineAdjusted+
      ' гипотез смещены на центр исходной краски) и '+circles.length+
      ' окружностей ('+finalTiles.length+' участков, '+fullWidth+'×'+fullHeight+' пикс.). Требуется проверка.'+
      (warnings.length?' ВНИМАНИЕ: '+warnings.join('; '):'')};
  }finally{worker.terminate();}
}
