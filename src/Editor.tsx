import {useState,useEffect,useRef,useCallback} from 'react';
import {entity,type CadProject,type Entity,type Point,type Sheet,type Tool} from './model';
import {dist,sub,add,snapPoint,findHit,measure} from './geometry';
import {drawScene,type Camera} from './render';
interface Props {
  sheet:Sheet;project:CadProject;tool:Tool;selected:string|null;onSelect:(v:string|null)=>void;
  onCreate:(e:Entity)=>void;onMove:(e:Entity,delta:Point)=>void;onCalibrate:(factor:number)=>void;
  onMessage:(message:string)=>void;source:boolean;compare:boolean;grid:boolean;snap:boolean;
}
export default function Editor({sheet,project,tool,selected,onSelect,onCreate,onMove,onCalibrate,onMessage,source,compare,grid,snap}:Props){
  const canvas=useRef<HTMLCanvasElement>(null),frame=useRef<HTMLDivElement>(null);
  const [size,setSize]=useState({w:1000,h:700}),[camera,setCamera]=useState<Camera>({x:0,y:0,w:1200,h:850});
  const [image,setImage]=useState<HTMLImageElement|undefined>(),[draft,setDraft]=useState<Point[]>([]),[cursor,setCursor]=useState<Point|null>(null),[drag,setDrag]=useState<Point|null>(null);
  const pointer=useRef<{type:'pan'|'move';x:number;y:number;world:Point}|null>(null),camRef=useRef(camera),imageRef=useRef(sheet.image);
  useEffect(()=>{camRef.current=camera;},[camera]);
  useEffect(()=>{const r=frame.current;if(!r)return;const obs=new ResizeObserver(()=>setSize({w:Math.max(250,r.clientWidth),h:Math.max(250,r.clientHeight)}));obs.observe(r);return ()=>obs.disconnect();},[]);
  useEffect(()=>{const aspect=size.w/size.h;const w=Math.max(sheet.width*1.07,sheet.height*aspect*1.07);setCamera({x:(sheet.width-w)/2,y:(sheet.height-w/aspect)/2,w,h:w/aspect});setDraft([]);onSelect(null);},[sheet.id,size.w,size.h]);
  useEffect(()=>{if(sheet.image===imageRef.current&&image)return;imageRef.current=sheet.image;let cancelled=false;if(!sheet.image){setImage(undefined);return;}const img=new Image();img.src=sheet.image;img.decode().then(()=>{if(!cancelled)setImage(img);}).catch(()=>{if(!cancelled)setImage(undefined);});return()=>{cancelled=true;};},[sheet.image]);
  useEffect(()=>{const cv=canvas.current;if(!cv)return;const dpr=Math.min(window.devicePixelRatio||1,2);cv.width=Math.round(size.w*dpr);cv.height=Math.round(size.h*dpr);const ctx=cv.getContext('2d');if(!ctx)return;drawScene(ctx,size.w,size.h,dpr,sheet,project.layers,camera,image,{source,compare,grid,selected,draft,cursor,drag});},[size,sheet,project.layers,camera,image,source,compare,grid,selected,draft,cursor,drag]);
  const toWorld=useCallback((ev:React.PointerEvent<HTMLCanvasElement>|React.WheelEvent<HTMLCanvasElement>):Point=>{
    const rect=ev.currentTarget.getBoundingClientRect();return {x:camera.x+(ev.clientX-rect.left)*camera.w/rect.width,y:camera.y+(ev.clientY-rect.top)*camera.h/rect.height};
  },[camera]);
  const tol=12*camera.w/size.w;
  const workingEntities=sheet.entities.filter(e=>{const l=project.layers.find(l=>l.name===e.layer);return !l||l.visible&&!l.locked;});
  const takePoint=(p:Point)=>snap?snapPoint(p,workingEntities,Math.max(2,tol),grid?Math.max(1,Math.pow(10,Math.floor(Math.log10(Math.max(1,40*camera.w/size.w))))):0):p;
  function finish(points:Point[],kind:'polyline'|'hatch'){if(points.length<2){setDraft([]);return;}const e=entity(kind,points,kind==='hatch'?'Штриховка':'Контуры');e.closed=kind==='hatch';onCreate(e);setDraft([]);}
  function down(ev:React.PointerEvent<HTMLCanvasElement>){
    ev.currentTarget.setPointerCapture(ev.pointerId);const p=takePoint(toWorld(ev));
    if(tool==='pan'||ev.button===1||ev.button===2){pointer.current={type:'pan',x:ev.clientX,y:ev.clientY,world:p};return;}
    if(tool==='select'){
      const found=findHit(p,workingEntities,tol);onSelect(found?.id||null);if(found)pointer.current={type:'move',x:ev.clientX,y:ev.clientY,world:toWorld(ev)};return;
    }
    if(tool==='text'){
      const text=window.prompt('Текст надписи','Текст');if(!text)return;const e=entity('text',[p],'Текст');e.text=text;e.size=sheet.calibrated?3.5:Math.max(12,sheet.width/160);onCreate(e);return;
    }
    if(tool==='table'||tool==='stamp'){
      const e=entity(tool,[p],'Текст');e.rows=tool==='stamp'?5:3;e.cols=tool==='stamp'?4:3;e.width=tool==='stamp'?185:Math.max(100,sheet.width*.16);e.height=tool==='stamp'?55:Math.max(60,sheet.height*.11);e.text=tool==='stamp'?'Основная надпись':'';onCreate(e);return;
    }
    const pts=[...draft,p];
    if(tool==='polyline'||tool==='hatch'){setDraft(pts);return;}
    if(tool==='arc'){
      if(pts.length<3){setDraft(pts);return;}
      const [center,a,b]=pts;const e=entity('arc',[center,a,b]);e.center=center;e.radius=dist(center,a);e.startAngle=Math.atan2(a.y-center.y,a.x-center.x);e.endAngle=Math.atan2(b.y-center.y,b.x-center.x);if(e.radius>0)onCreate(e);setDraft([]);return;
    }
    if(pts.length<2){setDraft(pts);return;}
    const [a,b]=pts;setDraft([]);
    if(dist(a,b)<1e-5)return;
    if(tool==='measure'){onMessage('Расстояние: '+measure(a,b)+(sheet.calibrated?'':' (масштаб не проверен)'));return;}
    if(tool==='calibrate'){const s=window.prompt('Укажите фактическое расстояние между точками в миллиметрах',String(Math.round(dist(a,b))));if(s===null)return;const mm=Number(s.replace(',','.'));if(!Number.isFinite(mm)||mm<=0){onMessage('Ошибка: требуется положительное число в мм');return;}onCalibrate(mm/dist(a,b));return;}
    const kind=tool as Entity['kind'],layer=kind==='dimension'?'Размеры':kind==='axis'?'Оси':kind==='leader'?'Текст':'Контуры';
    const e=entity(kind,[a,b],layer);
    if(kind==='circle'){e.center=a;e.radius=dist(a,b);}
    if(kind==='dimension'){e.offset=Math.max(10,dist(a,b)*.12);e.size=sheet.calibrated?3.5:Math.max(12,sheet.width/160);}
    if(kind==='leader'){e.text=window.prompt('Текст выноски','')||'';e.size=sheet.calibrated?3.5:Math.max(12,sheet.width/160);}
    onCreate(e);
  }
  function move(ev:React.PointerEvent<HTMLCanvasElement>){
    const p=takePoint(toWorld(ev));setCursor(p);
    if(!pointer.current)return;
    if(pointer.current.type==='pan'){
      const dx=(ev.clientX-pointer.current.x)*camera.w/size.w,dy=(ev.clientY-pointer.current.y)*camera.h/size.h;
      setCamera(c=>({...c,x:c.x-dx,y:c.y-dy}));pointer.current.x=ev.clientX;pointer.current.y=ev.clientY;
    }else if(pointer.current.type==='move'){setDrag(sub(toWorld(ev),pointer.current.world));}
  }
  function up(){
    if(pointer.current?.type==='move'&&drag&&selected){const e=sheet.entities.find(e=>e.id===selected);if(e&&dist(drag,{x:0,y:0})>1e-4)onMove(e,drag);}
    pointer.current=null;setDrag(null);
  }
  function wheel(ev:React.WheelEvent<HTMLCanvasElement>){
    const p=toWorld(ev),factor=Math.exp(Math.max(-.45,Math.min(.45,ev.deltaY*.001)));
    setCamera(c=>{const w=Math.max(.01,Math.min(5e8,c.w*factor)),h=w*size.h/size.w;const x=p.x-(p.x-c.x)*(w/c.w),y=p.y-(p.y-c.y)*(h/c.h);return {x,y,w,h};});
  }
  useEffect(()=>{function key(ev:KeyboardEvent){if(ev.key==='Escape'){setDraft([]);pointer.current=null;setDrag(null);}if(ev.key==='Enter'&&draft.length>=2&&(tool==='hatch'||tool==='polyline')){finish(draft,tool);}}
    window.addEventListener('keydown',key);return ()=>window.removeEventListener('keydown',key);},[draft,tool]);
  const zoom=(f:number)=>setCamera(c=>{const w=c.w*f,h=c.h*f;return {x:c.x+(c.w-w)/2,y:c.y+(c.h-h)/2,w,h};});
  return <div className="viewport" ref={frame}>
    <canvas ref={canvas} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onDoubleClick={()=>{if(tool==='polyline'||tool==='hatch')finish(draft,tool);}} onWheel={wheel} onContextMenu={e=>e.preventDefault()} style={{cursor:tool==='pan'?'grab':tool==='select'?'default':'crosshair'}} aria-label="Редактор CAD"/>
    <div className="view-controls"><button title="Увеличить" onClick={()=>zoom(.8)}>+</button><button title="Уменьшить" onClick={()=>zoom(1.25)}>−</button><button title="Показать весь лист" onClick={()=>{const aspect=size.w/size.h,w=Math.max(sheet.width*1.07,sheet.height*aspect*1.07);setCamera({x:(sheet.width-w)/2,y:(sheet.height-w/aspect)/2,w,h:w/aspect});}}>⌗</button></div>
    <div className="coords">{cursor?('X '+cursor.x.toFixed(1)+' · Y '+cursor.y.toFixed(1)):'X — · Y —'} <span>{sheet.calibrated?'мм':'ед. скана'}</span></div>
    {draft.length>0&&<div className="hint">Точек: {draft.length} · {tool==='hatch'||tool==='polyline'?'двойной щелчок / Enter — закончить':'выберите следующую точку'} · Esc — отмена</div>}
  </div>;
}