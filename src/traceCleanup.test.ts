import {describe,it,expect} from 'vitest';
import {entity,type Entity} from './model';
import {proposeTraceNoiseCleanup} from './traceCleanup';
const p=(x:number,y:number)=>({x,y});
const trace=()=>{
 const e=entity('line',[p(0,0),p(100,0)],'Автообводка','trace');
 e.confidence=.12;
 e.scanEvidence={inkSupport:.07,blankRunRatio:.7};
 return e;
};
describe('W3 safe review-only Hough noise proposal',()=>{
 it('selects only severely unsupported plain unverified raster lines without mutation',()=>{
   const noise=trace(),real=trace();
   real.scanEvidence={inkSupport:.72,blankRunRatio:0};
   const before=JSON.stringify([noise,real]);
   const report=proposeTraceNoiseCleanup([noise,real]);
   expect(report.ids).toEqual([noise.id]);
   expect(report.eligible).toBe(1);
   expect(JSON.stringify([noise,real])).toBe(before);
 });
 it('never touches verified/manual/PDF or intentionally styled strokes',()=>{
   const good=trace();good.verified=true;
   const dash=trace();dash.lineStyle='dashed';
   const center=trace();center.lineStyle='center';
   const manual=entity('line',[p(0,0),p(100,0)]);manual.scanEvidence=good.scanEvidence;
   const pdf=entity('line',[p(0,0),p(100,0)],'PDF векторы','pdf');
   pdf.scanEvidence=good.scanEvidence;
   expect(proposeTraceNoiseCleanup([good,dash,center,manual,pdf]).eligible).toBe(0);
 });
 it('does not delete a weak line without all three independent risk flags',()=>{
   const rankHigh=trace();rankHigh.confidence=.22;
   const noGap=trace();noGap.scanEvidence={inkSupport:.04,blankRunRatio:.12};
   const inkPresent=trace();inkPresent.scanEvidence={inkSupport:.24,blankRunRatio:.8};
   const legacy=trace();legacy.scanEvidence=undefined;
   expect(proposeTraceNoiseCleanup([rankHigh,noGap,inkPresent,legacy]).ids).toEqual([]);
 });
});
