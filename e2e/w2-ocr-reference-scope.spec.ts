import {test,expect} from '@playwright/test';
import {entity,newProject} from '../src/model';

test('reviewed OCR partial reference never claims false positives outside labelled boxes',async({page})=>{
  await page.goto('/CadRecon/');
  const image=await page.evaluate(()=>{
    const c=document.createElement('canvas');c.width=400;c.height=200;
    const ctx=c.getContext('2d')!;ctx.fillStyle='#fff';ctx.fillRect(0,0,400,200);
    return c.toDataURL('image/png');
  });
  const project=newProject(),sheet=project.sheets[0];
  sheet.width=400;sheet.height=200;sheet.image=image;sheet.sourceType='image';
  const label=entity('text',[{x:40,y:50}],'OCR','ocr');
  label.text='Ø25,4';label.confidence=.91;
  label.bbox={x0:20,y0:30,x1:100,y1:50};
  const other=entity('text',[{x:350,y:160}],'OCR','ocr');
  other.text='unlabelled title block';other.confidence=.9;
  other.bbox={x0:280,y0:140,x1:390,y1:160};
  sheet.entities=[label,other];
  await page.locator('input[type=file][accept=".json,.cadrecon.json"]').setInputFiles({
    name:'ocr-project.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(project)),
  });
  await page.locator('.panel-tabs button[title="Распознавание"]').click();
  await page.getByText('Измерить точность OCR по размеченному эталону JSON').click();
  const input=page.getByLabel('Загрузить OCR эталон JSON');
  const ref={version:1,reviewed:true,scope:'partial',imageWidth:400,imageHeight:200,
    labels:[{id:'diameter',text:'Ø25,4',x0:20,y0:30,x1:100,y1:50}]};
  await input.setInputFiles({name:'shaft-partial.json',mimeType:'application/json',
    buffer:Buffer.from(JSON.stringify(ref))});
  await expect(page.getByText(/OCR: частичная разметка/)).toBeVisible();
  await expect(page.getByText(/Precision и ложноположительные OCR не вычисляются/)).toBeVisible();
  await expect(page.getByText(/CER: 0.0%/)).toBeVisible();
  const complete={...ref,scope:'complete',region:{x0:10,y0:15,x1:180,y1:90}};
  await input.setInputFiles({name:'shaft-complete.json',mimeType:'application/json',
    buffer:Buffer.from(JSON.stringify(complete))});
  await expect(page.getByText(/OCR: полная разметка области/)).toBeVisible();
  await expect(page.getByText(/Precision: 100.0%/)).toBeVisible();
  await input.setInputFiles({name:'unreviewed.json',mimeType:'application/json',
    buffer:Buffer.from(JSON.stringify({...complete,reviewed:false}))});
  await expect(page.getByText(/OCR эталон: Error:.*reviewed=true/)).toBeVisible();
});