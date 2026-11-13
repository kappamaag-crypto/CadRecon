import type {Entity,Point,Sheet,Layer} from './model';
import {add,mid,dist,mul,sub,dimensionLength} from './geometry';
import {eskdParts} from './eskd';
export interface Camera {x:number;y:number;w:number;h:number;}
const pi=Math.PI;
function poly(ctx:CanvasRenderingContext2D,points:Point[],close=false){if(!points.length)return;ctx.beginPath();ctx.moveTo(points[0].x,points[0].y);for(let i=1;i<points.length;i++)ctx.lineTo(points[i].x,points[i].y);if(close)ctx.closePath();}
function arrow(ctx:CanvasRenderingContext2D,p:Point,d:Point,unit:number){const n={x:-d.y,y:d.x};ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(p.x+d.x*unit+n.x*unit*.23,p.y+d.y*unit+n.y*unit*.23);ctx.lineTo(p.x+d.x*unit-n.x*unit*.23,p.y+d.y*unit-n.y*unit*.23);ctx.closePath();ctx.fill();}
function text(ctx:CanvasRenderingContext2D,p:Point,s:string,h:number){ctx.save();ctx.font=Math.max(2,h)+'px Arial, sans-serif';ctx.textBaseline='alphabetic';ctx.fillText(s||'',p.x,p.y);ctx.restore();}
function table(ctx:CanvasRenderingContext2D,e:Entity){
  const a=e.points[0];if(!a)return;
  const rows=Math.max(1,e.rows||3),cols=Math.max(1,e.cols||3),w=e.width||120,h=e.height||60;
  for(let r=0;r<=rows;r++){const y=a.y+r*h/rows;poly(ctx,[{x:a.x,y},{x:a.x+w,y}]);ctx.stroke();}
  for(let c=0;c<=cols;c++){const x=a.x+c*w/cols;poly(ctx,[{x,y:a.y},{x,y:a.y+h}]);ctx.stroke();}
  if(e.text){ctx.fillStyle=ctx.strokeStyle;text(ctx,{x:a.x+3,y:a.y+h/rows*.68},e.text,Math.min(4,h/rows*.5));}
}
export function drawEntity(ctx:CanvasRenderingContext2D,e:Entity,lineWidth:number,selected=false){
  const pts=e.points;if(!pts.length)return;ctx.save();ctx.lineWidth=lineWidth*(selected?2.2:1);ctx.strokeStyle=selected?'#facc15':ctx.strokeStyle;ctx.fillStyle=ctx.strokeStyle;ctx.lineJoin='round';ctx.lineCap='round';
  if(e.kind==='eskd'){
    for(const child of eskdParts(e))drawEntity(ctx,child,lineWidth,false);
    if(selected){ctx.fillStyle='#facc15';const p=e.points[0];ctx.fillRect(p.x-lineWidth*4,p.y-lineWidth*4,lineWidth*8,lineWidth*8);}
    ctx.restore();return;
  }
  if(e.kind==='axis'){ctx.setLineDash([12*lineWidth,5*lineWidth,2*lineWidth,5*lineWidth]);}
  if(e.kind==='line'||e.kind==='axis'||e.kind==='polyline'||e.kind==='hatch'){
    if(e.kind==='hatch'){poly(ctx,pts,true);ctx.globalAlpha=.13;ctx.fill();ctx.globalAlpha=1;}
    poly(ctx,pts,!!e.closed||e.kind==='hatch');ctx.stroke();
  }else if(e.kind==='circle'&&e.center&&e.radius){ctx.beginPath();ctx.arc(e.center.x,e.center.y,e.radius,0,2*pi);ctx.stroke();}
  else if(e.kind==='arc'&&e.center&&e.radius){ctx.beginPath();ctx.arc(e.center.x,e.center.y,e.radius,e.startAngle||0,e.endAngle||0);ctx.stroke();}
  else if(e.kind==='text')text(ctx,pts[0],e.text||'Текст',e.size||4);
  else if(e.kind==='dimension'&&pts.length>=2){
    const [a,b]=pts,v=sub(b,a),len=Math.max(1e-9,dist(a,b)),u=mul(v,1/len),n={x:-u.y,y:u.x};
    const off=mul(n,e.offset??20),aa=add(a,off),bb=add(b,off);
    poly(ctx,[a,aa]);ctx.stroke();poly(ctx,[b,bb]);ctx.stroke();poly(ctx,[aa,bb]);ctx.stroke();
    arrow(ctx,aa,u,Math.max(lineWidth*6,Math.min(6,Math.abs(e.offset??20)/3)));
    arrow(ctx,bb,mul(u,-1),Math.max(lineWidth*6,Math.min(6,Math.abs(e.offset??20)/3)));
    const label=e.text||Number(dimensionLength(e).toFixed(2)).toString(); const at=mid(aa,bb);
    text(ctx,add(at,mul(n,-Math.max(e.size||3.5,4))),label,e.size||3.5);
  }else if(e.kind==='leader'&&pts.length>=2){
    poly(ctx,pts);ctx.stroke();const d=sub(pts[1],pts[0]),len=Math.max(1e-9,dist(pts[0],pts[1]));arrow(ctx,pts[0],mul(d,1/len),Math.max(4,lineWidth*6));
    if(e.text)text(ctx,add(pts[pts.length-1],{x:2,y:-2}),e.text,e.size||4);
  }else if(e.kind==='table'||e.kind==='stamp')table(ctx,e);
  if(selected){ctx.fillStyle='#facc15';for(const p of pts){ctx.fillRect(p.x-lineWidth*3,p.y-lineWidth*3,lineWidth*6,lineWidth*6);}if(e.center)ctx.fillRect(e.center.x-lineWidth*3,e.center.y-lineWidth*3,lineWidth*6,lineWidth*6);}
  ctx.restore();
}
export function drawScene(ctx:CanvasRenderingContext2D,width:number,height:number,dpr:number,sheet:Sheet,layers:Layer[],camera:Camera,image:HTMLImageElement|undefined,options:{source:boolean;compare:boolean;grid:boolean;selected:string|null;draft?:Point[];cursor?:Point|null;drag?:Point|null}){
  ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);ctx.fillStyle='#08111f';ctx.fillRect(0,0,width,height);
  const scale=width/camera.w,layerColors=new Map(layers.map(l=>[l.name,l]));
  const draw=(source:boolean,entities:boolean)=>{
    ctx.save();ctx.translate(-camera.x*scale,-camera.y*scale);ctx.scale(scale,scale);
    if(options.grid){const target=40/scale,step=Math.pow(10,Math.floor(Math.log10(Math.max(1e-6,target))));const s=target/step>4?step*5:step;ctx.lineWidth=.5/scale;ctx.strokeStyle='#1c3044';ctx.beginPath();
      for(let x=Math.floor(camera.x/s)*s;x<camera.x+camera.w;x+=s){ctx.moveTo(x,camera.y);ctx.lineTo(x,camera.y+camera.h);}
      for(let y=Math.floor(camera.y/s)*s;y<camera.y+camera.h;y+=s){ctx.moveTo(camera.x,y);ctx.lineTo(camera.x+camera.w,y);}ctx.stroke();}
    if(source && image){ctx.save();ctx.globalAlpha=options.compare?1:.47;ctx.drawImage(image,0,0,sheet.width,sheet.height);ctx.restore();}
    if(entities){for(const e of sheet.entities){const l=layerColors.get(e.layer);if(l&&!l.visible)continue;ctx.strokeStyle=e.color||l?.color||'#e4ebf4';drawEntity(ctx,options.selected===e.id&&options.drag?{...e,points:e.points.map(p=>add(p,options.drag!)),center:e.center?add(e.center,options.drag!):undefined}:e,1.4/scale,options.selected===e.id);}
      if(options.draft?.length){ctx.strokeStyle='#facc15';drawEntity(ctx,{id:'preview',kind:'polyline',points:[...options.draft,...(options.cursor?[options.cursor]:[])],layer:'',origin:'manual',verified:false},1.2/scale);}}
    ctx.restore();
  };
  if(options.compare){
    ctx.save();ctx.beginPath();ctx.rect(0,0,width*.5,height);ctx.clip();draw(true,false);ctx.restore();
    ctx.save();ctx.beginPath();ctx.rect(width*.5,0,width*.5,height);ctx.clip();draw(false,true);ctx.restore();
    ctx.strokeStyle='#e2e8f0';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(width*.5,0);ctx.lineTo(width*.5,height);ctx.stroke();
    ctx.fillStyle='#f8fafc';ctx.font='12px sans-serif';ctx.fillText('ОРИГИНАЛ',12,22);ctx.fillText('CAD',width*.5+12,22);
  }else draw(options.source,true);
}