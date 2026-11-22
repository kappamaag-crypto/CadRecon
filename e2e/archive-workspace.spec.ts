import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {entity,newProject} from '../src/model';
const openArchive=async(page:import('@playwright/test').Page)=>{
 await page.locator('.panel-tabs button[title="Поиск и аудит"]').click();
 await expect(page.getByRole('heading',{name:'Инженерные инструменты'})).toBeVisible();
};
const imported=async(page:import('@playwright/test').Page)=>{
 const p=newProject();p.name='ГАЛС испытание';
 const text=entity('text',[{x:50,y:60}],'Текст','pdf');text.text='Поз. 1';
 const note=entity('text',[{x:80,y:90}],'Текст','pdf');note.text='Технические требования:\nСварные швы зачистить';
 p.sheets[0].entities=[text,note];
 const circle=entity('circle',[{x:250,y:120}],'Контуры','trace');
 circle.center={x:250,y:120};circle.radius=8;
 p.sheets.push({...p.sheets[0],id:'sheet2',name:'Чертёж 2',
  entities:[entity('text',[{x:500,y:300}],'Текст','ocr'),circle]});
 p.sheets[1].entities[0].text='Крепление М16';
 await page.goto('/CadRecon/');
 await page.locator('input[type=file][accept=".json,.cadrecon.json"]').setInputFiles({
  name:'gals.cadrecon.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(p)),
 });
 await expect(page.getByText(/Проект открыт: ГАЛС испытание/)).toBeVisible();
 return p;
};

test('SearchTextApp browser search jumps to a matching OCR text across CAD sheets',async ({page})=>{
 const project=await imported(page);
 await openArchive(page);
 await page.getByLabel('Поиск по чертежам').fill('м16');
 await expect(page.locator('.archive-hit').filter({hasText:'Крепление М16'})).toHaveCount(1);
 await page.locator('.archive-hit').filter({hasText:'Крепление М16'})
   .getByRole('button',{name:/Показать/}).click();
 await expect(page.locator('.sheet-tabs button.active')).toHaveText('Чертёж 2');
 await page.locator('.archive-hit').filter({hasText:'Крепление М16'})
   .getByRole('button',{name:/Свойства/}).click();
 await expect(page.getByRole('heading',{name:'Свойства объекта'})).toBeVisible();
 await expect(page.locator('.panelcontent textarea')).toHaveValue('Крепление М16');
 expect(project.sheets[1].entities[0].verified).toBe(false);
});

test('ГАЛС inventory, BOM CSV import, stamp preview and ZIP export remain on browser',async ({page})=>{
 await imported(page);
 await openArchive(page);
 await page.getByRole('tab',{name:'Аудит объектов'}).click();
 await expect(page.getByText(/Объектов: 4/)).toBeVisible();
 const [csv]=await Promise.all([
  page.waitForEvent('download'),
  page.getByRole('button',{name:'↓ Инвентаризация CSV'}).click(),
 ]);
 const csvText=await readFile((await csv.path())!,'utf8');
 expect(csvText).toContain('Координаты');
 expect(csvText).toContain('circle');
 await page.getByRole('tab',{name:'Спецификация'}).click();
 await page.locator('.archive-tools input[type=file]').setInputFiles({
  name:'gals.csv',mimeType:'text/csv',
  buffer:Buffer.from('Позиция;Наименование;Количество\n1;Деталь;2\n2;Кронштейн;1\n'),
 });
 await expect(page.getByText(/Загружено позиций: 2/)).toBeVisible();
 await expect(page.getByText(/Позиция спецификации не найдена/)).toBeVisible();
 await page.getByRole('tab',{name:'Основная надпись'}).click();
 await page.getByLabel('Обозначение', {exact:true}).fill('АБВГ.100');
 await page.getByLabel('Разработал',{exact:true}).fill('Инженер');
 await expect(page.locator('.archive-preview').first()).toContainText('Разработал: Инженер');
 page.once('dialog',d=>d.accept());
 await page.getByRole('button',{name:/Применить после просмотра/}).click();
 const [json]=await Promise.all([
  page.waitForEvent('download'),page.getByRole('button',{name:'↓ JSON'}).click(),
 ]);
 const saved=JSON.parse(await readFile((await json.path())!,'utf8')) as ReturnType<typeof newProject>;
 expect(saved.specification).toHaveLength(2);
 expect(saved.sheets[0].entities.some(e=>e.kind==='stamp'&&e.text?.includes('АБВГ.100'))).toBe(true);
 expect(saved.sheets[0].entities.filter(e=>e.kind==='stamp').every(e=>!e.verified)).toBe(true);
 await page.getByRole('tab',{name:'Пакет'}).click();
 const [download]=await Promise.all([
   page.waitForEvent('download'),
   page.getByRole('button',{name:'↓ Скачать пакет проекта ZIP'}).click(),
 ]);
 const buffer=await readFile((await download.path())!);
 expect(buffer.subarray(0,2).toString()).toBe('PK');
 expect(buffer.toString('utf8')).toContain('DXF/');
 expect(buffer.toString('utf8')).toContain('README.txt');
 expect(buffer.toString('utf8')).toContain('Диагностика_топологии_W3.csv');
});
