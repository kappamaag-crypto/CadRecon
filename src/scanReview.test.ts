import {describe,it,expect} from 'vitest';
import {entity,newProject,type Entity,type Point} from './model';
import {auditScanGeometry,scanReviewCSV} from './scanReview';

const p=(x:number,y:number):Point=>({x,y});
function l(a:Point,b:Point):Entity {
  const e=entity('line',[a,b],'Автообводка','trace');
  e.confidence=.7;return e;
}
describe('W3 raster topology review (diagnostic, never auto-connect)',()=>{
  it('flags an aligned visible gap but does not alter its two input objects',()=>{
    const project=newProject(),a=l(p(0,0),p(50,0)),b=l(p(54,0),p(100,0));
    project.sheets[0].entities=[a,b];
    const snapshot=JSON.stringify(project);
    const r=auditScanGeometry(project);
    expect(r.examinedLines).toBe(2);
    expect(r.nearGaps).toBe(1);
    expect(r.findings[0]).toMatchObject({kind:'near-gap',entityId:a.id,relatedEntityId:b.id,distance:4});
    expect(JSON.stringify(project)).toBe(snapshot);
    expect(a.verified).toBe(false);
    expect(b.verified).toBe(false);
  });
  it('does not invent a gap at joined endpoints, parallel lines or crossings',()=>{
    const project=newProject();
    project.sheets[0].entities=[
      l(p(0,0),p(50,0)),l(p(50,0),p(100,0)),
      l(p(0,3),p(50,3)),l(p(54,5),p(100,5)),
      l(p(25,-35),p(25,35)),
    ];
    expect(auditScanGeometry(project).nearGaps).toBe(0);
  });
  it('never connects entities across layers or sheets, or edits verified/manual lines',()=>{
    const project=newProject(),a=l(p(0,0),p(50,0)),b=l(p(54,0),p(100,0));
    b.layer='Размеры';
    project.sheets[0].entities=[a,b];
    expect(auditScanGeometry(project).nearGaps).toBe(0);
    b.layer=a.layer;b.verified=true;
    expect(auditScanGeometry(project).nearGaps).toBe(0);
    b.verified=false;b.origin='manual';
    expect(auditScanGeometry(project).nearGaps).toBe(0);
  });
  it('reports weak ink evidence but never claims a verified engineering error',()=>{
    const project=newProject(),a=l(p(10,30),p(150,30));
    a.reason='Обводка: опора на исходный штрих 19%. Проверить по оригиналу.';
    project.sheets[0].entities=[a];
    const r=auditScanGeometry(project);
    expect(r.weakInk).toBe(1);
    expect(r.findings[0].kind).toBe('weak-ink');
    expect(r.findings[0].description).toContain('19%');
    expect(a.verified).toBe(false);
  });
  it('ignores malformed and tiny fragments, with formula-safe CSV export',()=>{
    const project=newProject();
    const short=l(p(0,0),p(3,0)),bad=l(p(0,0),p(Number.NaN,0));
    project.sheets[0].entities=[short,bad];
    const r=auditScanGeometry(project);
    expect(r.examinedLines).toBe(0);
    expect(r.findings).toHaveLength(0);
    const a=l(p(0,50),p(50,50));a.reason='опора на исходный штрих 10%';
    project.sheets[0].name='=HYPERLINK("bad")';
    project.sheets[0].entities=[a];
    expect(scanReviewCSV(auditScanGeometry(project))).toContain("'=HYPERLINK");
  });
  it('handles a thousand distant lines deterministically without false pairs',()=>{
    const project=newProject();
    project.sheets[0].entities=Array.from({length:1000},(_,i)=>l(p(0,i*20),p(100,i*20)));
    const a=auditScanGeometry(project),b=auditScanGeometry(project);
    expect(a).toEqual(b);
    expect(a.nearGaps).toBe(0);
  });
});
