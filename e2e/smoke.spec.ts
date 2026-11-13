import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
test('CAD editor opens, creates a line, exports editable DXF',async ({page})=>{
  await page.goto('/CadRecon/');
  await expect(page.getByText('CadRecon').first()).toBeVisible();
  await expect(page.getByRole('button',{name:'Отрезок'})).toBeVisible();
  await page.getByRole('button',{name:'Отрезок'}).click();
  const cv=page.locator('canvas[aria-label="Редактор CAD"]');
  const rect=await cv.boundingBox();expect(rect).toBeTruthy();
  await cv.click({position:{x:rect!.width*.25,y:rect!.height*.4}});
  await cv.click({position:{x:rect!.width*.65,y:rect!.height*.4}});
  await expect(page.getByText('Добавлено объектов: 1')).toBeVisible();
  page.once('dialog',d=>d.accept());
  const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'↓ DXF',exact:true}).click()]);
  const path=await download.path();expect(path).toBeTruthy();
  const dxf=await readFile(path!,'utf8');
  expect(dxf).toContain('\n0\nLINE\n');expect(dxf).toContain('\n0\nEOF\n');
});