/**
 * A bounded, deterministic circle proposal detector for browser-side CAD tracing.
 *
 * Complements connected-component contour fitting: circles joined to a line,
 * dimension arrow, crosshair or neighbouring drawing remain identifiable.
 * Output is always unverified evidence, not an engineering measurement.
 */
import {scanInkTone} from './scanInkThreshold';
export interface CircleProposal {x:number;y:number;radius:number;confidence:number;coverage:number}
type Edge={x:number;y:number;dx:number;dy:number};
export interface CircleDebug {edges?:number;samples?:number;maxCenterVotes?:number;centerPeaks?:number;topCenters?:Array<{x:number;y:number;votes:number}>;maxCoverage?:number;bestRadius?:number}

export function detectOverlappedCircles(
  rgba:Uint8ClampedArray,width:number,height:number,
  maxCandidates=25,debug?:CircleDebug,inkThreshold=165
):CircleProposal[] {
  if(width<48||height<48||rgba.length<width*height*4)return [];
  const gray=new Uint8Array(width*height);
  for(let i=0;i<gray.length;i++){
    const j=i*4;
    gray[i]=scanInkTone(rgba[j],rgba[j+1],rgba[j+2]);
  }
  const edges:Edge[]=[];
  // The grid bounds work on the original tile, not a downsampled preview.
  // Use a repeatable spatial sampling stride for bounded CPU usage.
  const step=Math.max(2,Math.ceil(Math.sqrt(width*height/400000)));
  for(let y=2;y<height-2;y+=step){
    for(let x=2;x<width-2;x+=step){
      const i=y*width+x;
      if(gray[i]>inkThreshold)continue;
      // Sobel gradient: dark-to-light normal to the printed stroke.
      const gx=(-gray[i-width-1]+gray[i-width+1]-2*gray[i-1]+2*gray[i+1]
          -gray[i+width-1]+gray[i+width+1]);
      const gy=(-gray[i-width-1]-2*gray[i-width]-gray[i-width+1]
          +gray[i+width-1]+2*gray[i+width]+gray[i+width+1]);
      const norm=Math.hypot(gx,gy);
      if(norm<120)continue;
      edges.push({x,y,dx:gx/norm,dy:gy/norm});
    }
  }
  if(debug)debug.edges=edges.length;
  if(edges.length<30)return [];
  const stride=Math.max(1,Math.ceil(edges.length/11000));
  const samples=edges.filter((_,i)=>i%stride===0);
  if(debug)debug.samples=samples.length;
  const cell=4,cw=Math.ceil(width/cell),ch=Math.ceil(height/cell);
  const counts=new Uint16Array(cw*ch);
  const maxR=Math.min(230,Math.floor(Math.min(width,height)*.47));
  const minR=10;
  if(maxR<=minR)return [];
  // Orientation votes for every possible radius; center peak is independent
  // of chosen radius, avoiding the huge memory footprint of a 3D Hough cube.
  for(const p of samples){
    for(let r=minR;r<=maxR;r+=4){
      for(const sign of [-1,1]){
        const x=p.x+sign*p.dx*r,y=p.y+sign*p.dy*r;
        if(x<0||y<0||x>=width||y>=height)continue;
        const bx=Math.floor(x/cell),by=Math.floor(y/cell);
        const key=by*cw+bx;
        if(counts[key]<65535)counts[key]++;
      }
    }
  }
  // Stroke gradients and the radius sampling grid can place strong votes
  // around (not exactly at) the true center. A local 7x7 vote aggregation
  // recovers the center without guessing dimensions or widening final fits.
  const smoothed=new Uint32Array(counts.length);
  for(let y=3;y<ch-3;y++)for(let x=3;x<cw-3;x++){
    let votes=0;
    for(let dy=-3;dy<=3;dy++)for(let dx=-3;dx<=3;dx++)
      votes+=counts[(y+dy)*cw+x+dx];
    smoothed[y*cw+x]=votes;
  }
  const peaks:Array<{x:number;y:number;votes:number}>=[];
  for(let y=4;y<ch-4;y++)for(let x=4;x<cw-4;x++){
    const at=y*cw+x,votes=smoothed[at];
    if(votes<Math.max(70,Math.floor(samples.length*.06)))continue;
    let maximum=true;
    for(let dy=-1;dy<=1&&maximum;dy++)for(let dx=-1;dx<=1;dx++){
      if(!dx&&!dy)continue;
      if(smoothed[(y+dy)*cw+x+dx]>votes){maximum=false;break;}
    }
    if(maximum)peaks.push({x,y,votes});
  }
  peaks.sort((a,b)=>b.votes-a.votes);
  if(debug){debug.centerPeaks=peaks.length;debug.maxCenterVotes=Math.max(...smoothed);debug.topCenters=peaks.slice(0,12).map(p=>({x:(p.x+.5)*cell,y:(p.y+.5)*cell,votes:p.votes}));debug.maxCoverage=0;}
  const output:CircleProposal[]=[];
  // Confirm candidate using 48 independent angular arcs. A coincident
  // straight line or a small disconnected arc cannot imitate a full circle.
  const coverage=(cx:number,cy:number,r:number):number=>{
    let hits=0;
    for(let i=0;i<48;i++){
      const a=i*2*Math.PI/48,cos=Math.cos(a),sin=Math.sin(a);
      let found=false;
      for(let dr=-3;dr<=3;dr++){
        const x=Math.round(cx+(r+dr)*cos);
        const y=Math.round(cy+(r+dr)*sin);
        if(x<0||y<0||x>=width||y>=height)continue;
        if(gray[y*width+x]<=inkThreshold){found=true;break;}
      }
      if(found)hits++;
    }
    return hits/48;
  };
  for(const peak of peaks.slice(0,75)){
    const cx=(peak.x+.5)*cell,cy=(peak.y+.5)*cell;
    const bins=new Uint16Array(Math.floor(maxR/2)+3);
    for(const p of samples){
      const r=Math.hypot(p.x-cx,p.y-cy);
      if(r<minR||r>maxR)continue;
      bins[Math.round(r/2)]++;
    }
    const radials:Array<{r:number;votes:number}>=[];
    for(let j=Math.ceil(minR/2);j<bins.length-1;j++){
      if(bins[j]<Math.max(12,Math.floor(samples.length*.003)))continue;
      const votes=bins[j-1]+bins[j]+bins[j+1];
      radials.push({r:j*2,votes});
    }
    radials.sort((a,b)=>b.votes-a.votes);
    for(const radial of radials.slice(0,5)){
      const radius=radial.r;
      if(cx<radius*.75||cy<radius*.75||
         cx>width-radius*.75||cy>height-radius*.75)continue;
      const cov=coverage(cx,cy,radius);
      if(debug&&cov>(debug.maxCoverage||0)){debug.maxCoverage=cov;debug.bestRadius=radius;}
      if(cov<.72)continue;
      // A full circumference has edge support proportional to its length.
      if(radial.votes<Math.max(20,radius*.18))continue;
      const duplicate=output.some(c=>
        Math.hypot(c.x-cx,c.y-cy)<Math.max(6,radius*.11)
        &&Math.abs(c.radius-radius)<Math.max(5,radius*.09));
      if(duplicate)continue;
      output.push({x:cx,y:cy,radius,coverage:cov,
        confidence:Math.min(.92,.34+.55*cov+.03*Math.min(1,peak.votes/60))});
      if(output.length>=maxCandidates)return output;
    }
  }
  return output;
}
