import {entity,type Entity,type EskdType,type Point} from './model';

export const ESKD_SYMBOLS: {id:EskdType;label:string;defaultText:string}[] = [
  {id:'weld',label:'Условное обозначение сварного шва',defaultText:'6'},
  {id:'roughness',label:'Шероховатость Ra / Rz',defaultText:'Ra 3,2'},
  {id:'datum',label:'База (datum)',defaultText:'A'},
  {id:'geotol',label:'Рамка геометрического допуска',defaultText:'⌖|0,1|A'},
  {id:'section',label:'Сечение / разрез',defaultText:'А-А'},
  {id:'detail',label:'Узел / вид',defaultText:'А'},
  {id:'elevation',label:'Высотная отметка',defaultText:'+0,000'},
  {id:'diameter',label:'Диаметр',defaultText:'⌀20'},
  {id:'radius',label:'Радиус',defaultText:'R20'},
  {id:'thread',label:'Резьба',defaultText:'M16'},
  {id:'slope',label:'Уклон',defaultText:'1:10'},
  {id:'taper',label:'Конусность',defaultText:'1:10'}
];
const pt=(x:number,y:number):Point=>({x,y});
function line(a:Point,b:Point,layer='ЕСКД') {return entity('line',[a,b],layer);}
function poly(points:Point[],layer='ЕСКД',closed=false){const e=entity('polyline',points,layer);e.closed=closed;return e;}
function circle(center:Point,radius:number,layer='ЕСКД') {const e=entity('circle',[center],layer);e.center=center;e.radius=radius;return e;}
function text(p:Point,value:string,size:number,layer='ЕСКД'){const e=entity('text',[p],layer);e.text=value;e.size=size;return e;}
/** CAD symbol geometry is generated from a single editable semantic entity.
 * Export as an INSERT block, so the mark can be edited as a block in CAD. */
export function eskdParts(mark:Entity,local=false):Entity[]{
  if(mark.kind!=='eskd')return [];
  const origin=local?pt(0,0):mark.points[0];
  if(!origin)return [];
  const h=Math.max(1,mark.size||4),x=origin.x,y=origin.y,s=mark.text||'';
  const p=(dx:number,dy:number)=>pt(x+dx*h,y+dy*h);
  const L=(a:number,b:number,c:number,d:number)=>line(p(a,b),p(c,d),mark.layer);
  const P=(coords:number[][],closed=false)=>poly(coords.map(v=>p(v[0],v[1])),mark.layer,closed);
  const T=(dx:number,dy:number,value=s,height=.8)=>text(p(dx,dy),value,h*height,mark.layer);
  const C=(dx:number,dy:number,r:number)=>circle(p(dx,dy),r*h,mark.layer);
  switch(mark.symbol){
    case 'weld':return [L(0,0,3,-2),L(3,-2,12,-2),P([[4,-2],[5,-3.5],[6,-2]],true),T(7,-2.4,s,.8)];
    case 'roughness':return [P([[0,0],[.9,.9],[2.2,-1.6],[3.2,-.8]]),L(3.2,-.8,5,-.8),T(5.3,-.8,s,.7)];
    case 'datum':return [P([[0,-1.2],[2,-1.2],[2,1],[0,1]],true),T(.55,.45,s,.9)];
    case 'geotol': {
      const segments=s.split('|').slice(0,4);
      const widths=segments.map(w=>Math.max(2.2,w.length*.72+1));
      const width=widths.reduce((a,b)=>a+b,0);
      const out=[P([[0,-1.2],[width,-1.2],[width,.75],[0,.75]],true)];
      let at=0;for(let i=0;i<segments.length;i++){out.push(T(at+.35,.2,segments[i],.75));at+=widths[i];if(i<segments.length-1)out.push(L(at,-1.2,at,.75));}return out;
    }
    case 'section':return [C(1.6,0,1.45),L(1.6,1.45,1.6,3),P([[1.6,3],[1.05,2.35],[2.15,2.35]],true),T(0,-.15,s,.72)];
    case 'detail':return [C(1.6,0,1.6),T(.65,.3,s,.85)];
    case 'elevation':return [P([[0,0],[1,-1],[2,0]],true),L(2,0,4,0),T(4.4,-.1,s,.8)];
    case 'diameter':return [C(1,0,.9),L(.2,.9,1.8,-.9),T(2.3,.25,s,.8)];
    case 'radius':case 'thread':return [T(0,0,s,1)];
    case 'slope':return [P([[0,1],[0,-1],[2.5,1]],true),T(3,0,s,.8)];
    case 'taper':return [L(0,.5,3,-.7),L(0,-.5,3,.7),T(3.5,0,s,.8)];
    default:return [T(0,0,s,1)];
  }
}

export function classifyESKDText(value:string):{symbol:EskdType;confidence:number;reason:string}|null {
  const s=value.trim().replace(/∅/g,'⌀');
  if(/^(?:Ra|Rz)\s*\d+(?:[.,]\d+)?$/i.test(s))return {symbol:'roughness',confidence:.78,reason:'Распознано обозначение параметра шероховатости'};
  if(/^(?:⌀|Ø|Ф)\s*\d+(?:[.,]\d+)?$/i.test(s))return {symbol:'diameter',confidence:.82,reason:'Распознан префикс диаметра'};
  if(/^R\s*\d+(?:[.,]\d+)?$/i.test(s))return {symbol:'radius',confidence:.83,reason:'Распознан префикс радиуса'};
  if(/^M\s*\d+(?:[.,]\d+)?(?:\s*[x×х]\s*\d+(?:[.,]\d+)?)?$/i.test(s))return {symbol:'thread',confidence:.82,reason:'Распознан префикс метрической резьбы'};
  if(/^[+-]\s*\d+[.,]\d{3}$/.test(s))return {symbol:'elevation',confidence:.63,reason:'Возможная высотная отметка: необходима проверка'};
  if(/^([А-ЯA-Z])\s*[-–—]\s*\1$/i.test(s))return {symbol:'section',confidence:.6,reason:'Возможное обозначение разреза'};
  return null;
}
export function detectESKDLabels(entities:Entity[]):Entity[]{
  const found:Entity[]=[];
  for(const source of entities){
    if(source.kind!=='text'||!source.text||source.origin==='manual'||source.verified)continue;
    const result=classifyESKDText(source.text);
    if(!result)continue;
    if((source.confidence??100)<45)continue;
    const mark=entity('eskd',[{...source.points[0]}],'ЕСКД',source.origin);
    mark.symbol=result.symbol;mark.text=source.text;mark.size=source.size||4;
    mark.reason=result.reason;mark.sourceId=source.id;mark.verified=false;
    const conf=(source.confidence??100)>1?(source.confidence??100)/100:(source.confidence??1);
    mark.confidence=Number(Math.min(.85,result.confidence*conf).toFixed(3));
    found.push(mark);
  }
  return found;
}
