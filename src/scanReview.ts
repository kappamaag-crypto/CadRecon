/** Browser-only diagnostics for unverified raster LINE candidates.
 * Findings suggest places to inspect; they NEVER close a gap or alter CAD entities.
 * Distances are in sheet coordinate units, NOT independently calibrated mm.
 */
import type {CadProject,Entity,Point} from './model';
import {exportTableCSV} from './archiveFeatures';

export type ScanFindingKind='near-gap'|'weak-ink';
export interface ScanFinding {
  kind:ScanFindingKind;
  sheetIndex:number;
  sheetName:string;
  entityId:string;
  relatedEntityId?:string;
  distance?:number;
  description:string;
}
export interface ScanReview {
  examinedLines:number;
  nearGaps:number;
  weakInk:number;
  findings:ScanFinding[];
  truncated:boolean;
}
type End={point:Point;out:Point;entity:Entity};
const GAP_MAX=8;
const GAP_MIN=1.25;
const MIN_LINE=12;
const COS_LIMIT=Math.cos(Math.PI/36); // 5 degrees
const LIMIT=600;
const length=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y);
const dot=(a:Point,b:Point)=>a.x*b.x+a.y*b.y;
const grid=(p:Point)=>({x:Math.floor(p.x/GAP_MAX),y:Math.floor(p.y/GAP_MAX)});
const cell=(x:number,y:number)=>x+':'+y;

function endpoints(e:Entity):End[] {
  if(e.kind!=='line'||e.origin!=='trace'||e.verified||e.points.length!==2)return [];
  const [a,b]=e.points;
  if(![a.x,a.y,b.x,b.y].every(Number.isFinite))return [];
  const n=length(a,b);
  if(n<MIN_LINE)return [];
  const direction={x:(b.x-a.x)/n,y:(b.y-a.y)/n};
  return [{point:a,out:{x:-direction.x,y:-direction.y},entity:e},
    {point:b,out:direction,entity:e}];
}

/** Uses endpoint spatial bins rather than all-pairs search. No changes to input. */
export function auditScanGeometry(project:CadProject):ScanReview {
  const findings:ScanFinding[]=[];
  let examinedLines=0,nearGaps=0,weakInk=0,truncated=false;
  const push=(f:ScanFinding)=>{
    if(findings.length<LIMIT)findings.push(f);
    else truncated=true;
  };
  for(let si=0;si<project.sheets.length;si++){
    const sheet=project.sheets[si];
    const cells=new Map<string,End[]>();
    const matchedPairs=new Set<string>();
    for(const e of sheet.entities){
      const ends=endpoints(e);
      if(!ends.length)continue;
      examinedLines++;
      const evidence=/опора на исходный штрих\s+(\d{1,3})%/i.exec(e.reason||'');
      const ink=evidence?Number(evidence[1]):null;
      const weak=ink!==null?ink<35:typeof e.confidence==='number'&&e.confidence<.20;
      if(weak){
        weakInk++;
        push({kind:'weak-ink',sheetIndex:si,sheetName:sheet.name,entityId:e.id,
          description:ink!==null?'Низкая опора отрезка на исходные пиксели: '+ink+'%. Проверить вручную.':
            'Низкий эвристический балл отрезка. Проверить вручную.'});
      }
      for(const end of ends){
        const g=grid(end.point);
        for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
          const neighbors=cells.get(cell(g.x+dx,g.y+dy))||[];
          // Dense text and hatch patterns must not cause quadratic work or a frozen UI.
          if(neighbors.length>240){truncated=true;continue;}
          for(const prev of neighbors){
            if(prev.entity.id===end.entity.id||prev.entity.layer!==end.entity.layer)continue;
            const distance=length(prev.point,end.point);
            if(distance<=GAP_MIN||distance>GAP_MAX)continue;
            const toward={x:(end.point.x-prev.point.x)/distance,
              y:(end.point.y-prev.point.y)/distance};
            // Both line ends must face the gap along the same straight axis.
            // This rejects most nearby parallel strokes, T-junctions and crossings.
            if(dot(prev.out,toward)<COS_LIMIT||dot(end.out,toward)>-COS_LIMIT||
              dot(prev.out,end.out)>-COS_LIMIT)continue;
            const pair=[prev.entity.id,end.entity.id].sort().join('|');
            if(matchedPairs.has(pair))continue;
            matchedPairs.add(pair);
            nearGaps++;
            push({kind:'near-gap',sheetIndex:si,sheetName:sheet.name,
              entityId:prev.entity.id,relatedEntityId:end.entity.id,distance,
              description:'Близкие соосные концы отрезков, зазор '+distance.toFixed(2)+
                ' ед. листа. Не соединено: проверьте наличие реального штриха.'});
          }
        }
        const k=cell(g.x,g.y),bucket=cells.get(k)||[];
        bucket.push(end);cells.set(k,bucket);
      }
    }
  }
  return {examinedLines,nearGaps,weakInk,findings,truncated};
}

export function scanReviewCSV(review:ScanReview):string {
  return exportTableCSV(['Тип проверки','Лист','Объект','Связанный объект',
    'Расстояние (ед. листа, не мм)','Замечание'],review.findings.map(f=>[
    f.kind==='near-gap'?'Возможный разрыв':'Слабое подтверждение пикселями',
    f.sheetName,f.entityId,f.relatedEntityId||'',f.distance===undefined?'':f.distance.toFixed(3),
    f.description,
  ]));
}
