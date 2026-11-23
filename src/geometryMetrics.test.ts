import {describe,it,expect} from 'vitest';
import {entity} from './model';
import {parseGeometryReference,measureGeometryAgainstReference} from './geometryMetrics';
const p=(x:number,y:number)=>({x,y});
const line=(a:{x:number;y:number},b:{x:number;y:number},origin:'trace'|'manual'='trace')=>
  entity('line',[a,b],'Автообводка',origin);
const reference=(scope:'partial'|'complete'='partial')=>parseGeometryReference({
  version:1,reviewed:true,imageWidth:200,imageHeight:120,scope,
  region:scope==='complete'?{x0:10,y0:10,x1:190,y1:110}:undefined,
  lines:[{id:'shaft-upper',a:p(20,30),b:p(180,30)}],
  circles:[],
});
describe('W0 independent local benchmark (never mutates CAD or uploads image)',()=>{
  it('requires reviewed coordinates, unique labels and bounded input',()=>{
    expect(()=>parseGeometryReference({version:1,reviewed:false,scope:'partial',
      imageWidth:200,imageHeight:120,lines:[],circles:[]})).toThrow(/reviewed/);
    expect(()=>parseGeometryReference({version:1,reviewed:true,scope:'complete',
      imageWidth:200,imageHeight:120,lines:[{id:'a',a:p(0,0),b:p(100,0)}],circles:[]})).toThrow(/region/);
    expect(()=>parseGeometryReference({version:1,reviewed:true,scope:'partial',
      imageWidth:200,imageHeight:120,lines:[
        {id:'a',a:p(20,20),b:p(100,20)},{id:'a',a:p(20,25),b:p(100,25)}],circles:[]})).toThrow(/id/);
  });
  it('fragmented but correctly aligned source ink retains high reference coverage',()=>{
    const got=measureGeometryAgainstReference(reference(),[
      line(p(20,30),p(100,30)),line(p(100,30),p(180,30))
    ],{width:200,height:120});
    expect(got.lineCoverage).toBe(1);
    expect(got.coveredLines).toBe(1);
    expect(got.unsupportedCandidates).toBeNull();
  });
  it('disjoint and displaced parallels do not falsely cover reference',()=>{
    const got=measureGeometryAgainstReference(reference(),[
      line(p(20,35),p(180,35)),line(p(20,30),p(70,30))
    ],{width:200,height:120},2);
    expect(got.lineCoverage).toBeGreaterThan(.25);
    expect(got.lineCoverage).toBeLessThan(.40);
    expect(got.coveredLines).toBe(0);
    expect(got.missingLines[0].id).toBe('shaft-upper');
  });
  it('partial markup MUST NOT invent false positives from unlabeled title blocks',()=>{
    const extra=line(p(20,90),p(180,90));
    const out=measureGeometryAgainstReference(reference(),[
      line(p(20,30),p(180,30)),extra
    ],{width:200,height:120});
    expect(out.unsupportedCandidates).toBeNull();
    expect(out.candidateAgreement).toBeNull();
    expect(extra.verified).toBe(false);
  });
  it('full ROI labels and explicitly counts extra source candidates',()=>{
    const got=measureGeometryAgainstReference(reference('complete'),[
      line(p(20,30),p(180,30)),line(p(20,90),p(180,90))
    ],{width:200,height:120});
    expect(got.lineCoverage).toBe(1);
    expect(got.unsupportedCandidates).toBe(1);
    expect(got.candidateAgreement).toBe(.5);
  });
  it('does not count manual correction as a recovered Hough line',()=>{
    const got=measureGeometryAgainstReference(reference(),[
      line(p(20,30),p(180,30),'manual')
    ],{width:200,height:120});
    expect(got.lineCoverage).toBe(0);
  });
  it('converts sheet coordinates to original source pixels, not mm',()=>{
    const got=measureGeometryAgainstReference(reference(),[
      line(p(10,15),p(90,15))
    ],{width:100,height:60});
    expect(got.lineCoverage).toBe(1);
  });
  it('scores circles with independent center and radius residuals',()=>{
    const ref=parseGeometryReference({version:1,reviewed:true,imageWidth:200,
      imageHeight:120,scope:'partial',lines:[],
      circles:[{id:'section',center:p(100,60),radius:20}]});
    const a=entity('circle',[p(100,60)],'Автообводка','trace');
    a.center=p(101,59);a.radius=19;
    const got=measureGeometryAgainstReference(ref,[a],{width:200,height:120},3);
    expect(got.matchedCircles).toBe(1);
    expect(got.meanCircleCenterErrorPx).toBeCloseTo(Math.SQRT2);
    expect(got.meanCircleRadiusErrorPx).toBe(1);
    expect(got.missingCircles).toHaveLength(0);
  });
  it('never silently assumes anisotropically warped ellipse is a CIRCLE',()=>{
    const ref=parseGeometryReference({version:1,reviewed:true,imageWidth:200,
      imageHeight:120,scope:'partial',lines:[],
      circles:[{id:'section',center:p(100,60),radius:20}]});
    const a=entity('circle',[p(50,30)],'Автообводка','trace');
    a.center=p(50,30);a.radius=10;
    const got=measureGeometryAgainstReference(ref,[a],{width:100,height:120},3);
    expect(got.matchedCircles).toBe(0);
    expect(got.missingCircles).toEqual(['section']);
  });
  it('bounds geometry cardinality and disallows corrupt coordinates',()=>{
    expect(()=>measureGeometryAgainstReference(reference(),[],{width:0,height:100})).toThrow();
    expect(()=>measureGeometryAgainstReference(reference(),[],{width:200,height:120},99)).toThrow();
  });
});
