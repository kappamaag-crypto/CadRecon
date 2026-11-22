import {describe,it,expect} from 'vitest';
import {extractPdfPaths} from './pdfPaths';
import {newProject} from './model';
import {createDxf} from './dxf';
import {pdfCubicAt,type PdfCubic} from './pdfBezierClip';

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
  it('extracts four cubic quarters of a noncircular PDF ellipse as native editable ELLIPSE',()=>{
    const x=180,y=120,rx=80,ry=32;
    const packed=[0,x+rx,y,
      2,x+rx,y+k*ry,x+k*rx,y+ry,x,y+ry,
      2,x-k*rx,y+ry,x-rx,y+k*ry,x-rx,y,
      2,x-rx,y-k*ry,x-k*rx,y-ry,x,y-ry,
      2,x+k*rx,y-ry,x+rx,y-k*ry,x+rx,y,4];
    const out=extract([91],[[20,[Float32Array.from(packed)],null]]);
    expect(out.entities).toHaveLength(1);
    const ell=out.entities[0];
    expect(ell.kind).toBe('ellipse');
    expect(ell.center).toEqual({x:180,y:230});
    expect(ell.radius).toBeCloseTo(80,2);
    expect(ell.axisRatio).toBeCloseTo(.4,3);
    expect(ell.verified).toBe(false);
    const project=newProject();project.sheets[0].entities=out.entities;
    const dx=createDxf(project.sheets[0],project);
    expect(dx).toContain('\n0\nELLIPSE\n');
    expect(dx).toContain('\n40\n0.4\n');
  });
  it('keeps arbitrary four Bezier loop as splines, not a fabricated ellipse',()=>{
    const packed=[0,0,0,
      2,10,0,50,0,60,0,
      2,70,10,70,20,60,30,
      2,40,40,20,40,0,30,
      2,-10,20,-10,10,0,0,4];
    const out=extract([91],[[20,[Float32Array.from(packed)],null]]);
    expect(out.entities.every(e=>e.kind!=='ellipse')).toBe(true);
    expect(out.entities.some(e=>e.kind==='bezier')).toBe(true);
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


  it('accepts real PDF.js split OPS: constructPath(END_PATH) → clip → painted path',()=>{
    const ops={...OPS,clip:29,endPath:28};
    const rectangle=[28,[Float32Array.from([
      0,20,20,1,100,20,1,100,100,1,20,100,4,
    ])],null];
    const cross=[20,[Float32Array.from([0,-50,60,1,160,60])],null];
    const result=extractPdfPaths({
      fnArray:[91,29,91],argsArray:[rectangle,[],cross],
    },viewport,ops);
    expect(result.entities).toHaveLength(1);
    expect(result.nonPaintedPaths).toBe(1);
    expect(result.rectangularClipLines).toBe(1);
    expect(result.clippedGeometry).toBe(0);
    expect(result.entities[0].points[0].x).toBeCloseTo(20,5);
    expect(result.entities[0].points[1].x).toBeCloseTo(100,5);
  });
  it('also accepts separate PDF.js clip operator BEFORE its endPath construction',()=>{
    const ops={...OPS,clip:29,endPath:28};
    const rectangle=[28,[Float32Array.from([
      0,20,20,1,100,20,1,100,100,1,20,100,4,
    ])],null];
    const cross=[20,[Float32Array.from([0,-50,60,1,160,60])],null];
    const result=extractPdfPaths({
      fnArray:[29,91,91],argsArray:[[],rectangle,cross],
    },viewport,ops);
    expect(result.entities).toHaveLength(1);
    expect(result.rectangularClipLines).toBe(1);
    expect(result.entities[0].points.map(p=>p.x)).toEqual([20,100]);
  });
  it('preserves printed PDF DASHED/CENTER line pattern and q/Q state in editable DXF',()=>{
    const ops={...OPS,setDash:15};
    const line=[20,[Float32Array.from([0,20,60,1,100,60])],null];
    const result=extractPdfPaths({
      fnArray:[10,15,91,15,91,15,91,11,91],
      argsArray:[[],
        [[12,7],0],line,
        [[25,5,3,5],0],line,
        [[2,1,2,1,2,1],0],line,
        [],line],
    },viewport,ops);
    expect(result.entities).toHaveLength(4);
    expect(result.entities.map(e=>e.lineStyle)).toEqual([
      'dashed','center',undefined,undefined,
    ]);
    const project=newProject();project.sheets[0].entities=result.entities;
    const dxf=createDxf(project.sheets[0],project);
    expect(dxf).toContain('\n6\nDASHED\n');
    expect(dxf).toContain('\n6\nCENTER\n');
  });
  it('never attributes a PDF dash pattern to a fill-only path or forms a fake continuous dashed polyline',()=>{
    const ops={...OPS,setDash:15};
    const filled=[22,[Float32Array.from([0,20,20,1,100,20])],null];
    const closed=[20,[Float32Array.from([
      0,20,20,1,100,20,1,100,100,1,20,100,4,
    ])],null];
    const result=extractPdfPaths({fnArray:[15,91,91],
      argsArray:[[[9,5],0],filled,closed]},viewport,ops);
    expect(result.entities.filter(e=>e.kind==='line')).toHaveLength(5);
    const lines=result.entities.filter(e=>e.kind==='line');
    expect(lines[0].lineStyle).toBeUndefined();
    expect(lines.slice(1).every(e=>e.lineStyle==='dashed')).toBe(true);
    expect(result.entities.some(e=>e.kind==='polyline')).toBe(false);
  });
  it('clips a straight vector LINE to a packed closed rectangular W path',()=>{
    const clip=[29,[Float32Array.from([
      0,20,20,1,100,20,1,100,100,1,20,100,4,
    ])],null];
    const crossing=[20,[Float32Array.from([0,-50,60,1,160,60])],null];
    const outside=[20,[Float32Array.from([0,-50,120,1,160,120])],null];
    const out=extract([10,91,91,91,11,91],[[],clip,crossing,outside,[],crossing]);
    const lines=out.entities.filter(e=>e.kind==='line');
    expect(lines).toHaveLength(2);
    // viewport [x,350-y] => rectangle x 20..100, y 250..330
    expect(lines[0].points[0].x).toBeCloseTo(20,5);
    expect(lines[0].points[1].x).toBeCloseTo(100,5);
    expect(lines[0].verified).toBe(false);
    // q/Q restores original, unclipped geometry.
    expect(lines[1].points[0].x).toBe(-50);
    expect(lines[1].points[1].x).toBe(160);
    expect(out.rectangularClipLines).toBe(2);
    expect(out.clippedGeometry).toBe(0);
  });
  it('culls invisible native circles/Bezier and exactly clips partially visible curves',()=>{
    const clip=[29,[Float32Array.from([0,20,20,1,100,20,1,100,100,1,20,100,4])],null];
    const circle=(cx:number,cy:number,r:number)=>{
      const d=k*r;
      return [20,[Float32Array.from([0,cx+r,cy,
        2,cx+r,cy+d,cx+d,cy+r,cx,cy+r,
        2,cx-d,cy+r,cx-r,cy+d,cx-r,cy,
        2,cx-r,cy-d,cx-d,cy-r,cx,cy-r,
        2,cx+d,cy-r,cx+r,cy-d,cx+r,cy,4])],null];
    };
    const outside=[20,[Float32Array.from([0,150,150,2,165,155,180,170,200,170])],null];
    const inside=[20,[Float32Array.from([0,25,25,2,30,30,45,30,50,25])],null];
    const crossing=[20,[Float32Array.from([0,80,80,2,95,105,130,120,140,125])],null];
    const out=extract([91,91,91,91,91,91],
      [clip,circle(50,50,12),circle(200,180,10),outside,inside,crossing]);
    expect(out.entities.filter(e=>e.kind==='circle')).toHaveLength(1);
    expect(out.entities.some(e=>e.kind==='bezier'&&e.reason?.includes('полностью внутри'))).toBe(true);
    expect(out.entities.some(e=>e.kind==='bezier'&&e.reason?.includes('прямоугольное отсечение рассчитано'))).toBe(true);
    expect(out.fullyClippedObjects).toBe(2);
    expect(out.clippedGeometry).toBe(0);
    expect(out.rectangularClipCurves).toBe(1);
    expect(out.entities.every(e=>!e.verified)).toBe(true);
  });

  it('splits partly clipped cubic PDF circle into exact SPLINE quarters, never exports invisible full CIRCLE',()=>{
    const clip=[29,[Float32Array.from([0,20,20,1,100,20,1,100,100,1,20,100,4])],null];
    const cx=80,cy=60,r=35,d=k*r;
    const circle=[20,[Float32Array.from([
      0,cx+r,cy,
      2,cx+r,cy+d,cx+d,cy+r,cx,cy+r,
      2,cx-d,cy+r,cx-r,cy+d,cx-r,cy,
      2,cx-r,cy-d,cx-d,cy-r,cx,cy-r,
      2,cx+d,cy-r,cx+r,cy-d,cx+r,cy,4,
    ])],null];
    const out=extract([91,91],[clip,circle]);
    expect(out.entities.some(e=>e.kind==='circle'||e.kind==='ellipse')).toBe(false);
    const curves=out.entities.filter(e=>e.kind==='bezier');
    expect(curves.length).toBeGreaterThan(0);
    expect(out.rectangularClipCurves).toBeGreaterThan(0);
    for(const curve of curves){
      const points=curve.points as PdfCubic;
      for(let i=0;i<=40;i++){
        const p=pdfCubicAt(points,i/40);
        expect(p.x).toBeGreaterThanOrEqual(20-1e-6);
        expect(p.x).toBeLessThanOrEqual(100+1e-6);
        expect(p.y).toBeGreaterThanOrEqual(250-1e-6);
        expect(p.y).toBeLessThanOrEqual(330+1e-6);
      }
    }
    const project=newProject();project.sheets[0].entities=curves;
    const dxf=createDxf(project.sheets[0],project);
    expect((dxf.match(/\n0\nSPLINE\n/g)||[]).length).toBe(curves.length);
    expect(dxf).not.toContain('\n0\nCIRCLE\n');
  });
  it('keeps only visible STROKED rectangle edges, never inserts a false clipping-boundary closure',()=>{
    const clip=[29,[Float32Array.from([0,20,20,1,100,20,1,100,100,1,20,100,4])],null];
    const outsideRectangle=[20,[Float32Array.from([
      0,-30,30,1,150,30,1,150,95,1,-30,95,4,
    ])],null];
    const out=extract([91,91],[clip,outsideRectangle]);
    expect(out.entities).toHaveLength(2);
    expect(out.entities.every(e=>e.kind==='line'&&e.points.length===2)).toBe(true);
    expect(out.entities.every(e=>Math.abs(e.points[0].y-e.points[1].y)<1e-6)).toBe(true);
    expect(out.entities.every(e=>e.points[0].x>=20-1e-8&&e.points[1].x<=100+1e-8)).toBe(true);
    expect(out.rectangularClipLines).toBe(4);
    expect(out.entities.some(e=>e.kind==='polyline')).toBe(false);
  });
  it('refuses to falsely clip vectors through a rotated/nonrectangular path',()=>{
    const irregular=[29,[Float32Array.from([
      0,20,20,1,100,20,1,60,100,1,20,100,4,
    ])],null];
    const line=[20,[Float32Array.from([0,0,60,1,160,60])],null];
    const out=extract([91,91],[irregular,line]);
    expect(out.entities).toHaveLength(1);
    expect(out.entities[0].points[0].x).toBe(0);
    expect(out.clippedGeometry).toBe(1);
    expect(out.rectangularClipLines).toBe(0);
    expect(out.warnings.join(' ')).toContain('clipping');
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
