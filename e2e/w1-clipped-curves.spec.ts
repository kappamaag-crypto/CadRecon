import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pdfCubicAt,type PdfCubic} from '../src/pdfBezierClip';

const OUT='test-results/w1-clipped-curves';
test.beforeAll(()=>{
  execFileSync('python3',['benchmarks/w0/generate_fixtures.py','--out',OUT]);
});

test('W1 actual PDF.js import clips circle/cubic as editable SPLINE and does not close hidden rectangle edges',async ({page})=>{
  await page.goto('/CadRecon/');
  await page.locator('input[type=file][accept*=".pdf"]').setInputFiles({
    name:'native_clipped_curves.pdf',mimeType:'application/pdf',
    buffer:await readFile(join(OUT,'native_clipped_curves.pdf')),
  });
  await expect(page.getByText(/Импортировано листов: 1/)).toBeVisible({timeout:60000});
  const [download]=await Promise.all([
    page.waitForEvent('download'),page.getByRole('button',{name:'↓ JSON'}).click(),
  ]);
  const project=JSON.parse(await readFile((await download.path())!,'utf8')) as {
    sheets:Array<{width:number;entities:Array<{
      kind:string;origin:string;verified:boolean;
      points:Array<{x:number;y:number}>;
    }>;importWarnings?:string[]}>;
  };
  const sheet=project.sheets[0],scale=sheet.width/500,entities=sheet.entities;
  const curves=entities.filter(e=>e.kind==='bezier');
  const lines=entities.filter(e=>e.kind==='line');
  console.log('W1_PDF_CLIPPED_CURVES '+JSON.stringify({
    all:entities.length,beziers:curves.length,lines:lines.length,
    circles:entities.filter(e=>e.kind==='circle').length,
    warnings:sheet.importWarnings,
  }));
  expect(curves.length).toBeGreaterThan(2);
  expect(lines.length).toBe(2);
  expect(entities.filter(e=>e.kind==='circle'||e.kind==='ellipse'||e.kind==='polyline')).toHaveLength(0);
  expect(entities.every(e=>!e.verified&&e.origin==='pdf')).toBe(true);
  expect(sheet.importWarnings?.join(' ')).toContain('разделил');
  for(const curve of curves){
    for(let i=0;i<=40;i++){
      const p=pdfCubicAt(curve.points as PdfCubic,i/40);
      expect(p.x).toBeGreaterThanOrEqual(20*scale-.02);
      expect(p.x).toBeLessThanOrEqual(100*scale+.02);
      expect(p.y).toBeGreaterThanOrEqual(250*scale-.02);
      expect(p.y).toBeLessThanOrEqual(330*scale+.02);
    }
  }
  for(const line of lines){
    expect(line.points).toHaveLength(2);
    // PDF path winding may reverse an otherwise identical CAD LINE.
    const endpoints=line.points.map(p=>p.x).sort((a,b)=>a-b);
    expect(endpoints[0]).toBeCloseTo(20*scale,1);
    expect(endpoints[1]).toBeCloseTo(100*scale,1);
    expect(Math.abs(line.points[0].y-line.points[1].y)).toBeLessThan(.001);
  }
  page.once('dialog',d=>d.accept());
  const [dxfFile]=await Promise.all([
    page.waitForEvent('download'),page.getByRole('button',{name:'↓ DXF',exact:true}).click(),
  ]);
  const dxf=await readFile((await dxfFile.path())!,'utf8');
  expect(dxf).toContain('\n0\nSPLINE\n');
  expect(dxf).not.toContain('\n0\nCIRCLE\n');
  expect(dxf).not.toContain('\n0\nLWPOLYLINE\n');
});
