import {describe,it,expect} from 'vitest';
import {newProject,entity,type Entity} from './model';
import {auditNominalChains} from './dimensionAudit';
function dim(a:number,b:number,text:string,chainId?:string,y=100):Entity{
  const e=entity('dimension',[{x:a,y},{x:b,y}],'Размеры','ocr');
  e.text=text;e.chainId=chainId;e.verified=false;
  return e;
}
describe('W5 dimension-chain audit without invented geometry',()=>{
  it('verifies nominal closure but warns that mm/GOST are not proven',()=>{
    const s=newProject().sheets[0];s.entities=[
      dim(0,60,'60','chain-1'),dim(60,100,'40','chain-1'),dim(0,100,'100',undefined,120)];
    const report=auditNominalChains(s);
    expect(report.some(r=>r.severity==='info'&&r.message.includes('согласованы'))).toBe(true);
    expect(report.every(r=>r.severity!=='warning')).toBe(true);
    expect(s.entities.every(e=>!e.verified)).toBe(true);
  });
  it('flags total mismatch without modifying OCR or geometry',()=>{
    const s=newProject().sheets[0];s.entities=[
      dim(0,60,'6000','chain-1'),dim(60,100,'4000','chain-1'),dim(0,100,'10100',undefined,120)];
    const before=JSON.stringify(s.entities);
    const report=auditNominalChains(s);
    expect(report.some(r=>r.severity==='warning'&&r.message.includes('не совпадает'))).toBe(true);
    expect(JSON.stringify(s.entities)).toBe(before);
  });
  it('reports broken segments and unknown labels without guessing',()=>{
    const s=newProject().sheets[0];s.entities=[
      dim(0,40,'40','chain-2'),dim(50,100,'?', 'chain-2')];
    const report=auditNominalChains(s);
    expect(report.some(r=>r.severity==='warning'&&r.message.includes('не распознано'))).toBe(true);
    expect(report.some(r=>r.message.includes('согласованы'))).toBe(false);
  });
  it('does not imply a verified total dimension if none exists',()=>{
    const s=newProject().sheets[0];s.entities=[
      dim(0,40,'40','chain-3'),dim(40,100,'60','chain-3')];
    const report=auditNominalChains(s);
    expect(report.some(r=>r.severity==='info'&&r.message.includes('не найден'))).toBe(true);
  });
});
