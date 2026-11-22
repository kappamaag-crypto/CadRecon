import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {newProject,entity,type Point} from '../src/model';

async function putProject(page:import('@playwright/test').Page,project:ReturnType<typeof newProject>){
  await page.goto('/CadRecon/');
  await page.locator('input[type=file][accept=".json,.cadrecon.json"]').setInputFiles({
    name:'w4.cadrecon.json',mimeType:'application/json',
    buffer:Buffer.from(JSON.stringify(project)),
  });
  await expect(page.getByText(/Проект открыт: /)).toBeVisible();
}
async function exportProject(page:import('@playwright/test').Page){
  const [dl]=await Promise.all([page.waitForEvent('download'),
    page.getByRole('button',{name:'↓ JSON'}).click()]);
  const filepath=await dl.path();
  expect(filepath).toBeTruthy();
  return JSON.parse(await readFile(filepath!,'utf8')) as ReturnType<typeof newProject>;
}
async function worldClick(page:import('@playwright/test').Page,p:Point,documentWidth=300,documentHeight=200){
  const canvas=page.getByRole('button',{name:'not-present'});void canvas;
  const cv=page.locator('canvas[aria-label="Редактор CAD"]');
  const bbox=await cv.boundingBox();
  expect(bbox).toBeTruthy();
  const ratio=bbox!.width/bbox!.height;
  const cameraW=Math.max(documentWidth*1.07,documentHeight*ratio*1.07);
  const cameraH=cameraW/ratio;
  const cameraX=(documentWidth-cameraW)/2,cameraY=(documentHeight-cameraH)/2;
  await cv.click({position:{
    x:(p.x-cameraX)/cameraW*bbox!.width,
    y:(p.y-cameraY)/cameraH*bbox!.height,
  }});
}
test('W4 point and rectangle create editable DXF and can be undone',async ({page})=>{
  const project=newProject();project.sheets[0].width=300;project.sheets[0].height=200;
  await putProject(page,project);
  await page.getByRole('button',{name:'Точка'}).click();
  await worldClick(page,{x:80,y:80});
  await page.getByRole('button',{name:'Прямоугольник'}).click();
  await worldClick(page,{x:110,y:80});
  await worldClick(page,{x:220,y:160});
  await expect(page.getByText('Добавлено объектов: 1')).toBeVisible();
  let data=await exportProject(page);
  const entities=data.sheets[0].entities;
  expect(entities.filter(e=>e.kind==='point')).toHaveLength(1);
  const rect=entities.find(e=>e.kind==='polyline');
  expect(rect?.closed).toBe(true);
  expect(rect?.points).toHaveLength(4);
  expect(entities.every(e=>!e.verified)).toBe(true);
  await page.getByRole('button',{name:/Отмена/}).click();
  data=await exportProject(page);
  expect(data.sheets[0].entities).toHaveLength(1);
});
test('W4 trim changes only clicked half and keeps boundary, uses one Undo',async ({page})=>{
  const project=newProject(),s=project.sheets[0];
  s.width=300;s.height=200;s.calibrated=true;
  s.entities=[
    entity('line',[{x:100,y:30},{x:100,y:170}]),
    entity('line',[{x:40,y:100},{x:200,y:100}]),
  ];
  await putProject(page,project);
  await page.getByRole('button',{name:'Подрезать линию по границе'}).click();
  await worldClick(page,{x:100,y:60});
  await worldClick(page,{x:60,y:100});
  await expect(page.getByText(/CAD: изменено 1 объектов/)).toBeVisible();
  const data=await exportProject(page);
  expect(data.sheets[0].entities).toHaveLength(2);
  const target=data.sheets[0].entities.find(e=>e.id===s.entities[1].id);
  expect(target?.points[0].x).toBeCloseTo(100,1);
  expect(target?.points[1].x).toBe(200);
  expect(target?.verified).toBe(false);
  await page.getByRole('button',{name:/Отмена/}).click();
  const back=await exportProject(page);
  expect(back.sheets[0].entities[1].points[0].x).toBe(40);
});


test('W4 OFFSET adds a separate parallel line and one Undo restores original',async ({page})=>{
  const project=newProject(),sheet=project.sheets[0];
  sheet.width=300;sheet.height=200;sheet.calibrated=true;
  const original=entity('line',[{x:40,y:100},{x:200,y:100}]);
  sheet.entities=[original];
  await putProject(page,project);
  await page.getByRole('button',{name:'Параллельный отрезок (OFFSET)'}).click();
  page.once('dialog',d=>d.accept('15'));
  await worldClick(page,{x:100,y:102});
  await expect(page.getByText(/CAD: изменено 0 объектов, добавлено 1/)).toBeVisible();
  const result=await exportProject(page);
  expect(result.sheets[0].entities).toHaveLength(2);
  const added=result.sheets[0].entities.find(e=>e.id!==original.id);
  expect(added?.kind).toBe('line');
  expect(added?.points[0].y).toBeCloseTo(115,1);
  expect(added?.points[1].y).toBeCloseTo(115,1);
  expect(added?.verified).toBe(false);
  expect(result.sheets[0].entities.find(e=>e.id===original.id)?.points).toEqual(original.points);
  await page.getByRole('button',{name:/Отмена/}).click();
  const undone=await exportProject(page);
  expect(undone.sheets[0].entities).toHaveLength(1);
  expect(undone.sheets[0].entities[0].id).toBe(original.id);
});


test('W4 BREAK cuts one manual line into two DXF-editable parts and one Undo restores source',async ({page})=>{
  const project=newProject(),sheet=project.sheets[0];
  sheet.width=300;sheet.height=200;sheet.calibrated=true;
  const source=entity('line',[{x:40,y:100},{x:200,y:100}]);
  sheet.entities=[source];
  await putProject(page,project);
  await page.getByRole('button',{name:'Разорвать прямой отрезок (BREAK)'}).click();
  await worldClick(page,{x:80,y:100});
  await expect(page.getByText(/BREAK: первая точка зафиксирована/)).toBeVisible();
  await worldClick(page,{x:150,y:100});
  await expect(page.getByText(/CAD: изменено 1 объектов, добавлено 1/)).toBeVisible();
  const result=await exportProject(page);
  expect(result.sheets[0].entities).toHaveLength(2);
  const first=result.sheets[0].entities.find(e=>e.id===source.id);
  const second=result.sheets[0].entities.find(e=>e.id!==source.id);
  expect(first!.points[0].x).toBe(40);
  expect(first!.points[1].x).toBeCloseTo(80,1);
  expect(second!.points[0].x).toBeCloseTo(150,1);
  expect(second!.points[1].x).toBe(200);
  expect(result.sheets[0].entities.every(e=>!e.verified)).toBe(true);
  await page.getByRole('button',{name:/Отмена/}).click();
  const back=await exportProject(page);
  expect(back.sheets[0].entities).toHaveLength(1);
  expect(back.sheets[0].entities[0].points).toEqual(source.points);
});


test('W4 JOIN connects exact shared endpoints to editable LINE, with one Undo and no new approval',async ({page})=>{
  const project=newProject(),sheet=project.sheets[0];
  sheet.width=300;sheet.height=200;sheet.calibrated=true;
  const a=entity('line',[{x:40,y:100},{x:130,y:100}]);
  const b=entity('line',[{x:130,y:100},{x:240,y:100}]);
  sheet.entities=[a,b];
  await putProject(page,project);
  await page.getByRole('button',{name:'Соединить линии и полилинии (JOIN)'}).click();
  await worldClick(page,{x:80,y:100});
  await expect(page.locator('.statusbar').getByText(/JOIN: выбран первый объект/)).toBeVisible();
  page.once('dialog',d=>d.accept());
  await worldClick(page,{x:200,y:100});
  await expect(page.getByText(/CAD: изменено 1 объектов, добавлено 0, удалено 1/)).toBeVisible();
  const saved=await exportProject(page);
  expect(saved.sheets[0].entities).toHaveLength(1);
  expect(saved.sheets[0].entities[0].points).toEqual([{x:40,y:100},{x:240,y:100}]);
  expect(saved.sheets[0].entities[0].origin).toBe('manual');
  expect(saved.sheets[0].entities[0].verified).toBe(false);
  await page.getByRole('button',{name:/Отмена/}).click();
  const undone=await exportProject(page);
  expect(undone.sheets[0].entities).toHaveLength(2);
  expect(undone.sheets[0].entities.map(e=>e.id)).toEqual([a.id,b.id]);
});


test('sheet tab has visible close control, confirmation, indexed backup and Undo restoration',async ({page})=>{
  const project=newProject(),first=project.sheets[0];
  first.name='Лист теста';first.entities=[entity('line',[{x:10,y:10},{x:60,y:10}])];
  project.sheets.push({...first,id:'second-sheet',name:'Второй лист',entities:[]});
  await putProject(page,project);
  await expect(page.getByRole('button',{name:'Закрыть лист Лист теста'})).toBeVisible();
  page.once('dialog',d=>d.dismiss());
  await page.getByRole('button',{name:'Закрыть лист Лист теста'}).click();
  expect((await exportProject(page)).sheets).toHaveLength(2);
  page.once('dialog',d=>d.accept());
  await page.getByRole('button',{name:'Закрыть лист Лист теста'}).click();
  await expect(page.getByText(/Лист «Лист теста» закрыт/)).toBeVisible();
  const remaining=await exportProject(page);
  expect(remaining.sheets).toHaveLength(1);
  expect(remaining.sheets[0].name).toBe('Второй лист');
  await page.getByRole('button',{name:/Отмена/}).click();
  const restored=await exportProject(page);
  expect(restored.sheets).toHaveLength(2);
  expect(restored.sheets[0].entities).toHaveLength(1);
});
test('closing the last drawing tab leaves a safe blank sheet instead of breaking editor',async ({page})=>{
  const project=newProject();project.sheets[0].name='Последний';
  project.sheets[0].entities.push(entity('line',[{x:1,y:1},{x:15,y:15}]));
  await putProject(page,project);
  page.once('dialog',d=>d.accept());
  await page.getByRole('button',{name:'Закрыть лист Последний'}).click();
  await expect(page.getByRole('button',{name:'Закрыть лист Лист 1'})).toBeVisible();
  const remaining=await exportProject(page);
  expect(remaining.sheets).toHaveLength(1);
  expect(remaining.sheets[0].entities).toHaveLength(0);
  await page.getByRole('button',{name:/Отмена/}).click();
  expect((await exportProject(page)).sheets[0].name).toBe('Последний');
});

test('W4 3-point dimension placement and auto dimension do not invent mm on uncalibrated sheet',async ({page})=>{
  const project=newProject(),sheet=project.sheets[0];
  sheet.width=300;sheet.height=200;sheet.calibrated=false;
  await putProject(page,project);
  await page.getByRole('button',{name:'Размер с размещением (3 точки)'}).click();
  await worldClick(page,{x:50,y:50});await worldClick(page,{x:150,y:50});
  await worldClick(page,{x:100,y:70});
  await expect(page.getByText('Добавлено объектов: 1')).toBeVisible();
  const data=await exportProject(page),d=data.sheets[0].entities[0];
  expect(d.kind).toBe('dimension');
  expect(d.offset).toBeCloseTo(20,1);
  expect(d.text).toBe('?');
  expect(d.verified).toBe(false);
  await page.getByRole('button',{name:/Отмена/}).click();
  expect((await exportProject(page)).sheets[0].entities).toHaveLength(0);
});
test('W4 selected auto-dimension inserts linked unverified dimension and can undo',async ({page})=>{
  const project=newProject(),sheet=project.sheets[0];
  sheet.width=300;sheet.height=200;sheet.calibrated=true;
  const source=entity('line',[{x:50,y:100},{x:150,y:100}]);
  sheet.entities=[source];await putProject(page,project);
  await page.getByRole('button',{name:'Выделение / перенос'}).click();
  await worldClick(page,{x:90,y:100});
  await page.locator('.panel-tabs button[title="Инструменты"]').click();
  page.once('dialog',d=>d.accept());
  await page.getByRole('button',{name:'◎ Авторазмер выбранного объекта'}).click();
  const data=await exportProject(page);
  expect(data.sheets[0].entities).toHaveLength(2);
  const dim=data.sheets[0].entities.find(e=>e.kind==='dimension')!;
  expect(dim.text).toBe('100');
  expect(dim.sourceId).toBe(source.id);
  expect(dim.verified).toBe(false);
  await page.getByRole('button',{name:/Отмена/}).click();
  expect((await exportProject(page)).sheets[0].entities).toHaveLength(1);
});
