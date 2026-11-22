/**
 * Remove redundant Hough line fragments that merely approximate a circle
 * which is ALSO preserved as a native editable CIRCLE entity.
 *
 * This never tries to infer missing circle geometry and never joins lines.
 * Conservative acceptance: a high-confidence detected full circle, a short
 * line whose whole length lies in the thin annulus and has significant tangent
 * direction. A standalone tangent extending outside the rim is preserved.
 */
export interface XY {x:number;y:number}
export interface InkLine {a:XY;b:XY;confidence:number;lineStyle?:'dashed'|'center'}
export interface InkCircle {x:number;y:number;radius:number;confidence:number}

const hypot=(x:number,y:number)=>Math.hypot(x,y);
export function isRedundantCircleStroke(line:InkLine,circle:InkCircle):boolean{
  const r=circle.radius;
  if(!Number.isFinite(r)||r<18||circle.confidence<.76)return false;
  const dx=line.b.x-line.a.x,dy=line.b.y-line.a.y;
  const length=hypot(dx,dy);
  if(length<8||length>r*.72)return false;
  const tolerance=Math.max(2,Math.min(4,r*.05));
  // Tangential chord: a normal through its midpoint passes near circle centre;
  // a radial dimension or leader does NOT meet this condition.
  const midX=(line.a.x+line.b.x)*.5-circle.x;
  const midY=(line.a.y+line.b.y)*.5-circle.y;
  const midR=hypot(midX,midY);
  if(midR<r-tolerance||midR>r+tolerance)return false;
  const cosine=Math.abs((dx*midX+dy*midY)/(length*midR));
  if(cosine>.22)return false;
  let rim=0;
  for(let i=0;i<=12;i++){
    const t=i/12;
    const x=line.a.x+dx*t-circle.x,y=line.a.y+dy*t-circle.y;
    if(Math.abs(hypot(x,y)-r)<=tolerance)rim++;
  }
  return rim>=12;
}
export function suppressRedundantCircleStrokes(
  lines:InkLine[],circles:InkCircle[]
):{lines:InkLine[];removed:number}{
  if(!circles.length||!lines.length)return {lines,removed:0};
  const reliable=circles.filter(c=>c.confidence>=.76&&c.radius>=18);
  if(!reliable.length)return {lines,removed:0};
  const keep=lines.filter(line=>!reliable.some(c=>isRedundantCircleStroke(line,c)));
  return {lines:keep,removed:lines.length-keep.length};
}
