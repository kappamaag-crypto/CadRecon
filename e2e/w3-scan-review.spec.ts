import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {entity,newProject,type Point} from '../src/model';

const point=(x:number,y:number):Point=>({x,y});
test('W3 visible-gap review stays in browser, does not auto-merge and exports CSV',async ({page})=>{
 const p=newProject();
 const a=entity('line',[point(10,20),point(60,20)],'Автообводка','trace');
 const b=entity('line',[point(64,20),point(120,20)],'Автообводка','trace');
 a.confidence=.8;b.confidence=.8;
 const weak=entity('line',[point(10,60),point(150,60)],'Автообводка','trace');
 weak.reason='Обводка: опора на исходный штрих 12%. Проверить по оригиналу.';
 p.sheets[0].entities=[a,b,weak];
 await page.goto('/CadRecon/');
 await page.locator('input[type=file][accept=".json,.cadrecon.json"]').setInputFiles({
  name:'w3.cadrecon.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(p)),
 });
 await expect(page.getByText(/Проект открыт:/)).toBeVisible();
 await page.locator('.panel-tabs button[title="Поиск и аудит"]').click();
 await page.getByRole('tab',{name:'Аудит объектов'}).click();
 await page.getByRole('button',{name:/W3: проверить топологию автообводки/}).click();
 await expect(page.getByText(/Возможных разрывов: 1/)).toBeVisible();
 await expect(page.getByText(/Слабо подтверждённых штрихов: 1/)).toBeVisible();
 const [csv]=await Promise.all([
  page.waitForEvent('download'),
  page.getByRole('button',{name:'↓ Диагностика W3 CSV'}).click(),
 ]);
 const text=await readFile((await csv.path())!,'utf8');
 expect(text).toContain('Возможный разрыв');
 expect(text).toContain('Слабое подтверждение');
 expect(text).toContain(a.id);
 const [download]=await Promise.all([
  page.waitForEvent('download'),page.getByRole('button',{name:'↓ JSON'}).click(),
 ]);
 const after=JSON.parse(await readFile((await download.path())!,'utf8')) as typeof p;
 expect(after.sheets[0].entities).toHaveLength(3);
 expect(after.sheets[0].entities.every(e=>!e.verified)).toBe(true);
 expect(after.sheets[0].entities[0].points).toEqual(a.points);
 expect(after.sheets[0].entities[1].points).toEqual(b.points);
});
