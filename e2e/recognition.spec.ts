import {test,expect} from '@playwright/test';
import {entity,newProject} from '../src/model';
import {readFile} from 'node:fs/promises';
function addSyntheticSheet(){
 const p=newProject(),s=p.sheets[0];
 function l(x0:number,y0:number,x1:number,y1:number){
   return entity('line',[{x:x0,y:y0},{x:x1,y:y1}],'Автообводка','trace');
 }
 function t(txt:string,x0:number,x1:number){
   const e=entity('text',[{x:x0,y:94}],'OCR','ocr');
   e.text=txt;e.size=10;e.confidence=95;e.bbox={x0,y0:84,x1,y1:94};return e;
 }
 s.entities=[l(0,100,50,100),l(50,100,100,100),l(0,80,0,115),l(50,80,50,115),l(100,80,100,115),
   t('6000',20,30),t('6000',70,80)];
 return p;
}
test('recognition panel restores unverified dimension chain and exports native DIMENSION',async ({page})=>{
 await page.goto('/CadRecon/');
 await page.locator('input[type=file][accept=".json,.cadrecon.json"]').setInputFiles({name:'synthetic.cadrecon.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(addSyntheticSheet()))});
 await page.getByRole('button',{name:'▤ Восстановить размерные цепочки и ЕСКД'}).click();
 await expect(page.getByRole('heading',{name:'Проверка распознавания'})).toBeVisible();
 await expect(page.locator('.recognition-item')).toHaveCount(2);
 await expect(page.locator('.recognition-item').first()).toContainText('6000');
 page.once('dialog',d=>d.accept());
 const [dl]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'↓ DXF',exact:true}).click()]);
 const dxf=await readFile((await dl.path())!,'utf8');
 expect((dxf.match(/\n0\nDIMENSION\n/g)||[]).length).toBe(2);
});
test('manual ESKD placement exports an editable block INSERT',async ({page})=>{
 await page.goto('/CadRecon/');
 await page.getByRole('button',{name:'Обозначения ЕСКД'}).click();
 const cv=page.locator('canvas[aria-label="Редактор CAD"]');
 const bbox=await cv.boundingBox();expect(bbox).toBeTruthy();
 await cv.click({position:{x:bbox!.width*.43,y:bbox!.height*.46}});
 await expect(page.getByText('Добавлено объектов: 1')).toBeVisible();
 page.once('dialog',d=>d.accept());
 const [dl]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'↓ DXF',exact:true}).click()]);
 const text=await readFile((await dl.path())!,'utf8');
 expect(text).toContain('\n0\nINSERT\n');
 expect(text).toContain('ESKD_1');
});