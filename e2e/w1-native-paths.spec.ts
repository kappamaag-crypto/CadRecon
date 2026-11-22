import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';

type Pt={x:number;y:number};
type Entity={kind:string;origin:string;verified:boolean;points:Pt[];
  center?:Pt;radius?:number;closed?:boolean;text?:string};
type Sheet={width:number;height:number;entities:Entity[];importWarnings?:string[]};
type Project={sheets:Sheet[]};
const OUT='test-results/w1-goldens';
test.beforeAll(()=>{
  execFileSync('python3',['benchmarks/w0/generate_fixtures.py','--out',OUT]);
});
async function importPdf(page:import('@playwright/test').Page,filename:string):Promise<Project>{
  await page.goto('/CadRecon/');
  await page.locator('input[type=file][accept*=".pdf"]').setInputFiles({
    name:filename,mimeType:'application/pdf',buffer:await readFile(join(OUT,filename)),
  });
  await expect(page.getByText(/Импортировано листов: 1/)).toBeVisible({timeout:60_000});
  const [dl]=await Promise.all([
    page.waitForEvent('download'),page.getByRole('button',{name:'↓ JSON'}).click(),
  ]);
  const path=await dl.path();expect(path).toBeTruthy();
  return JSON.parse(await readFile(path!,'utf8')) as Project;
}
const ptError=(a:Pt,b:Pt)=>Math.hypot(a.x-b.x,a.y-b.y);
function lineError(line:Entity,expected:[Pt,Pt]) {
  const [a,b]=line.points,[x,y]=expected;
  return Math.min(Math.max(ptError(a,x),ptError(b,y)),
    Math.max(ptError(a,y),ptError(b,x)));
}
test('W1 gate: imports native PDF lines, rectangular contour and Bezier circle',async ({page})=>{
  const project=await importPdf(page,'native_curves.pdf');
  const sheet=project.sheets[0],scale=sheet.width/500;
  const lines=sheet.entities.filter(x=>x.kind==='line');
  const rects=sheet.entities.filter(x=>x.kind==='polyline'&&x.closed);
  const circles=sheet.entities.filter(x=>x.kind==='circle');
  const texts=sheet.entities.filter(x=>x.kind==='text').map(x=>x.text);
  expect(lines).toHaveLength(2);
  expect(rects).toHaveLength(1);
  expect(rects[0].points).toHaveLength(4);
  expect(circles).toHaveLength(1);
  expect(circles[0].center!.x/scale).toBeCloseTo(325,2);
  expect(350-circles[0].center!.y/scale).toBeCloseTo(135,2);
  expect(circles[0].radius!/scale).toBeCloseTo(40,2);
  expect(texts).toEqual(expect.arrayContaining(['6000','R20']));
  expect(sheet.importWarnings||[]).toHaveLength(0);
  expect(sheet.entities.every(e=>!e.verified)).toBe(true);
});
test('W1 gate: preserves independent affine q/cm/Q path transforms',async ({page})=>{
  const project=await importPdf(page,'native_ctm.pdf');
  const sheet=project.sheets[0],scale=sheet.width/500;
  const lines=sheet.entities.filter(x=>x.kind==='line');
  expect(lines).toHaveLength(2);
  const viewport=(p:Pt):Pt=>({x:p.x*scale,y:(350-p.y)*scale});
  const expected:[[Pt,Pt],[Pt,Pt]]=[
    [viewport({x:50,y:80}),viewport({x:130,y:80})],
    [viewport({x:180,y:40}),viewport({x:180,y:120})],
  ];
  const errors=expected.map(pair=>Math.min(...lines.map(e=>lineError(e,pair)))/scale);
  expect(errors.every(x=>x<.025)).toBe(true);
  expect(sheet.importWarnings||[]).toHaveLength(0);
});
