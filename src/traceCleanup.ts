/** Explicit, reversible cleanup suggestions for unsupported Hough hypotheses.
 * Narrow by design: only unverified, unstyled traced LINE candidates with
 * structured source pixel measurements. Manual/PDF/approved geometry, dashed
 * and center lines are NEVER eligible. Does not modify input.
 */
import type {Entity} from './model';
export interface TraceCleanupProposal {
  ids:string[];examined:number;eligible:number;reason:string;
}
export function proposeTraceNoiseCleanup(entities:Entity[]):TraceCleanupProposal{
  const ids:string[]=[];
  let examined=0;
  for(const e of entities){
    if(e.kind!=='line'||e.origin!=='trace')continue;
    examined++;
    const evidence=e.scanEvidence;
    if(e.verified||e.lineStyle||!evidence||!Number.isFinite(e.confidence))continue;
    const lowInk=evidence.inkSupport<=.12;
    const hugeGap=evidence.blankRunRatio>=.40;
    const lowRank=e.confidence!<=.20;
    if(lowInk&&hugeGap&&lowRank)ids.push(e.id);
  }
  return {ids,examined,eligible:ids.length,
    reason:'Кандидаты почти не подтверждены пикселями, имеют большой белый разрыв и низкий эвристический ранг. Удаление необязательно: повреждённые реальные линии также могут попасть в список; проверьте исходник.'};
}
