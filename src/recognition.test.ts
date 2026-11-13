import {describe,it,expect} from 'vitest';
import {newProject,entity} from './model';
import {reconstructDimensionChains} from './dimensions';
import {ESKD_SYMBOLS,detectESKDLabels,eskdParts,classifyESKDText} from './eskd';
import {createDxf} from './dxf';
import {writeFileSync} from 'node:fs';
function line(x0:number,y0:number,x1:number,y1:number){
  return entity('line',[{x:x0,y:y0},{x:x1,y:y1}],'Автообводка','trace');
}
function label(txt:string,x0:number,x1:number){
  const e=entity('text',[{x:x0,y:94}],'OCR','ocr');
  e.text=txt;e.size=10;e.confidence=93;e.bbox={x0,y0:84,x1,y1:94};return e;
}
describe('semantic OCR and ESKD CAD reconstruction',()=>{
 it('recovers a two-span horizontal chain with witness lines and groups it',()=>{
  const s=newProject().sheets[0];
  s.entities=[line(0,100,50,100),line(50,100,100,100),
    line(0,80,0,115),line(50,80,50,115),line(100,80,100,115),
    label('6000',20,30),label('6000',70,80)];
  const r=reconstructDimensionChains(s);
  expect(r.inspected).toBe(2);expect(r.dimensions).toHaveLength(2);
  expect(r.dimensions.map(x=>x.text)).toEqual(['6000','6000']);
  expect(r.dimensions[0].points).toEqual([{x:0,y:100},{x:50,y:100}]);
  expect(r.dimensions.every(x=>!x.verified&&!!x.sourceId&&(x.confidence||0)>.6)).toBe(true);
  expect(r.chains).toHaveLength(1);expect(r.chains[0].sum).toBe(12000);
 });
 it('does not fabricate dimensions without extension-line evidence',()=>{
  const s=newProject().sheets[0];s.entities=[line(0,100,100,100),label('6000',47,57)];
  expect(reconstructDimensionChains(s).dimensions).toHaveLength(0);
 });
 it('flags OCR value disagreement with calibrated geometry instead of stretching it',()=>{
  const s=newProject().sheets[0];s.calibrated=true;
  s.entities=[line(0,100,50,100),line(0,80,0,115),line(50,80,50,115),label('6000',20,30)];
  const r=reconstructDimensionChains(s);
  expect(r.dimensions).toHaveLength(1);
  expect(r.dimensions[0].reason).toContain('НЕ СОВПАДАЕТ');
  expect(r.dimensions[0].points[1].x).toBe(50);
 });
 it('classifies only explicit ESKD patterns, preserves review state',()=>{
  expect(classifyESKDText('6000')).toBeNull();
  expect(classifyESKDText('Ra 3,2')?.symbol).toBe('roughness');
  expect(classifyESKDText('⌀20')?.symbol).toBe('diameter');
  expect(classifyESKDText('M16')?.symbol).toBe('thread');
  const a=label('Ra 3,2',15,60),b=label('R20',20,50);
  const hits=detectESKDLabels([a,b]);
  expect(hits).toHaveLength(2);expect(hits[0].verified).toBe(false);
  expect(hits[0].sourceId).toBe(a.id);expect(hits[0].confidence).toBeLessThan(.86);
 });
 it('exports every ESKD template as one editable INSERT with primitives',()=>{
  const p=newProject(),s=p.sheets[0];s.calibrated=true;
  ESKD_SYMBOLS.forEach((type,i)=>{
    const e=entity('eskd',[{x:i*70,y:80}],'ЕСКД');
    e.symbol=type.id;e.text=type.defaultText;e.size=4;e.verified=false;
    expect(eskdParts(e).length).toBeGreaterThan(0);s.entities.push(e);
  });
  const out=createDxf(s,p);
  expect((out.match(/\n0\nINSERT\n/g)||[]).length).toBe(ESKD_SYMBOLS.length);
  expect(out).toContain('ESKD_1');
  writeFileSync('/tmp/cadrecon-eskd-test.dxf',out,'utf8');
 });
});