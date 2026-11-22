/** Safe local hatch stroke construction for editable preview and DXF LINEs.
 * These are schematic hatch families, not certified ГОСТ 2.306 patterns.
 * Polygon must be simple, no holes; no raster image is sent to a server.
 */
import type {Point} from './model';
import {isSimplePolygon} from './cadMeasurements';
export type HatchPattern='solid'|'diagonal'|'cross';
export interface HatchSegment {a:Point;b:Point}
export interface HatchLines {segments:HatchSegment[];truncated:boolean;warning?:string}
const EPS=1e-8;
const point=(x:number,y:number):Point=>({x,y});
export function hatchStrokeSegments(
  vertices:Point[],mode:HatchPattern,spacing=12,maxSegments=1000
):HatchLines{
  if(mode==='solid')return {segments:[],truncated:false};
  if(!isSimplePolygon(vertices))return {segments:[],truncated:false,
    warning:'Заливка требует простого замкнутого контура без самопересечений'};
  if(!Number.isFinite(spacing)||spacing<1||spacing>10000)
    return {segments:[],truncated:false,warning:'Шаг штриховки должен быть положительным'};
  const max=Math.min(1000,Math.max(1,Math.floor(maxSegments)));
  const angles=mode==='cross'?[45,135]:[45];
  const all:HatchSegment[]=[];
  for(const deg of angles){
    const radians=deg*Math.PI/180,co=Math.cos(radians),si=Math.sin(radians);
    const rotated=vertices.map(p=>({u:p.x*co+p.y*si,v:-p.x*si+p.y*co}));
    const v0=Math.min(...rotated.map(p=>p.v)),
      v1=Math.max(...rotated.map(p=>p.v));
    const min=Math.ceil((v0+EPS)/spacing);
    const maxIndex=Math.floor((v1-EPS)/spacing);
    if(maxIndex-min+1>650)return {segments:[],truncated:true,
      warning:'Слишком плотная штриховка; увеличьте шаг линий'};
    for(let k=min;k<=maxIndex;k++){
      const v=k*spacing;
      const hits:number[]=[];
      for(let i=0;i<rotated.length;i++){
        const a=rotated[i],b=rotated[(i+1)%rotated.length];
        if((a.v<=v&&b.v>v)||(b.v<=v&&a.v>v)){
          const t=(v-a.v)/(b.v-a.v);
          hits.push(a.u+t*(b.u-a.u));
        }
      }
      hits.sort((a,b)=>a-b);
      for(let i=0;i+1<hits.length;i+=2){
        const left=hits[i],right=hits[i+1];
        if(right-left<=EPS)continue;
        const segment={a:point(left*co-v*si,left*si+v*co),
          b:point(right*co-v*si,right*si+v*co)};
        if(![segment.a.x,segment.a.y,segment.b.x,segment.b.y].every(Number.isFinite))continue;
        if(all.length>=max)return {segments:[],truncated:true,
          warning:'Штриховка превышает 1000 отрезков, увеличьте шаг'};
        all.push(segment);
      }
    }
  }
  return {segments:all,truncated:false};
}
