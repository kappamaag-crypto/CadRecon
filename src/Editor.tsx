import {useState,useEffect,useRef,useCallback} from 'react';
import type {PointerEvent,WheelEvent} from 'react';
import {entity,type CadProject,type Entity,type Point,type Sheet,type Tool} from './model';
import {dist,sub,add,snapPoint,findHit,measure} from './geometry';
import {drawScene,type Camera} from './render';
import {trimLine,extendLine,offsetLine,breakLine,chamferLines,filletLines,joinCadEntities,type OperationResult} from './cadOperations';
import {mirrorEntity,stretchVertex} from './geometryTransform';
import type {EskdType} from './model';
import type {SheetRect} from './ocrRegion';
interface Props {
  sheet:Sheet;project:CadProject;tool:Tool;selected:string|null;onSelect:(v:string|null)=>void;
  focusTarget?:{id:string;token:number};
  onCreate:(e:Entity)=>void;onMove:(e:Entity,delta:Point)=>void;
  onOperation:(result:OperationResult)=>void;onCalibrate:(factor:number)=>void;
  onOcrRegion:(rect:SheetRect)=>void;
  onMessage:(message:string)=>void;source:boolean;compare:boolean;grid:boolean;snap:boolean;
  symbolType:EskdType;symbolText:string;
}
export default function Editor({sheet,project,tool,selected,onSelect,onCreate,onMove,onOperation,onCalibrate,onMessage,source,compare,grid,snap,symbolType,symbolText,focusTarget,onOcrRegion}:Props){
  const canvas=useRef<HTMLCanvasElement>(null),frame=useRef<HTMLDivElement>(null);
  const [size,setSize]=useState({w:1000,h:700}),[camera,setCamera]=useState<Camera>({x:0,y:0,w:1200,h:850});
  const [image,setImage]=useState<HTMLImageElement|undefined>(),[draft,setDraft]=useState<Point[]>([]),[cursor,setCursor]=useState<Point|null>(null),[drag,setDrag]=useState<Point|null>(null);
  const [pending,setPending]=useState<{id:string;click:Point;vertex?:number}|null>(null);
  const pointer=useRef<{type:'pan'|'move';x:number;y:number;world:Point}|null>(null),camRef=useRef(camera),imageRef=useRef(sheet.image);
  useEffect(()=>{camRef.current=camera;},[camera]);
  useEffect(()=>{setPending(null);},[tool,sheet.id]);
  useEffect(()=>{const r=frame.current;if(!r)return;const obs=new ResizeObserver(()=>setSize({w:Math.max(250,r.clientWidth),h:Math.max(250,r.clientHeight)}));obs.observe(r);return ()=>obs.disconnect();},[]);
  useEffect(()=>{const aspect=size.w/size.h;const w=Math.max(sheet.width*1.07,sheet.height*aspect*1.07);setCamera({x:(sheet.width-w)/2,y:(sheet.height-w/aspect)/2,w,h:w/aspect});setDraft([]);},[sheet.id,sheet.width,sheet.height,size.w,size.h]);
  useEffect(()=>{
    if(!focusTarget)return;
    const target=sheet.entities.find(e=>e.id===focusTarget.id);
    if(!target)return;
    const raw=target.bbox?[
      {x:target.bbox.x0,y:target.bbox.y0},{x:target.bbox.x1,y:target.bbox.y1},
    ]:[...target.points,...(target.center?[target.center]:[])];
    if(!raw.length)return;
    const xs=raw.map(p=>p.x),ys=raw.map(p=>p.y);
    if(target.center&&target.radius){
      xs.push(target.center.x-target.radius,target.center.x+target.radius);
      ys.push(target.center.y-target.radius,target.center.y+target.radius);
    }
    const cx=(Math.min(...xs)+Math.max(...xs))/2,cy=(Math.min(...ys)+Math.max(...ys))/2;
    const aspect=Math.max(.1,size.w/Math.max(1,size.h));
    const w=Math.max(25,Math.min(sheet.width*1.07,
      Math.max(sheet.width*.24,(Math.max(...xs)-Math.min(...xs))*3,
        (Math.max(...ys)-Math.min(...ys))*3*aspect)));
    setCamera({x:cx-w/2,y:cy-w/(2*aspect),w,h:w/aspect});
  },[focusTarget?.token,sheet.id]);
  useEffect(()=>{if(sheet.image===imageRef.current&&image)return;imageRef.current=sheet.image;let cancelled=false;if(!sheet.image){setImage(undefined);return;}const img=new Image();img.src=sheet.image;img.decode().then(()=>{if(!cancelled)setImage(img);}).catch(()=>{if(!cancelled)setImage(undefined);});return()=>{cancelled=true;};},[sheet.image]);
  useEffect(()=>{const cv=canvas.current;if(!cv)return;const dpr=Math.min(window.devicePixelRatio||1,2);cv.width=Math.round(size.w*dpr);cv.height=Math.round(size.h*dpr);const ctx=cv.getContext('2d');if(!ctx)return;drawScene(ctx,size.w,size.h,dpr,sheet,project.layers,camera,image,{source,compare,grid,selected,draft,cursor,drag,
    roi:tool==='ocr-region'&&draft[0]&&cursor?{a:draft[0],b:cursor}:undefined});},[size,sheet,project.layers,camera,image,source,compare,grid,selected,draft,cursor,drag]);
  const toWorld=useCallback((ev:PointerEvent<HTMLCanvasElement>|WheelEvent<HTMLCanvasElement>):Point=>{
    const rect=ev.currentTarget.getBoundingClientRect();return {x:camera.x+(ev.clientX-rect.left)*camera.w/rect.width,y:camera.y+(ev.clientY-rect.top)*camera.h/rect.height};
  },[camera]);
  const tol=12*camera.w/size.w;
  const workingEntities=sheet.entities.filter(e=>{const l=project.layers.find(l=>l.name===e.layer);return !l||l.visible&&!l.locked;});
  const takePoint=(p:Point)=>snap?snapPoint(p,workingEntities,Math.max(2,tol),grid?Math.max(1,Math.pow(10,Math.floor(Math.log10(Math.max(1,40*camera.w/size.w))))):0):p;
  function finish(points:Point[],kind:'polyline'|'hatch'){if(points.length<2){setDraft([]);return;}const e=entity(kind,points,kind==='hatch'?'Штриховка':'Контуры');e.closed=kind==='hatch';onCreate(e);setDraft([]);}
  function down(ev:PointerEvent<HTMLCanvasElement>){
    ev.currentTarget.setPointerCapture(ev.pointerId);const raw=toWorld(ev),p=takePoint(raw);
    if(tool==='pan'||ev.button===1||ev.button===2){pointer.current={type:'pan',x:ev.clientX,y:ev.clientY,world:p};return;}
    if(tool==='select'){
      const found=findHit(p,workingEntities,tol);onSelect(found?.id||null);if(found)pointer.current={type:'move',x:ev.clientX,y:ev.clientY,world:toWorld(ev)};return;
    }
    if(tool==='mirror'){
      const chosen=workingEntities.find(e=>e.id===selected);
      if(!chosen){onMessage('MIRROR: сначала выделите LINE/POLYLINE/CIRCLE/POINT.');return;}
      if(!pending){setPending({id:chosen.id,click:p});onMessage('MIRROR: начало оси задано. Укажите вторую точку оси (Esc — отмена).');return;}
      setPending(null);
      const result=mirrorEntity(chosen,pending.click,p);
      if(!result){onMessage('MIRROR: неподдерживаемый объект или ось нулевой длины.');return;}
      onOperation(result);return;
    }
    if(tool==='stretch'){
      const chosen=workingEntities.find(e=>e.id===selected);
      if(!chosen||!['line','polyline'].includes(chosen.kind)){onMessage('STRETCH: сначала выделите LINE или открытую POLYLINE.');return;}
      if(!pending){
        const sorted=chosen.points.map((q,index)=>({index,distance:dist(raw,q)}))
          .sort((a,b)=>a.distance-b.distance);
        if(!sorted.length||sorted[0].distance>tol){onMessage('STRETCH: нажмите точно около вершины выделенного объекта.');return;}
        setPending({id:chosen.id,click:raw,vertex:sorted[0].index});
        onMessage('STRETCH: вершина выбрана. Укажите новое положение (Esc — отмена).');return;
      }
      setPending(null);
      const result=pending.vertex===undefined?null:stretchVertex(chosen,pending.vertex,p);
      if(!result){onMessage('STRETCH: новая вершина создаёт нулевой или самопересекающийся контур.');return;}
      onOperation(result);return;
    }
    if(tool==='join'){
      const found=findHit(raw,workingEntities.filter(e=>(e.kind==='line'||e.kind==='polyline')&&!e.closed),tol);
      if(!found){onMessage('JOIN: выберите два открытых отрезка/полилинии одного слоя.');return;}
      if(!pending){setPending({id:found.id,click:raw});onMessage('JOIN: выбран первый объект. Укажите второй с общим концом; Esc — отмена.');return;}
      const first=workingEntities.find(e=>e.id===pending.id);
      setPending(null);
      if(!first||first.id===found.id){onMessage('JOIN: нужен другой объект.');return;}
      const operation=joinCadEntities(first,found);
      if(!operation){onMessage('JOIN: концы не совпадают точно, слои различаются или геометрия неоднозначна. Автоматического заполнения зазоров нет.');return;}
      if(window.confirm('JOIN: соединить только точно совпадающие концы выбранных объектов? Второй объект будет удалён, операцию можно отменить через Undo.')){
        onOperation(operation);
      }
      return;
    }
    if(tool==='break'){
      const found=findHit(raw,workingEntities.filter(e=>e.kind==='line'),tol);
      if(!found){onMessage('BREAK: выберите первый и второй пункт удаления НА ОДНОМ отрезке.');return;}
      if(!pending){
        setPending({id:found.id,click:raw});
        onMessage('BREAK: первая точка зафиксирована. Щёлкните вторую точку того же отрезка; Esc — отмена.');
        return;
      }
      setPending(null);
      if(found.id!==pending.id){onMessage('BREAK: обе точки должны принадлежать одному исходному отрезку.');return;}
      const result=breakLine(found,pending.click,raw,tol);
      if(result)onOperation(result);
      else onMessage('BREAK: точки должны лежать внутри прямого отрезка, не совпадать и оставлять обе части.');
      return;
    }
    if(tool==='offset'){
      const found=findHit(raw,workingEntities.filter(e=>e.kind==='line'),tol);
      if(!found){onMessage('OFFSET: укажите прямой отрезок, затем сторону отступа рядом с ним.');return;}
      const units=sheet.calibrated?'миллиметрах':'условных единицах (лист не калиброван)';
      const value=window.prompt('OFFSET: расстояние в '+units,'10');
      if(value===null)return;
      const distance=Number(value.replace(',','.'));
      if(!Number.isFinite(distance)||distance<=0){
        onMessage('OFFSET: требуется положительное расстояние.');return;
      }
      const op=offsetLine(found,distance,raw);
      if(!op){onMessage('OFFSET: нельзя определить сторону. Щёлкните чуть выше или ниже отрезка.');return;}
      onOperation(op);
      return;
    }
    if(['trim','extend','chamfer','fillet'].includes(tool)){
      const found=findHit(raw,workingEntities.filter(e=>e.kind==='line'),tol);
      if(!found){onMessage('Для операции выберите два прямых отрезка.');return;}
      if(!pending){setPending({id:found.id,click:raw});onMessage('CAD: выбран первый отрезок. Укажите второй отрезок.');return;}
      const first=workingEntities.find(e=>e.id===pending.id);
      setPending(null);
      if(!first||first.id===found.id){onMessage('Выберите другой отрезок.');return;}
      let result:OperationResult|null=null;
      if(tool==='trim')result=trimLine(first,found,raw);
      else if(tool==='extend')result=extendLine(first,found,raw);
      else {
        const label=tool==='chamfer'?'Расстояние фаски':'Радиус сопряжения';
        const input=window.prompt(label+' ('+(sheet.calibrated?'мм':'условные единицы')+')','10');
        if(input===null){onMessage('CAD: операция отменена');return;}
        const d=Number(input.replace(',','.'));
        if(!Number.isFinite(d)||d<=0){onMessage('Введите положительное расстояние или радиус.');return;}
        result=tool==='chamfer'?chamferLines(first,found,pending.click,raw,d):
          filletLines(first,found,pending.click,raw,d);
      }
      if(result)onOperation(result);
      else onMessage('CAD: геометрия или выбор стороны не допускает эту операцию. Проверьте пересечение, направление и расстояние.');
      return;
    }
    if(tool==='point'){
      const e=entity('point',[p],'Контуры');e.verified=false;
      e.reason='Создана точка: не означает инженерную проверку';
      onCreate(e);return;
    }

    if(tool==='eskd'){
      const e=entity('eskd',[p],'ЕСКД');
      e.symbol=symbolType;e.text=symbolText;e.size=sheet.calibrated?4:Math.max(8,sheet.width/145);
      e.verified=false;e.reason='Добавлено вручную: проверьте обозначение и позицию по оригиналу';
      onCreate(e);return;
    }
    if(tool==='text'){
      const text=window.prompt('Текст надписи','Текст');if(!text)return;const e=entity('text',[p],'Текст');e.text=text;e.size=sheet.calibrated?3.5:Math.max(12,sheet.width/160);onCreate(e);return;
    }
    if(tool==='table'||tool==='stamp'){
      const e=entity(tool,[p],'Текст');e.rows=tool==='stamp'?5:3;e.cols=tool==='stamp'?4:3;e.width=tool==='stamp'?185:Math.max(100,sheet.width*.16);e.height=tool==='stamp'?55:Math.max(60,sheet.height*.11);e.text=tool==='stamp'?'Основная надпись':'';onCreate(e);return;
    }
    const pts=[...draft,p];
    if(tool==='ocr-region'){
      if(pts.length<2){
        setDraft(pts);onMessage('OCR области: укажите противоположный угол рамки. Esc — отмена.');
        return;
      }
      setDraft([]);
      onOcrRegion({x0:pts[0].x,y0:pts[0].y,x1:pts[1].x,y1:pts[1].y});
      return;
    }
    if(tool==='polyline'||tool==='hatch'){setDraft(pts);return;}
    if(tool==='rectangle'){
      if(pts.length<2){setDraft(pts);return;}
      const [a,b]=pts;setDraft([]);
      if(Math.abs(a.x-b.x)<1e-5||Math.abs(a.y-b.y)<1e-5){
        onMessage('Прямоугольник: требуются ненулевые ширина и высота.');return;
      }
      const e=entity('polyline',[a,{x:b.x,y:a.y},b,{x:a.x,y:b.y}],'Контуры');
      e.closed=true;e.verified=false;e.reason='Прямоугольник создан вручную: проверьте размеры';
      onCreate(e);return;
    }
    if(tool==='dimension-3pt'){
      if(pts.length<3){setDraft(pts);return;}
      setDraft([]);
      const [a,b,placement]=pts,length=dist(a,b);
      if(length<1e-5){onMessage('Размер: две точки не должны совпадать.');return;}
      const normal={x:-(b.y-a.y)/length,y:(b.x-a.x)/length};
      const dim=entity('dimension',[a,b],'Размеры','manual');
      dim.offset=(placement.x-a.x)*normal.x+(placement.y-a.y)*normal.y;
      dim.size=sheet.calibrated?3.5:Math.max(9,sheet.width/180);
      dim.text=sheet.calibrated?Number(length.toFixed(2)).toString():'?';
      dim.reason=sheet.calibrated?'Ручное нанесение размера, требуется сверка с исходным чертежом':
        'Размер по 3 точкам без калибровки: числовое значение скрыто';
      onCreate(dim);return;
    }
    if(tool==='arc'){
      if(pts.length<3){setDraft(pts);return;}
      const [center,a,b]=pts;const e=entity('arc',[center,a,b]);e.center=center;e.radius=dist(center,a);e.startAngle=Math.atan2(a.y-center.y,a.x-center.x);e.endAngle=Math.atan2(b.y-center.y,b.x-center.x);if(e.radius>0)onCreate(e);setDraft([]);return;
    }
    if(pts.length<2){setDraft(pts);return;}
    const [a,b]=pts;setDraft([]);
    if(dist(a,b)<1e-5)return;
    if(tool==='measure'){onMessage('Расстояние: '+measure(a,b,sheet.calibrated));return;}
    if(tool==='calibrate'){const s=window.prompt('Укажите фактическое расстояние между точками в миллиметрах',String(Math.round(dist(a,b))));if(s===null)return;const mm=Number(s.replace(',','.'));if(!Number.isFinite(mm)||mm<=0){onMessage('Ошибка: требуется положительное число в мм');return;}onCalibrate(mm/dist(a,b));return;}
    const kind=(tool==='line-dashed'?'line':tool) as Entity['kind'],layer=kind==='dimension'?'Размеры':kind==='axis'?'Оси':kind==='leader'?'Текст':'Контуры';
    const e=entity(kind,[a,b],layer);
    if(tool==='line-dashed')e.lineStyle='dashed';
    if(kind==='circle'){e.center=a;e.radius=dist(a,b);}
    if(kind==='dimension'){e.offset=Math.max(10,dist(a,b)*.12);e.size=sheet.calibrated?3.5:Math.max(12,sheet.width/160);e.text=sheet.calibrated?Number(dist(a,b).toFixed(2)).toString():'?';}
    if(kind==='leader'){e.text=window.prompt('Текст выноски','')||'';e.size=sheet.calibrated?3.5:Math.max(12,sheet.width/160);}
    onCreate(e);
  }
  function move(ev:PointerEvent<HTMLCanvasElement>){
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
  function wheel(ev:WheelEvent<HTMLCanvasElement>){
    const p=toWorld(ev),factor=Math.exp(Math.max(-.45,Math.min(.45,ev.deltaY*.001)));
    setCamera(c=>{const w=Math.max(.01,Math.min(5e8,c.w*factor)),h=w*size.h/size.w;const x=p.x-(p.x-c.x)*(w/c.w),y=p.y-(p.y-c.y)*(h/c.h);return {x,y,w,h};});
  }
  useEffect(()=>{function key(ev:KeyboardEvent){if(ev.key==='Escape'){setDraft([]);setPending(null);pointer.current=null;setDrag(null);}if(ev.key==='Enter'&&draft.length>=2&&(tool==='hatch'||tool==='polyline')){finish(draft,tool);}}
    window.addEventListener('keydown',key);return ()=>window.removeEventListener('keydown',key);},[draft,tool]);
  const zoom=(f:number)=>setCamera(c=>{const w=c.w*f,h=c.h*f;return {x:c.x+(c.w-w)/2,y:c.y+(c.h-h)/2,w,h};});
  return <div className="viewport" ref={frame}>
    <canvas ref={canvas} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onDoubleClick={()=>{if(tool==='polyline'||tool==='hatch')finish(draft,tool);}} onWheel={wheel} onContextMenu={e=>e.preventDefault()} style={{cursor:tool==='pan'?'grab':tool==='select'?'default':'crosshair'}} aria-label="Редактор CAD"/>
    <div className="view-controls"><button title="Увеличить" onClick={()=>zoom(.8)}>+</button><button title="Уменьшить" onClick={()=>zoom(1.25)}>−</button><button title="Показать весь лист" onClick={()=>{const aspect=size.w/size.h,w=Math.max(sheet.width*1.07,sheet.height*aspect*1.07);setCamera({x:(sheet.width-w)/2,y:(sheet.height-w/aspect)/2,w,h:w/aspect});}}>⌗</button></div>
    <div className="coords">{cursor?('X '+cursor.x.toFixed(1)+' · Y '+cursor.y.toFixed(1)):'X — · Y —'} <span>{sheet.calibrated?'мм':'ед. скана'}</span></div>
    {draft.length>0&&<div className="hint">Точек: {draft.length} · {tool==='ocr-region'?'OCR: укажите второй угол прямоугольной области':tool==='dimension-3pt'?'Две точки измерения, затем третья точка размещения размерной линии':tool==='hatch'||tool==='polyline'?'двойной щелчок / Enter — закончить':'выберите следующую точку'} · Esc — отмена</div>}
    {pending&&<div className="hint">{tool==='stretch'?'STRETCH: укажите новое положение вершины':tool==='mirror'?'MIRROR: укажите конец оси':tool==='break'?'BREAK: первая точка · Укажите вторую на той же линии':tool==='join'?'JOIN: выбран первый объект · Укажите второй с общим концом':'Выбран опорный отрезок · Укажите второй отрезок'} · Esc — отмена</div>}
  </div>;
}