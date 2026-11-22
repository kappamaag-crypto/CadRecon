import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {entity,newProject} from '../src/model';

test('Excel XLSX exported on GitHub Pages has valid Office XML, no formulas and all reports',async ({page})=>{
 const p=newProject();p.name='Контроль Excel';
 const text=entity('text',[{x:100,y:120}],'Текст','ocr');text.text='Поз. 1';
 const quote=entity('text',[{x:120,y:140}],'Текст','ocr');quote.text='=HYPERLINK("https://unsafe.example/")';
 const c=entity('circle',[{x:170,y:170}],'Автообводка','trace');c.center={x:170,y:170};c.radius=10;
 p.sheets[0].entities=[text,quote,c];
 p.sheets[0].calibrated=true;
 p.specification=[{position:'1',designation:'A.1',name:'Кронштейн',quantity:'2'},
 {position:'2',designation:'A.2',name:'Заглушка',quantity:'1'}];
 await page.goto('/CadRecon/');
 await page.locator('input[type=file][accept=".json,.cadrecon.json"]').setInputFiles({
  name:'excel.cadrecon.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(p)),
 });
 await expect(page.getByText(/Проект открыт: Контроль Excel/)).toBeVisible();
 await page.locator('.panel-tabs button[title="Поиск и аудит"]').click();
 await page.getByRole('tab',{name:'Пакет'}).click();
 const [download]=await Promise.all([
  page.waitForEvent('download'),page.getByRole('button',{name:'↓ Сводный отчёт Excel XLSX'}).click(),
 ]);
 expect(download.suggestedFilename()).toMatch(/\.xlsx$/);
 const path=await download.path();
 expect(path).toBeTruthy();
 const result=execFileSync('python3',['-c',[
  'import zipfile,sys,xml.etree.ElementTree as ET,json',
  'p=sys.argv[1]',
  'with zipfile.ZipFile(p) as z:',
  '  names=set(z.namelist())',
  '  expected={"[Content_Types].xml","_rels/.rels","xl/workbook.xml","xl/styles.xml","xl/worksheets/sheet1.xml","xl/worksheets/sheet2.xml","xl/worksheets/sheet3.xml","xl/worksheets/sheet4.xml","xl/worksheets/sheet5.xml","xl/worksheets/sheet6.xml"}',
  '  assert expected.issubset(names),sorted(expected-names)',
  '  for n in names:',
  '    if n.endswith(".xml") or n.endswith(".rels"):ET.fromstring(z.read(n))',
  '  workbook=z.read("xl/workbook.xml").decode()',
  '  assert "Сводка" in workbook and "Сверка позиций" in workbook',
  '  body=b"".join(z.read(n) for n in names if n.startswith("xl/worksheets/"))',
  '  assert b"<f>" not in body and b"<f " not in body',
  '  assert b"HYPERLINK" in body',
  '  assert b"inlineStr" in body',
  'print("xlsx-valid",len(names))',
 ].join('\n'),path!],{encoding:'utf8'});
 expect(result).toContain('xlsx-valid');
 expect((await readFile(path!)).subarray(0,2).toString()).toBe('PK');
});
