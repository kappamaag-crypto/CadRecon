import {describe,it,expect} from 'vitest';
import {entity,newProject,validateProject} from './model';
import {autoDimensionCandidate,proposeAutoDimensions} from './dimensionTools';
describe('W4 explicit auto-dimension proposals, not real-world certification',()=>{
 it('creates a linked unverified aligned dimension for calibrated LINE',()=>{
  const s=newProject().sheets[0];s.calibrated=true;
  const line=entity('line',[{x:0,y:0},{x:30,y:40}]);line.verified=true;
  const d=autoDimensionCandidate(line,s)!;
  expect(d.kind).toBe('dimension');expect(d.text).toBe('50');
  expect(d.sourceId).toBe(line.id);expect(d.verified).toBe(false);
  expect(d.points).toEqual(line.points);expect(line.verified).toBe(true);
 });
 it('never invents millimeters for uncalibrated raster or image geometry',()=>{
  const s=newProject().sheets[0];
  const source=entity('line',[{x:0,y:0},{x:300,y:0}],'Автообводка','trace');
  const d=autoDimensionCandidate(source,s)!;
  expect(d.text).toBe('?');
  expect(d.reason).toContain('калибровки');
  expect(d.verified).toBe(false);
 });
 it('proposes an editable diameter leader, without claiming a physical hole',()=>{
  const p=newProject(),s=p.sheets[0],circle=entity('circle',[{x:50,y:50}]);
  circle.center={x:50,y:50};circle.radius=20;s.calibrated=true;
  const d=autoDimensionCandidate(circle,s)!;
  expect(d.kind).toBe('leader');expect(d.text).toBe('⌀40');
  expect(d.sourceId).toBe(circle.id);expect(d.reason).toContain('отверстие не подтверждено');
  s.entities=[circle,d];expect(validateProject(p)).toBe(p);
 });
 it('ignores axis, dash, degenerate and unsupported CAD primitives',()=>{
  const s=newProject().sheets[0];
  const line=entity('line',[{x:0,y:0},{x:80,y:0}]);line.lineStyle='center';
  expect(autoDimensionCandidate(line,s)).toBeNull();
  expect(autoDimensionCandidate(entity('axis',[{x:0,y:0},{x:80,y:0}]),s)).toBeNull();
  expect(autoDimensionCandidate(entity('line',[{x:0,y:0},{x:2,y:0}]),s)).toBeNull();
 });
 it('skips pre-existing dimensions, limits batch, and does not change sources',()=>{
  const s=newProject().sheets[0];
  s.entities=Array.from({length:230},(_,i)=>entity('line',[{x:0,y:i*10},{x:50,y:i*10}]));
  const before=JSON.stringify(s.entities);
  const a=proposeAutoDimensions(s);
  expect(a.additions).toHaveLength(200);expect(a.limited).toBe(true);
  expect(JSON.stringify(s.entities)).toBe(before);
  s.entities.push(a.additions[0]);
  const selected=proposeAutoDimensions(s,[s.entities[0]]);
  expect(selected.additions).toHaveLength(0);
  expect(selected.skipped).toBe(1);
 });
});
