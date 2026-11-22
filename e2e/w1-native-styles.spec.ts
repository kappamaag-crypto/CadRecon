import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {mkdir,readFile} from 'node:fs/promises';

test('W1 real PDF dashed/center stroke style survives browser PDF.js import and editable DXF',async({page})=>{
  await mkdir('test-results',{recursive:true});
  const commands=[
    '1 w','q [18 9] 0 d 20 40 m 360 40 l S Q',
    'q [28 6 3 6] 0 d 20 80 m 360 80 l S Q',
    '20 120 m 360 120 l S',
  ].join('\n')+'\n';
  execFileSync('python3',['-c',[
    'from pathlib import Path','import runpy',
    'fn=runpy.run_path("benchmarks/w0/generate_fixtures.py")["pdf_page"]',
    'fn(Path("test-results/w1-native-dash.pdf"),'+JSON.stringify(commands)+')',
  ].join('\n')]);
  await page.goto('/CadRecon/');
  await page.locator('input[type=file][accept*=".pdf"]').setInputFiles({
    name:'w1-native-dash.pdf',mimeType:'application/pdf',
    buffer:await readFile('test-results/w1-native-dash.pdf'),
  });
  await expect(page.getByText(/Импортировано листов: 1/)).toBeVisible({timeout:60000});
  const [download]=await Promise.all([
    page.waitForEvent('download'),page.getByRole('button',{name:'↓ JSON'}).click(),
  ]);
  const project=JSON.parse(await readFile((await download.path())!,'utf8')) as {
    sheets:Array<{entities:Array<{kind:string;lineStyle?:string;verified:boolean;origin:string}>}>;
  };
  const lines=project.sheets[0].entities.filter(e=>e.kind==='line');
  console.log('W1_REAL_PDF_STROKE_STYLES '+JSON.stringify(lines.map(e=>e.lineStyle||'solid')));
  expect(lines).toHaveLength(3);
  expect(lines.map(e=>e.lineStyle||'solid')).toEqual(['dashed','center','solid']);
  expect(lines.every(e=>!e.verified&&e.origin==='pdf')).toBe(true);
  page.once('dialog',d=>d.accept());
  const [dxfDownload]=await Promise.all([
    page.waitForEvent('download'),page.getByRole('button',{name:'↓ DXF',exact:true}).click(),
  ]);
  const dxf=await readFile((await dxfDownload.path())!,'utf8');
  expect((dxf.match(/\n0\nLINE\n/g)||[]).length).toBe(3);
  expect(dxf).toContain('\n6\nDASHED\n');
  expect(dxf).toContain('\n6\nCENTER\n');
});
