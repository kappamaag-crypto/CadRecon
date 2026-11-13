import {describe,it,expect} from 'vitest';
import {newProject,entity,validateProject} from './model';
import {dist,snapPoint,scaleSheet,auditSheet} from './geometry';
import {createDxf} from './dxf';
describe('CadRecon model and export',()=>{
 it('calculates and snaps metric geometry',()=>{
  expect(dist({x:0,y:0},{x:30,y:40})).toBe(50);
  const l=entity('line',[{x:0,y:0},{x:100,y:0}]);
  expect(snapPoint({x:99,y:1},[l],3)).toEqual({x:100,y:0});
 });
 it('calibrates without losing shape geometry',()=>{
  const p=newProject(),l=entity('line',[{x:0,y:0},{x:10,y:0}]);p.sheets[0].entities=[l];
  const s=scaleSheet(p.sheets[0],600);expect(s.entities[0].points[1].x).toBe(6000);
  expect(s.calibrated).toBe(true);expect(validateProject(p).version).toBe(1);
  expect(()=>validateProject({...p,version:2})).toThrow();
 });
 it('emits native LINE, DIMENSION, TEXT and CIRCLE in DXF',()=>{
  const p=newProject(),s=p.sheets[0];
  const line=entity('line',[{x:0,y:0},{x:6000,y:0}]);
  const dim=entity('dimension',[{x:0,y:0},{x:6000,y:0}],'Размеры');
  const t=entity('text',[{x:0,y:40}],'Текст');t.text='Сталь';t.size=8;
  const c=entity('circle',[{x:4,y:4}]);c.center={x:4,y:4};c.radius=2;
  s.entities.push(line,dim,t,c);const dx=createDxf(s,p);
  for(const type of ['LINE','DIMENSION','TEXT','CIRCLE','BLOCK'])expect(dx).toContain('\n0\n'+type+'\n');
  expect(dx).toContain('\\U+0421');expect(dx.endsWith('0\nEOF\n')).toBe(true);
  expect(auditSheet(s,p).some(i=>i.severity==='warning')).toBe(true);
 });
});