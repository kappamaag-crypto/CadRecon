/**
 * A line-stroke de-duplicator backed by the ORIGINAL ink pixels.
 *
 * Hough tends to identify each border of a thick stroke and many nearby
 * angle/rho hypotheses as distinct LINE entities. We may suppress a short
 * line only when it is covered by a longer near-parallel line AND dark ink
 * bridges the two. Separate parallel contours with a white gap are not joined.
 *
 * This does not extrapolate, close gaps or invent any dimensions.
 */
export type Point2D={x:number;y:number};
export interface StrokeSegment {a:Point2D;b:Point2D;confidence:number;lineStyle?:'dashed'|'center'}
export interface InkDedupResult {lines:StrokeSegment[];removed:number}
const dist=(a:Point2D,b:Point2D)=>Math.hypot(a.x-b.x,a.y-b.y);
const dot=(a:Point2D,b:Point2D)=>a.x*b.x+a.y*b.y;
const delta=(a:Point2D,b:Point2D)=>({x:a.x-b.x,y:a.y-b.y});
const mix=(a:Point2D,b:Point2D,t:number)=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});

/** Endpoints must coincide in BOTH dimensions. Comparing only first.x and
 * last.y, as the old Hough worker did, discards distinct diagonal strokes. */
export function sameFiniteLine(a:StrokeSegment,b:StrokeSegment,tolerance=2.5):boolean{
  return (dist(a.a,b.a)<=tolerance&&dist(a.b,b.b)<=tolerance)||
    (dist(a.a,b.b)<=tolerance&&dist(a.b,b.a)<=tolerance);
}
export function deduplicateInkStrokeVotes(
  strokes:StrokeSegment[],rgba:Uint8ClampedArray,width:number,height:number,inkThreshold=175
):InkDedupResult{
  if(!Number.isInteger(width)||!Number.isInteger(height)||
    width<2||height<2||rgba.length<width*height*4||strokes.length<2)
    return {lines:strokes,removed:0};
  const candidates=[...strokes].sort((a,b)=>
    dist(b.a,b.b)-dist(a.a,a.b)||
    a.a.x-b.a.x||a.a.y-b.a.y||a.b.x-b.b.x||a.b.y-b.b.y);
  const kept:StrokeSegment[]=[];
  const maxCross=5.25,cosLimit=Math.cos(Math.PI/90);
  const dark=(p:Point2D):boolean=>{
    const x=Math.round(p.x),y=Math.round(p.y);
    if(x<0||y<0||x>=width||y>=height)return false;
    const i=(y*width+x)*4;
    return .299*rgba[i]+.587*rgba[i+1]+.114*rgba[i+2]<=inkThreshold;
  };
  function coveredBy(candidate:StrokeSegment,reference:StrokeSegment):boolean{
    // A marked DASHED/CENTER line is a distinct hypothesis from a SOLID
    // stroke, even at the same finite coordinates. Never delete it as a vote.
    if(candidate.lineStyle!==reference.lineStyle)return false;
    const ac=delta(candidate.b,candidate.a),bc=delta(reference.b,reference.a);
    const na=dist(candidate.a,candidate.b),nb=dist(reference.a,reference.b);
    if(na<8||nb<8||nb<na*.95)return false;
    const cos=Math.abs(dot(ac,bc)/(na*nb));
    if(cos<cosLimit)return false;
    // We require nearly ALL proposed pixels to be in the existing line's
    // finite interval. Crossing, disjoint or extending lines are untouched.
    let within=0,bridgeDark=0,bridgeTotal=0;
    for(let i=0;i<=10;i++){
      const p=mix(candidate.a,candidate.b,i/10);
      const t=Math.max(0,Math.min(1,dot(delta(p,reference.a),bc)/(nb*nb)));
      const q=mix(reference.a,reference.b,t);
      const d=dist(p,q);
      if(d>maxCross)continue;
      within++;
      if(d<=1.1)continue;
      // Three cross-stroke samples: two true parallel strokes separated
      // by white paper MUST NOT merge merely because they run together.
      for(const alpha of [.25,.5,.75]){
        bridgeTotal++;
        if(dark(mix(p,q,alpha)))bridgeDark++;
      }
    }
    if(within<10)return false;
    return bridgeTotal===0||bridgeDark/bridgeTotal>=.8;
  }
  let removed=0;
  for(const segment of candidates){
    if(kept.some(other=>coveredBy(segment,other))){removed++;continue;}
    kept.push(segment);
  }
  return {lines:kept,removed};
}
