import {entity,type Entity,type Sheet} from './model';
import {repairPdfText} from './textRepair';
type Coord=[number,number];
interface OcrLine {text:string;confidence:number;box:[number,number,number,number];}
interface ScanLine {a:Coord;b:Coord;confidence:number;}
interface ScanCircle {center:Coord;radius:number;confidence:number;}
interface ScanPoly {points:Coord[];confidence:number;}
interface AdvancedResponse {width:number;height:number;engine:string;texts:OcrLine[];lines:ScanLine[];circles:ScanCircle[];polygons?:ScanPoly[];warnings?:string[];}
export interface AdvancedResult {entities:Entity[];note:string;}
export function validateAdvancedEndpoint(value:string):string {
  const url=new URL(value.trim());
  const local=['127.0.0.1','localhost','[::1]'].includes(url.hostname);
  if(url.protocol!=='https:'&&!(local&&url.protocol==='http:'))throw new Error('Для удалённого сервера обязательно HTTPS. HTTP допускается только на localhost.');
  if(url.username||url.password||url.hash||url.search)throw new Error('Укажите URL сервиса без пароля или параметров.');
  return url.href.replace(/\/$/,'');
}
export function decodeAdvancedResponse(sheet:Sheet,result:AdvancedResponse):AdvancedResult{
  if(!Number.isFinite(result.width)||!Number.isFinite(result.height)||result.width<2||result.height<2||result.width>30000||result.height>30000)throw new Error('Неверный ответ сервера (размер изображения)');
  const sx=sheet.width/result.width,sy=sheet.height/result.height;
  const entities:Entity[]=[];let corrected=0;
  for(const t of (result.texts||[]).slice(0,20000)){
    if(!t.text||!Array.isArray(t.box)||t.box.length!==4)continue;
    const [x0,y0,x1,y1]=t.box;if(![x0,y0,x1,y1].every(Number.isFinite))continue;
    const e=entity('text',[{x:x0*sx,y:y1*sy}],'OCR','ocr');
    const repair=repairPdfText(t.text);
    e.text=repair.text;e.size=Math.max(2,(y1-y0)*sy*.75);
    e.bbox={x0:x0*sx,y0:y0*sy,x1:x1*sx,y1:y1*sy};
    e.confidence=Math.max(0,Math.min(1,t.confidence||0))*(repair.changed?.7:1);
    e.reason='PaddleOCR: автоматическое распознавание, требуется проверка'+(repair.changed?'; исправлена предполагаемая кодировка':'');
    if(repair.changed)corrected++;entities.push(e);
  }
  for(const l of (result.lines||[]).slice(0,30000)){
    if(!l.a||!l.b||![...l.a,...l.b].every(Number.isFinite))continue;
    const e=entity('line',[{x:l.a[0]*sx,y:l.a[1]*sy},{x:l.b[0]*sx,y:l.b[1]*sy}],'Автообводка','trace');
    e.confidence=Math.max(0,Math.min(1,l.confidence||0));e.reason='OpenCV: фрагмент автоматически найден, проверить';
    entities.push(e);
  }
  for(const c of (result.circles||[]).slice(0,500)){
    if(!c.center||![...c.center,c.radius].every(Number.isFinite)||c.radius<=0)continue;
    const center={x:c.center[0]*sx,y:c.center[1]*sy};
    const e=entity('circle',[center],'Автообводка','trace');e.center=center;e.radius=c.radius*(sx+sy)/2;
    e.confidence=Math.max(0,Math.min(1,c.confidence||0));entities.push(e);
  }
  for(const p of (result.polygons||[]).slice(0,1000)){
    if(!Array.isArray(p.points)||p.points.length<3||p.points.length>40||!p.points.every(t=>t.length===2&&t.every(Number.isFinite)))continue;
    const e=entity('polyline',p.points.map(pt=>({x:pt[0]*sx,y:pt[1]*sy})),'Автообводка','trace');
    e.closed=true;e.confidence=Math.max(0,Math.min(1,p.confidence||0));entities.push(e);
  }
  return {entities,note:result.engine+': '+entities.length+' новых элементов, исправлено надписей: '+corrected+
    '. Проверьте результат по подложке.'+(result.warnings?.length?' Предупреждения: '+result.warnings.join('; '):'')};
}
export async function recognizeAdvanced(sheet:Sheet,endpoint:string,token=''):Promise<AdvancedResult>{
  if(!sheet.image)throw new Error('На листе нет растровой подложки');
  const base=validateAdvancedEndpoint(endpoint);
  // The sheet image is transmitted ONLY after an explicit user interaction and confirmation.
  const resp=await fetch(sheet.image);
  const file=await resp.blob();
  const form=new FormData();form.append('image',file,'cadrecon-page.png');
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),240000);
  try {
    const request:RequestInit & {targetAddressSpace?:'loopback'}={
      method:'POST',body:form,
      headers:token?{'Authorization':'Bearer '+token}:{},signal:controller.signal
    };
    // Chrome 145+ asks for permission to reach a loopback service from a public HTTPS site.
    if(['127.0.0.1','localhost','[::1]'].includes(new URL(base).hostname)
       &&typeof location!=='undefined'&&location.protocol==='https:'){
      request.targetAddressSpace='loopback';
    }
    const res=await fetch(base+'/recognize',request);
    if(!res.ok)throw new Error('Сервис распознавания: HTTP '+res.status+' '+(await res.text()).slice(0,300));
    return decodeAdvancedResponse(sheet,await res.json() as AdvancedResponse);
  }finally{clearTimeout(timeout);}
}