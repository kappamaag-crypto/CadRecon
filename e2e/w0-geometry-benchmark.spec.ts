import {test,expect} from '@playwright/test';
import {entity,newProject} from '../src/model';

// No real uploaded drawings or user annotations are checked into GitHub.
test('browser private geometry reference is local and partial labels do not yield false positive claims',async({page})=>{
  await page.goto('/CadRecon/');
  const image=await page.evaluate(()=>{
    const c=document.createElement('canvas');c.width=200;c.height=120;
    const ctx=c.getContext('2d')!;ctx.fillStyle='#fff';ctx.fillRect(0,0,200,120);
    return c.toDataURL('image/png');
  });
  const project=newProject(),sheet=project.sheets[0];
  sheet.width=200;sheet.height=120;sheet.image=image;sheet.sourceType='image';
  sheet.entities=[
    entity('line',[{x:20,y:30},{x:100,y:30}],'Автообводка','trace'),
    entity('line',[{x:100,y:30},{x:180,y:30}],'Автообводка','trace'),
    entity('line',[{x:20,y:90},{x:180,y:90}],'Автообводка','trace'),
  ];
  await page.locator('input[type=file][accept=".json,.cadrecon.json"]').setInputFiles({
    name:'local-project.cadrecon.json',mimeType:'application/json',
    buffer:Buffer.from(JSON.stringify(project)),
  });
  await page.locator('.panel-tabs button[title="Распознавание"]').click();
  await page.getByText('Сравнить LINE / CIRCLE с проверенной разметкой (локальный эталон)').click();
  const input=page.getByLabel('Загрузить эталон геометрии JSON');
  const reference={version:1,reviewed:true,scope:'partial',
    imageWidth:200,imageHeight:120,
    lines:[{id:'shaft',a:{x:20,y:30},b:{x:180,y:30}}],circles:[]};
  await input.setInputFiles({name:'private-reference.json',mimeType:'application/json',
    buffer:Buffer.from(JSON.stringify(reference))});
  await expect(page.getByText(/Покрытие длины контрольных LINE: 100.0%/)).toBeVisible();
  await expect(page.getByText(/ложноположительные элементы не вычисляются/)).toBeVisible();
  await input.setInputFiles({name:'draft-reference.json',mimeType:'application/json',
    buffer:Buffer.from(JSON.stringify({...reference,reviewed:false}))});
  await expect(page.getByText(/Эталон геометрии: Error:.*reviewed=true/)).toBeVisible();
  const complete={...reference,scope:'complete',region:{x0:10,y0:10,x1:190,y1:110}};
  await input.setInputFiles({name:'complete-reference.json',mimeType:'application/json',
    buffer:Buffer.from(JSON.stringify(complete))});
  await expect(page.getByText(/Отрезков вне полного эталона: 1/)).toBeVisible();
  await expect(page.getByText(/Согласованность кандидатов: 66.7%/)).toBeVisible();
});

test('browser treats saturated blue as possible native KOMPAS drawing style',async({page})=>{
  await page.goto('/CadRecon/');
  const image=await page.evaluate(()=>{
    const c=document.createElement('canvas');c.width=200;c.height=120;
    const ctx=c.getContext('2d')!;ctx.fillStyle='white';ctx.fillRect(0,0,200,120);
    ctx.fillStyle='rgb(105,105,221)';ctx.fillRect(10,10,181,5);
    ctx.fillStyle='rgb(45,45,45)';ctx.fillRect(10,30,181,8);
    return c.toDataURL('image/png');
  });
  const project=newProject();project.sheets[0].image=image;
  project.sheets[0].sourceType='image';
  project.sheets[0].width=200;project.sheets[0].height=120;
  const e=entity('line',[{x:20,y:30},{x:180,y:30}],'Автообводка','trace');
  project.sheets[0].entities=[e];
  await page.locator('input[type=file][accept=".json,.cadrecon.json"]').setInputFiles({
    name:'annotated-project.cadrecon.json',mimeType:'application/json',
    buffer:Buffer.from(JSON.stringify(project)),
  });
  await page.locator('.panel-tabs button[title="Распознавание"]').click();
  await page.getByText('Сравнить LINE / CIRCLE с проверенной разметкой (локальный эталон)').click();
  await page.getByLabel('Загрузить эталон геометрии JSON').setInputFiles({
    name:'annotation.json',mimeType:'application/json',
    buffer:Buffer.from(JSON.stringify({version:1,reviewed:true,
      imageWidth:200,imageHeight:120,scope:'partial',
      lines:[{id:'line-a',a:{x:20,y:30},b:{x:180,y:30}}],circles:[]})),
  });
  await expect(page.getByLabel('Информация о цветных линиях КОМПАС-3D')).toBeVisible();
  await expect(page.getByText(/не доказывает наложение эталонной обводки/)).toBeVisible();
  await expect(page.getByText(/Покрытие длины контрольных LINE: 100.0%/)).toBeVisible();
});
