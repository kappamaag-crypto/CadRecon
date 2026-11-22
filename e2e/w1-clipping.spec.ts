import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {readFile,mkdir} from 'node:fs/promises';

test('PDF.js 5.x real clipped and unpainted paths do NOT become editable CAD lines',async ({page})=>{
  await mkdir('test-results',{recursive:true});
  const pdf=[
    '0.8 w',
    'q',
    '10 10 90 90 re W n',
    '10 25 m 80 25 l S',
    'Q',
    '120 25 m 180 25 l n',
  ].join('\\n')+'\\n';
  execFileSync('python3',['-c',[
    'from pathlib import Path',
    'import runpy',
    'g=runpy.run_path("benchmarks/w0/generate_fixtures.py")',
    'g["pdf_page"](Path("test-results/w1-clipping.pdf"),'+JSON.stringify(pdf)+')',
  ].join('\n')]);
  await page.goto('/CadRecon/');
  await page.locator('input[type=file][accept*=".pdf"]').setInputFiles({
    name:'w1-clipping.pdf',mimeType:'application/pdf',
    buffer:await readFile('test-results/w1-clipping.pdf'),
  });
  await expect(page.getByText(/Импортировано листов: 1/)).toBeVisible({timeout:60000});
  const [dl]=await Promise.all([
    page.waitForEvent('download'),page.getByRole('button',{name:'↓ JSON'}).click(),
  ]);
  const p=JSON.parse(await readFile((await dl.path())!,'utf8')) as {
    sheets:Array<{entities:Array<{kind:string}>,importWarnings?:string[]}>;
  };
  const s=p.sheets[0];
  expect(s.entities.filter(x=>x.kind==='line')).toHaveLength(1);
  expect(s.entities.filter(x=>x.kind==='polyline')).toHaveLength(0);
  expect((s.importWarnings||[]).join(' ')).toMatch(/clipping|отсечен|невидим/i);
});