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
