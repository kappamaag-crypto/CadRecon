import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';

const OUT='test-results/w1-lossless';
test.beforeAll(()=>{execFileSync('python3',['benchmarks/w0/generate_fixtures.py','--out',OUT]);});
test('W1/W3 PDF rendering retains a lossless scan source before OCR and tracing',async ({page})=>{
  await page.goto('/CadRecon/');
  await page.locator('input[type=file][accept*=".pdf"]').setInputFiles({
    name:'native_curves.pdf',mimeType:'application/pdf',
    buffer:await readFile(join(OUT,'native_curves.pdf')),
  });
  await expect(page.getByText(/Импортировано листов: 1/)).toBeVisible({timeout:60_000});
  const [download]=await Promise.all([page.waitForEvent('download'),
    page.getByRole('button',{name:'↓ JSON'}).click()]);
  const project=JSON.parse(await readFile((await download.path())!,'utf8'));
  const sheet=project.sheets[0];
  expect(sheet.image).toMatch(/^data:image\/png;base64,/);
  expect((sheet.importWarnings||[]).some((w:string)=>w.includes('сжата с потерями'))).toBe(false);
  expect(sheet.entities.some((e:{kind:string})=>e.kind==='circle')).toBe(true);
});
