import {writeFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import {newProject,entity,validateProject} from './model';
import {dist,snapPoint,scaleSheet,auditSheet,mergeAutoLines,measure} from './geometry';
import {createDxf} from './dxf';
import {createZip} from './zip';
describe('CadRecon model and export',()=>{
 it('calculates and snaps metric geometry',()=>{
  expect(dist({x:0,y:0},{x:30,y:40})).toBe(50);
  const l=entity('line',[{x:0,y:0},{x:100,y:0}]);
  expect(snapPoint({x:99,y:1},[l],3)).toEqual({x:100,y:0});
 });
 it('merges imported collinear fragments but preserves manually drawn lines',()=>{
  const a=entity('line',[{x:0,y:0},{x:10,y:0}],'PDF векторы','pdf');
  const b=entity('line',[{x:9.5,y:0},{x:20,y:0}],'PDF векторы','pdf');
  const manual=entity('line',[{x:20,y:0},{x:30,y:0}]);
  const out=mergeAutoLines([a,b,manual],1);expect(out.removed).toBe(1);
  expect(out.entities.length).toBe(2);expect(out.entities.some(e=>e.id===manual.id)).toBe(true);
 });
 it('never closes a visible gap even when the old merge tolerance would bridge it',()=>{
  const a=entity('line',[{x:0,y:0},{x:10,y:0}],'PDF векторы','pdf');
  const b=entity('line',[{x:10.4,y:0},{x:20,y:0}],'PDF векторы','pdf');
  const result=mergeAutoLines([a,b],2);
  expect(result.removed).toBe(0);
  expect(result.entities).toHaveLength(2);
  expect(result.entities[0].points).toEqual(a.points);
  expect(result.entities[1].points).toEqual(b.points);
 });
 it('does not merge separate close PDF lines, crossing strokes or different provenance',()=>{
  const a=entity('line',[{x:0,y:0},{x:100,y:0}],'PDF векторы','pdf');
  const b=entity('line',[{x:0,y:.001},{x:100,y:.001}],'PDF векторы','pdf');
  const c=entity('line',[{x:60,y:-40},{x:60,y:40}],'PDF векторы','pdf');
  const d=entity('line',[{x:10,y:0},{x:80,y:0}],'PDF векторы','trace');
  expect(mergeAutoLines([a,b,c,d],2).removed).toBe(0);
 });
 it('deduplicates matching scan hypotheses but keeps distinct nearby scan contours',()=>{
  const a=entity('line',[{x:0,y:10},{x:100,y:10}],'Автообводка','trace');
  const b=entity('line',[{x:20,y:10.05},{x:90,y:10.05}],'Автообводка','trace');
  const c=entity('line',[{x:0,y:10.6},{x:100,y:10.6}],'Автообводка','trace');
  const output=mergeAutoLines([a,b,c],2);
  expect(output.removed).toBe(1);
  expect(output.entities).toHaveLength(2);
  expect(output.entities.every(x=>!x.verified)).toBe(true);
  expect(output.entities.some(x=>x.id===c.id)).toBe(true);
 });
 it('does not erase dashed/center lines while cleaning solid auto-duplicates',()=>{
  const solid=entity('line',[{x:0,y:30},{x:100,y:30}],'Автообводка','trace');
  const dashed=entity('line',[{x:15,y:30},{x:90,y:30}],'Автообводка','trace');
  dashed.lineStyle='dashed';
  const center=entity('line',[{x:15,y:30},{x:90,y:30}],'Автообводка','trace');
  center.lineStyle='center';
  const result=mergeAutoLines([solid,dashed,center],2);
  expect(result.removed).toBe(0);
  expect(result.entities).toHaveLength(3);
 });
 it('does not falsely approve manual objects or report pixel lengths as millimetres',()=>{
  const p=newProject(),manual=entity('line',[{x:0,y:0},{x:30,y:40}]);
  expect(manual.verified).toBe(false);
  manual.verified=true;
  p.sheets[0].entities=[manual];
  const scaled=scaleSheet(p.sheets[0],2);
  expect(scaled.calibrated).toBe(true);
  expect(scaled.entities[0].verified).toBe(false);
  expect(measure({x:0,y:0},{x:30,y:40})).toContain('усл. ед.');
  expect(measure({x:0,y:0},{x:30,y:40},true)).toBe('50.00 мм');
 });
 it('calibrates without losing shape geometry',()=>{
  const p=newProject(),l=entity('line',[{x:0,y:0},{x:10,y:0}]);p.sheets[0].entities=[l];
  const s=scaleSheet(p.sheets[0],600);expect(s.entities[0].points[1].x).toBe(6000);
  expect(s.calibrated).toBe(true);expect(validateProject(p).version).toBe(1);
  expect(()=>validateProject({...p,version:2})).toThrow();
 });
 it('rejects untrusted project images, malformed layer names and DXF resource bombs',()=>{
  const p=newProject();
  expect(()=>validateProject({...p,sheets:[{...p.sheets[0],image:'https://example.invalid/tracker.png'}]})).toThrow(/подложка/);
  expect(()=>validateProject({...p,sheets:[{...p.sheets[0],image:'data:image/svg+xml;base64,PHN2Zz4='}]})).toThrow(/подложка/);
  const forged=entity('line',[{x:0,y:0},{x:20,y:0}],'BAD\\n0\\nLINE');
  expect(()=>validateProject({...p,sheets:[{...p.sheets[0],entities:[{...forged,layer:'BAD\n0\nLINE'}]}]})).toThrow();
  const table=entity('table',[{x:0,y:0}],'Текст');table.rows=100000000;
  expect(()=>validateProject({...p,sheets:[{...p.sheets[0],entities:[table]}]})).toThrow();
  // Export must also sanitize any manually edited layer names before validation.
  p.layers[0].name='INJECT\n0\nLINE';
  expect(createDxf(p.sheets[0],p)).not.toContain('INJECT\n0\nLINE');
 });
 it('rejects incomplete text and ambiguous verified field before the CAD editor can crash or trust it',()=>{
  const p=newProject();
  const t=entity('text',[], 'Текст','ocr');t.text='6000';
  expect(()=>validateProject({...p,sheets:[{...p.sheets[0],entities:[t]}]})).toThrow(/геометрия/);
  const shape=entity('line',[{x:0,y:0},{x:10,y:0}]);
  const forged={...shape,verified:'true'};
  expect(()=>validateProject({...p,sheets:[{...p.sheets[0],entities:[forged]}]})).toThrow();
  expect(()=>validateProject({...p,sheets:[{...p.sheets[0],sourceType:'remote'}]})).toThrow();
 });
 it('packs multiple DXF sheets in a standard ZIP',()=>{
  const p=newProject();const z=createZip([{name:'лист_01.dxf',data:createDxf(p.sheets[0],p)},{name:'02.dxf',data:'test'}]);
  expect(z[0]).toBe(0x50);expect(z[1]).toBe(0x4b);writeFileSync('/tmp/cadrecon-test.zip',z);
 });
 it('writes a unitless native cubic SPLINE for an uncalibrated PDF import',()=>{
  const project=newProject(),s=project.sheets[0];
  const c=entity('bezier',[{x:0,y:0},{x:20,y:40},{x:40,y:40},{x:60,y:0}],'PDF векторы','pdf');
  c.verified=false;s.entities.push(c);
  const dxf=createDxf(s,project);
  expect(dxf).toContain('\n0\nSPLINE\n');
  expect(dxf).toContain('\n$INSUNITS\n70\n0\n');
  writeFileSync('/tmp/cadrecon-spline-test.dxf',dxf,'utf8');
 });
 it('exports line-style candidates to explicit native DXF linetypes, never verifies scans',()=>{
  const project=newProject(),s=project.sheets[0];
  const dash=entity('line',[{x:0,y:0},{x:120,y:0}],'Автообводка','trace');
  dash.lineStyle='dashed';
  const center=entity('line',[{x:0,y:20},{x:120,y:20}],'Автообводка','trace');
  center.lineStyle='center';
  s.entities=[dash,center];
  const dxf=createDxf(s,project);
  expect(dxf).toContain('DASHED');
  expect(dxf).toContain('CENTER');
  expect(dxf).toContain('6\nDASHED');
  expect(dxf).toContain('6\nCENTER');
  writeFileSync('/tmp/cadrecon-styled-test.dxf',dxf,'utf8');
  expect(validateProject(project).sheets[0].entities[0].verified).toBe(false);
  const bad=entity('line',[{x:0,y:0},{x:10,y:0}]);
  (bad as unknown as {lineStyle:string}).lineStyle='evil';
  expect(()=>validateProject({...project,sheets:[{...s,entities:[bad]}]})).toThrow();
 });
 it('exports native ELLIPSE and aligned/horizontal/vertical DIMENSION but excludes construction lines',()=>{
  const p=newProject(),s=p.sheets[0];
  const ellipse=entity('ellipse',[{x:50,y:50},{x:100,y:50}]);
  ellipse.center={x:50,y:50};ellipse.radius=50;ellipse.axisRatio=.5;
  const aux=entity('construction',[{x:0,y:50},{x:1,y:50}],'Вспомогательные');
  const a=entity('dimension',[{x:0,y:0},{x:30,y:40}],'Размеры');
  const h=entity('dimension',[{x:0,y:10},{x:30,y:40}],'Размеры');
  h.dimMode='horizontal';h.text='30';h.offset=20;
  const v=entity('dimension',[{x:20,y:10},{x:30,y:40}],'Размеры');
  v.dimMode='vertical';v.text='30';v.offset=20;
  s.entities=[ellipse,aux,a,h,v];
  expect(validateProject(p)).toBe(p);
  const dxf=createDxf(s,p);
  expect(dxf).toContain('\n0\nELLIPSE\n');
  expect(dxf).toContain('\n40\n0.5\n');
  expect(dxf).toContain('\n100\nAcDbRotatedDimension\n');
  expect((dxf.match(/\n0\nDIMENSION\n/g)||[])).toHaveLength(3);
  expect(dxf).not.toContain('\n0\nXLINE\n');
  writeFileSync('/tmp/cadrecon-cadtools-test.dxf',dxf,'utf8');
 });
 it('exports schematic diagonal hatching as bounded editable LINEs without mislabeling native associative HATCH',()=>{
  const p=newProject(),s=p.sheets[0];
  const h=entity('hatch',[{x:0,y:0},{x:100,y:0},{x:100,y:80},{x:0,y:80}],'Штриховка');
  h.hatchPattern='diagonal';h.hatchSpacing=12;
  s.entities=[h];
  expect(validateProject(p)).toBe(p);
  const dxf=createDxf(s,p);
  expect(dxf).toContain('\n0\nLWPOLYLINE\n');
  expect((dxf.match(/\n0\nLINE\n/g)||[]).length).toBeGreaterThan(5);
  expect(dxf).not.toContain('\n0\nHATCH\n');
  writeFileSync('/tmp/cadrecon-hatch-linework-test.dxf',dxf,'utf8');
 });
 it('emits native LINE, DIMENSION, TEXT and CIRCLE in DXF',()=>{
  const p=newProject(),s=p.sheets[0];
  const line=entity('line',[{x:0,y:0},{x:6000,y:0}]);
  const dim=entity('dimension',[{x:0,y:0},{x:6000,y:0}],'Размеры');
  const t=entity('text',[{x:0,y:40}],'Текст');t.text='Сталь';t.size=8;
  const c=entity('circle',[{x:4,y:4}]);c.center={x:4,y:4};c.radius=2;
  const h=entity('hatch',[{x:0,y:0},{x:20,y:0},{x:10,y:20}],'Штриховка');
  const axis=entity('axis',[{x:0,y:0},{x:0,y:100}],'Оси');
  s.entities.push(line,dim,t,c,h,axis);const dx=createDxf(s,p);
  for(const type of ['LINE','DIMENSION','TEXT','CIRCLE','BLOCK','HATCH'])expect(dx).toContain('\n0\n'+type+'\n');
  writeFileSync('/tmp/cadrecon-test.dxf',dx,'utf8');
  expect(dx).toContain('\\U+0421');expect(dx.endsWith('0\nEOF\n')).toBe(true);
  expect(auditSheet(s,p).some(i=>i.severity==='warning')).toBe(true);
 });
});