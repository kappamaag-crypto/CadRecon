/** Infer printed stroke direction from ORIGINAL grayscale scan pixels.
 *
 * Hough should not vote for all 90 line orientations at every dark contour
 * pixel: that creates fake tangent/chord lines across curves and hatch ink.
 * The normal is contrast-derived, not an engineer-approved line direction.
 *
 * Sobel gradient handles ordinary 2-5px raster outlines; a symmetric 1px
 * centre ridge has a zero Sobel gradient, so use short symmetric neighbouring
 * ink along a SINGLE tangent axis as a conservative fallback.
 * Isolated noise and ambiguous intersections abstain rather than fabricate
 * an orientation. This never edits the source image or CAD document.
 */
export interface InkNormal {x:number;y:number}
const COHERENCE=Math.cos(27*Math.PI/180);
export function normalAgrees(normal:InkNormal,nx:number,ny:number):boolean {
  return Math.abs(normal.x*nx+normal.y*ny)>=COHERENCE;
}
export function inferStrokeNormal(
  gray:Uint8Array,width:number,height:number,x:number,y:number,threshold:number,
):InkNormal|null{
  if(!Number.isInteger(width)||!Number.isInteger(height)||
    width<5||height<5||gray.length<width*height||
    x<2||x>=width-2||y<2||y>=height-2||
    !Number.isFinite(threshold))return null;
  const at=(dx:number,dy:number)=>gray[(y+dy)*width+x+dx];
  if(at(0,0)>threshold)return null;
  const gx=-at(-1,-1)+at(1,-1)-2*at(-1,0)+2*at(1,0)-at(-1,1)+at(1,1);
  const gy=-at(-1,-1)-2*at(0,-1)-at(1,-1)+at(-1,1)+2*at(0,1)+at(1,1);
  const mag=Math.hypot(gx,gy);
  // Small threshold also recognises 185-grey pencil over 250-grey paper.
  if(mag>=20)return {x:gx/mag,y:gy/mag};

  const dirs=[[1,0],[0,1],[1,1],[1,-1]] as const;
  let best=-1,bestIndex=-1,tie=false;
  for(let i=0;i<dirs.length;i++){
    const [dx,dy]=dirs[i];
    const a=at(-dx,-dy)<=threshold?1:0;
    const b=at(dx,dy)<=threshold?1:0;
    const score=a+b;
    if(score>best){best=score;bestIndex=i;tie=false;}
    else if(score===best)tie=true;
  }
  // Opposite ink neighbours form a true 1px ridge. A single dark pixel,
  // end cap or an ambiguous cross has no reliable tangent orientation.
  if(best<2||tie||bestIndex<0)return null;
  const [dx,dy]=dirs[bestIndex],norm=Math.hypot(dx,dy);
  return {x:-dy/norm,y:dx/norm};
}
