import {test,expect} from '@playwright/test';
import {newProject} from '../src/model';
test('optional PaddleOCR service is explicitly approved and imports editable unverified entities',async ({page})=>{
 const p=newProject(),s=p.sheets[0];
 s.width=300;s.height=200;s.sourceType='image';
 s.image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL9SAAAAABJRU5ErkJggg==';
 await page.route('http://127.0.0.1:8765/recognize',async route=>{
   await route.fulfill({status:200,contentType:'application/json',
     headers:{'Access-Control-Allow-Origin':'*'},
     body:JSON.stringify({engine:'fixture PaddleOCR',width:300,height:200,
       texts:[{text:'Áîëò M24x90',box:[10,10,130,22],confidence:.98}],
       lines:[{a:[0,40],b:[200,40],confidence:.8}],circles:[],polygons:[]})});
 });
 await page.goto('/CadRecon/');
 await page.locator('input[type=file][accept=".json,.cadrecon.json"]').setInputFiles({
   name:'backend-fixture.cadrecon.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(p))});
 page.once('dialog',d=>d.accept());
 await page.getByRole('button',{name:/Распознать через PaddleOCR/}).click();
 await expect(page.getByText(/fixture PaddleOCR: 2 новых элементов/)).toBeVisible();
 await page.getByRole('button',{name:'Свойства',exact:true}).click();
});