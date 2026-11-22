import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {newProject} from '../src/model';

const OUT='test-results/pages-goldens';
test.beforeAll(()=>execFileSync('python3',['benchmarks/w0/generate_fixtures.py','--out',OUT]));

test('Pages-only accurate mode preserves native PDF geometry without uploading source',async ({page})=>{
  const uploads:string[]=[];
  page.on('request',request=>{
    if(['POST','PUT','PATCH'].includes(request.method()))uploads.push(request.url());
  });
  await page.goto('/CadRecon/');
  await page.locator('input[type=file][accept*=".pdf"]').setInputFiles({
    name:'native_curves.pdf',mimeType:'application/pdf',
    buffer:await readFile(join(OUT,'native_curves.pdf')),
  });
  await expect(page.getByText(/Импортировано листов: 1/)).toBeVisible({timeout:60000});
  await page.getByRole('button',{name:/Точное распознавание в браузере/}).click();
  await expect(page.getByText(/Браузерное распознавание:/)).toBeVisible({timeout:25000});
  expect(uploads).toEqual([]);
  const [download]=await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button',{name:'↓ JSON'}).click(),
  ]);
  const name=await download.path();expect(name).toBeTruthy();
  const json=JSON.parse(await readFile(name!,'utf8')) as ReturnType<typeof newProject>;
  const entities=json.sheets[0].entities;
  expect(entities.filter(e=>e.kind==='line')).toHaveLength(2);
  expect(entities.filter(e=>e.kind==='circle')).toHaveLength(1);
  expect(entities.filter(e=>e.kind==='polyline')).toHaveLength(1);
  expect(entities.filter(e=>e.kind==='text')).toHaveLength(2);
});
test('Pages-only UI rejects an external Ultra URL before any document transmission',async ({page})=>{
  const p=newProject(),sheet=p.sheets[0];
  sheet.width=300;sheet.height=200;sheet.sourceType='image';
  sheet.image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL9SAAAAABJRU5ErkJggg==';
  const uploads:string[]=[];
  page.on('request',request=>{
    if(['POST','PUT','PATCH'].includes(request.method()))uploads.push(request.url());
  });
  await page.goto('/CadRecon/');
  await page.locator('input[type=file][accept=".json,.cadrecon.json"]').setInputFiles({
    name:'local-only.cadrecon.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(p)),
  });
  await page.locator('summary').filter({hasText:'Ultra'}).click();
  await page.getByLabel('Локальный адрес Ultra').fill('https://unknown-external.example.com');
  await page.getByLabel('Токен Ultra').fill('fixture-token');
  await page.getByRole('button',{name:/Распознать локальным Ultra/}).click();
  await expect(page.getByText(/Подключение разрешено только к модулю/)).toBeVisible();
  expect(uploads).toEqual([]);
});
