import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {createReportXlsx} from '../src/xlsxExport';
import {newProject,entity} from '../src/model';

test('reads compressed user XLSM specification locally without executing macro data',async ({page})=>{
  const xlsx=createReportXlsx([
    {name:'ИНФО',headers:['Приложение','Версия'],rows:[['ГАЛС','1-23']]},
    {name:'ОТЧЕТ по СПЕЦИФИКАЦИИ СБЧ',
      headers:['Индекс','Номер','Позиция','Обозначение','Наименование','Количество','Материал','Масса (кг)'],
      rows:[[1,2,'1','АБВГ.001','Опора',3,'Сталь',0.45],
        [2,3,'2','АБВГ.002','Кронштейн',1,'Сталь',0.2]]},
  ]);
  const compressed=execFileSync('python3',['-c',[
    'import sys,zipfile,io',
    'data=sys.stdin.buffer.read()',
    'buf=io.BytesIO()',
    'with zipfile.ZipFile(io.BytesIO(data)) as z,zipfile.ZipFile(buf,"w",compression=zipfile.ZIP_DEFLATED) as out:',
    ' for name in z.namelist():out.writestr(name,z.read(name))',
    ' out.writestr("xl/vbaProject.bin",b"macro-not-executed")',
    'sys.stdout.buffer.write(buf.getvalue())',
  ].join('\n')],{input:Buffer.from(xlsx),maxBuffer:10*1024*1024});
  const p=newProject();
  const e=entity('leader',[{x:20,y:40},{x:60,y:40}]);e.text='Поз. 1';
  p.sheets[0].entities=[e];
  await page.goto('/CadRecon/');
  await page.locator('input[type=file][accept=".json,.cadrecon.json"]').setInputFiles({
    name:'input.cadrecon.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(p)),
  });
  await expect(page.getByText(/Проект открыт:/)).toBeVisible();
  await page.locator('.panel-tabs button[title="Поиск и аудит"]').click();
  await page.getByRole('tab',{name:'Спецификация'}).click();
  await page.locator('.archive-tools input[type=file]').setInputFiles({
    name:'GALS_report.xlsm',mimeType:'application/vnd.ms-excel.sheet.macroEnabled.12',buffer:compressed,
  });
  await expect(page.getByText(/Загружено позиций: 2/)).toBeVisible({timeout:30000});
  await expect(page.getByText(/Позиция спецификации не найдена/)).toBeVisible();
  await expect(page.getByText(/макросы и формулы НЕ запускаются/)).toBeVisible();
});


test('rejects hostile DTD in imported workbook before interpreting cell content',async ({page})=>{
 const xlsx=createReportXlsx([
  {name:'Спецификация',headers:['Позиция','Наименование'],rows:[['1','Деталь']]},
 ]);
 const modified=execFileSync('python3',['-c',[
   'import io,sys,zipfile',
   'src=io.BytesIO(sys.stdin.buffer.read());out=io.BytesIO()',
   'with zipfile.ZipFile(src) as zin,zipfile.ZipFile(out,"w",compression=zipfile.ZIP_DEFLATED) as zout:',
   ' for name in zin.namelist():',
   '  data=zin.read(name)',
   '  if name=="xl/worksheets/sheet1.xml":data=data.replace(b"<worksheet",b"<!DOCTYPE worksheet [<!ENTITY xxe SYSTEM \\"file:///etc/passwd\\">]><worksheet",1)',
   '  zout.writestr(name,data)',
   'sys.stdout.buffer.write(out.getvalue())',
 ].join('\n')],{input:Buffer.from(xlsx),maxBuffer:10*1024*1024});
 await page.goto('/CadRecon/');
 await page.locator('.panel-tabs button[title="Поиск и аудит"]').click();
 await page.getByRole('tab',{name:'Спецификация'}).click();
 await page.locator('.archive-tools input[type=file]').setInputFiles({
  name:'hostile.xlsm',mimeType:'application/vnd.ms-excel.sheet.macroEnabled.12',buffer:modified,
 });
 await expect(page.getByText(/запрещены DTD/)).toBeVisible();
 await expect(page.getByText(/Загружено позиций: 0/)).toBeVisible();
});
