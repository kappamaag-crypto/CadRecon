import {describe,it,expect} from 'vitest';
import {extractPdfPaths} from './pdfPaths';
import {newProject} from './model';
import {createDxf} from './dxf';

const OPS={constructPath:91,save:10,restore:11,transform:12,
  moveTo:13,lineTo:14,curveTo:15,curveTo2:16,curveTo3:17,
  rectangle:19,closePath:18};
const viewport={convertToViewportPoint:(x:number,y:number):[number,number]=>[x,350-y]};
const extract=(fnArray:number[],argsArray:unknown[],limit?:number)=>
  extractPdfPaths({fnArray,argsArray},viewport,OPS,limit);
const k=.5522847498307936;

describe('W1 PDF.js 5.x packed path decoding',()=>{
  it('converts a packed moveTo/lineTo to an editable unverified line',()=>{
    const out=extract([91],[[20,[new Float32Array([0,20,40,1,190,40])],new Float32Array([20,40,190,40])]]);
    expect(out.pathOperations).toBe(1);
    expect(out.rejectedPaths).toBe(0);
    expect(out.entities).toHaveLength(1);
    const e=out.entities[0];
    expect(e.kind).toBe('line');
    expect(e.points).toEqual([{x:20,y:310},{x:190,y:310}]);
    expect(e.verified).toBe(false);
    expect(e.sourceId).toBe('pdf-path-op-0');
  });
  it('honors q/cm/Q transform order for packed operations',()=>{
    const line=[20,[Float32Array.from([0,10,20,1,90,20])],null];
    const out=extract([10,12,91,11,10,12,91,11],
      [[],[1,0,0,1,40,60],line,[],[],[0,1,-1,0,200,30],line,[]]);
    expect(out.entities).toHaveLength(2);
    expect(out.entities[0].points).toEqual([{x:50,y:270},{x:130,y:270}]);
    expect(out.entities[1].points).toEqual([{x:180,y:310},{x:180,y:230}]);
  });
  it('keeps legacy operations and a PDF rectangle as editable closed polyline',()=>{
    const out=extract([91],[[[19],[70,75,110,50]]]);
    expect(out.entities).toHaveLength(1);
    const e=out.entities[0];
    expect(e.kind).toBe('polyline');expect(e.closed).toBe(true);
    expect(e.points).toHaveLength(4);
  });
  it('recovers four packed cubic quarter arcs as circle only if radius fits',()=>{
    const x=325,y=135,r=40,d=k*r;
    const packed=[
      0,x+r,y,
      2,x+r,y+d,x+d,y+r,x,y+r,
      2,x-d,y+r,x-r,y+d,x-r,y,
      2,x-r,y-d,x-d,y-r,x,y-r,
      2,x+d,y-r,x+r,y-d,x+r,y,
      4,
    ];
    const out=extract([91],[[20,[Float32Array.from(packed)],null]]);
    expect(out.entities).toHaveLength(1);
    expect(out.entities[0].kind).toBe('circle');
    expect(out.entities[0].radius).toBeCloseTo(40,2);
    expect(out.entities[0].center).toEqual({x:325,y:215});
  });
  it('preserves noncircular cubic as editable DXF SPLINE with 4 control points',()=>{
    const packed=[0,0,0,2,20,20,40,20,60,0];
    const out=extract([91],[[20,[Float32Array.from(packed)],null]]);
    expect(out.entities).toHaveLength(1);expect(out.entities[0].kind).toBe('bezier');
    const project=newProject();project.sheets[0].entities=out.entities;
    const dx=createDxf(project.sheets[0],project);
    expect(dx).toContain('\n0\nSPLINE\n');
    expect((dx.match(/\n40\n/g)||[]).length).toBeGreaterThanOrEqual(8);
    expect(dx).toContain('\n$INSUNITS\n70\n0\n');
    project.sheets[0].calibrated=true;
    expect(createDxf(project.sheets[0],project)).toContain('\n$INSUNITS\n70\n4\n');
  });
  it('skips clip-only and endPath without fabricating visible editable CAD geometry',()=>{
    const line=[20,[Float32Array.from([0,0,0,1,80,0])],null];
    const hidden=[28,[Float32Array.from([0,0,0,1,80,0])],null];
    const clipping=[29,[Float32Array.from([0,0,0,1,80,0])],null];
    const out=extract([91,91,91],[hidden,clipping,line]);
    expect(out.entities).toHaveLength(1);
    expect(out.entities[0].kind).toBe('line');
    expect(out.nonPaintedPaths).toBe(2);
    expect(out.clippedGeometry).toBe(1);
    expect(out.entities[0].reason).toContain('ОТСЕЧЕНИЯ');
    expect(out.warnings.join(' ')).toContain('clipping');
  });
  it('restores clipping scope at Q and rejects unknown paint ops',()=>{
    const ops={...OPS,clip:29,eoClip:30,endPath:28,setGState:9,
      paintFormXObjectBegin:74,paintFormXObjectEnd:75};
    const path=[20,[Float32Array.from([0,10,20,1,90,20])],null];
    const wrong=[0,[Float32Array.from([0,10,20,1,90,20])],null];
    const clip=[29,[Float32Array.from([0,0,0,1,100,0])],null];
    const out=extractPdfPaths({
      fnArray:[10,91,91,11,91,91,9,74],
      argsArray:[[],clip,path,[],path,wrong,[],[]],
    },viewport,ops);
    expect(out.entities).toHaveLength(2);
    expect(out.clippedGeometry).toBe(1);
    expect(out.rejectedPaths).toBe(1);
    expect(out.entities[1].reason).not.toContain('ОТСЕЧЕНИЯ');
    expect(out.warnings.join(' ')).toContain('Form XObject');
    expect(out.warnings.join(' ')).toContain('прозрачность');
  });
  it('rejects empty/corrupt paths with explicit warning, never silent success',()=>{
    const out=extract([91,91],[[20,[null],null],[20,[],null]]);
    expect(out.entities).toHaveLength(0);
    expect(out.pathOperations).toBe(2);
    expect(out.warnings.length).toBeGreaterThan(0);
  });
  it('warns on capacity rather than presenting truncated conversion as complete',()=>{
    const out=extract([91],[[20,[Float32Array.from([0,0,0,1,10,0,0,10,10,1,20,10])],null]],1);
    expect(out.entities).toHaveLength(1);
    expect(out.truncated).toBe(true);
    expect(out.warnings.join(' ')).toContain('лимит');
  });
});
