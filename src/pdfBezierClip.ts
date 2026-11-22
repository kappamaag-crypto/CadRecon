/** Exact-parametric rectangular clipping of a cubic PDF Bézier.
 *
 * Find every intersection with four axis-aligned clipping boundaries using
 * monotone cubic intervals (derivative roots + bisection). Subdivide at those
 * t-values via de Casteljau and retain only portions whose midpoint is inside.
 * Original control geometry is preserved -- never approximate a curve with
 * fake LINE chords or connect separated pieces along the clip rectangle.
 *
 * Numeric tolerance is in viewport coordinate units. This is W1 rectangular
 * clipping only; arbitrary PDF clipping, fill semantics and transparency are
 * separate unresolved problems.
 */
export interface PdfCubicPoint{x:number;y:number}
export interface PdfClipRect{x0:number;y0:number;x1:number;y1:number}
export type PdfCubic=[PdfCubicPoint,PdfCubicPoint,PdfCubicPoint,PdfCubicPoint];
const lerp=(a:PdfCubicPoint,b:PdfCubicPoint,t:number):PdfCubicPoint=>({
  x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,
});
export function splitPdfCubic(points:PdfCubic,t:number):[PdfCubic,PdfCubic]{
  const [a,b,c,d]=points,ab=lerp(a,b,t),bc=lerp(b,c,t),cd=lerp(c,d,t);
  const abc=lerp(ab,bc,t),bcd=lerp(bc,cd,t),mid=lerp(abc,bcd,t);
  return [[a,ab,abc,mid],[mid,bcd,cd,d]];
}
export function pdfCubicAt(p:PdfCubic,t:number):PdfCubicPoint{
  const u=1-t;
  return {x:u*u*u*p[0].x+3*u*u*t*p[1].x+3*u*t*t*p[2].x+t*t*t*p[3].x,
    y:u*u*u*p[0].y+3*u*u*t*p[1].y+3*u*t*t*p[2].y+t*t*t*p[3].y};
}
function monotonicStops(p0:number,p1:number,p2:number,p3:number):number[]{
  const a=p3-3*p2+3*p1-p0,b=3*(p2-2*p1+p0),c=3*(p1-p0);
  const A=3*a,B=2*b,C=c;
  const roots:number[]=[];
  if(Math.abs(A)<1e-12){
    if(Math.abs(B)>1e-12)roots.push(-C/B);
  }else{
    const D=B*B-4*A*C;
    if(D>=0){
      const d=Math.sqrt(D);
      roots.push((-B-d)/(2*A),(-B+d)/(2*A));
    }
  }
  return [0,...roots.filter(t=>t>0&&t<1).sort((x,y)=>x-y),1];
}
function levelRoots(values:[number,number,number,number],level:number):number[]{
  const [p0,p1,p2,p3]=values;
  const eps=1e-9*Math.max(1,...values.map(Math.abs),Math.abs(level));
  const value=(t:number)=>{
    const u=1-t;
    return u*u*u*p0+3*u*u*t*p1+3*u*t*t*p2+t*t*t*p3-level;
  };
  const stops=monotonicStops(p0,p1,p2,p3),result:number[]=[];
  for(const t of stops)if(t>0&&t<1&&Math.abs(value(t))<=eps)result.push(t);
  for(let i=1;i<stops.length;i++){
    let lo=stops[i-1],hi=stops[i],fl=value(lo),fh=value(hi);
    if(Math.abs(fl)<=eps||Math.abs(fh)<=eps||fl*fh>=0)continue;
    for(let iter=0;iter<52;iter++){
      const t=(lo+hi)/2,f=value(t);
      if(fl*f<=0){hi=t;fh=f;}else{lo=t;fl=f;}
    }
    result.push((lo+hi)/2);
  }
  return result.filter(t=>t>1e-10&&t<1-1e-10);
}
function subCubic(points:PdfCubic,start:number,end:number):PdfCubic{
  if(start<=0&&end>=1)return points;
  const right=start<=0?points:splitPdfCubic(points,start)[1];
  const t=end>=1?1:(end-start)/(1-start);
  return t>=1?right:splitPdfCubic(right,t)[0];
}
export function clipPdfCubicToRect(points:PdfCubic,rect:PdfClipRect):PdfCubic[]{
  if(points.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y))||
    ![rect.x0,rect.y0,rect.x1,rect.y1].every(Number.isFinite)||
    rect.x0>=rect.x1||rect.y0>=rect.y1)return [];
  const xs=points.map(p=>p.x) as [number,number,number,number];
  const ys=points.map(p=>p.y) as [number,number,number,number];
  const params=[0,1,...levelRoots(xs,rect.x0),...levelRoots(xs,rect.x1),
    ...levelRoots(ys,rect.y0),...levelRoots(ys,rect.y1)].sort((a,b)=>a-b);
  const times:number[]=[];
  for(const t of params)if(!times.length||t-times[times.length-1]>1e-8)times.push(t);
  const output:PdfCubic[]=[];
  for(let i=1;i<times.length;i++){
    const lo=times[i-1],hi=times[i];
    if(hi-lo<=1e-8)continue;
    const mid=pdfCubicAt(points,(lo+hi)/2);
    if(mid.x<rect.x0-1e-8||mid.x>rect.x1+1e-8||
       mid.y<rect.y0-1e-8||mid.y>rect.y1+1e-8)continue;
    output.push(subCubic(points,lo,hi));
  }
  return output;
}
