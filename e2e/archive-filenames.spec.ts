import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

test('GALS-inspired native CAD filename proposals require chosen files and never upload their contents',async ({page})=>{
 const transmitted:string[]=[];
 page.on('request',r=>{
   if(['POST','PUT','PATCH','DELETE'].includes(r.method()))transmitted.push(r.url());
 });
 await page.goto('/CadRecon/');
 await page.locator('.panel-tabs button[title="Поиск и аудит"]').click();
 await page.getByRole('tab',{name:'Файлы КОМПАС'}).click();
 await page.locator('.archive-tools input[type=file]').setInputFiles([
   {name:'АБВГ.01.001 - Опора.a3d',mimeType:'application/octet-stream',buffer:Buffer.from('dummy-not-a-native-cad-file')},
   {name:'Неизвестная деталь.m3d',mimeType:'application/octet-stream',buffer:Buffer.from('dummy-m3d')},
 ]);
 await expect(page.getByText(/Кандидатов: 1,/)).toBeVisible();
 await expect(page.getByText(/неразобранных: 1/)).toBeVisible();
 await expect(page.getByText('Обозначение: АБВГ.01.001')).toBeVisible();
 const [download]=await Promise.all([
   page.waitForEvent('download'),
   page.getByRole('button',{name:'↓ Предложения по свойствам CSV'}).click(),
 ]);
 const csv=await readFile((await download.path())!,'utf8');
 expect(csv).toContain('Опора.a3d');
 expect(csv).toContain('Только предварительное предложение');
 expect(transmitted).toEqual([]);
});
