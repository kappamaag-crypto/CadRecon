import {test,expect} from '@playwright/test';
import {entity,newProject} from '../src/model';

test('browser review lists unverified scan geometry in bounded pages, not just OCR/ESKD',async ({page})=>{
  const p=newProject(),sheet=p.sheets[0];
  for(let i=0;i<121;i++){
    const e=entity('line',[{x:1,y:i*3},{x:100,y:i*3}],'Автообводка','trace');
    e.confidence=.4+.005*i;
    sheet.entities.push(e);
  }
  for(const t of ['R20','6000']){
    const e=entity('text',[{x:10,y:10}],'OCR','ocr');e.text=t;e.confidence=.9;
    sheet.entities.push(e);
  }
  await page.goto('/CadRecon/');
  await page.locator('input[type=file][accept=".json,.cadrecon.json"]').setInputFiles({
    name:'review-project.cadrecon.json',mimeType:'application/json',
    buffer:Buffer.from(JSON.stringify(p)),
  });
  await page.locator('.panel-tabs button[title="Распознавание"]').click();
  await expect(page.getByRole('heading',{name:'Проверка распознавания'})).toBeVisible();
  await page.getByRole('button',{name:/Геометрия · 121 непроверенных/}).click();
  await expect(page.locator('.recognition-item')).toHaveCount(60);
  await expect(page.getByText(/Страница 1 из 3/)).toBeVisible();
  await page.getByRole('button',{name:/Следующие 60/}).click();
  await expect(page.locator('.recognition-item')).toHaveCount(60);
  await page.getByRole('button',{name:/Следующие 60/}).click();
  await expect(page.locator('.recognition-item')).toHaveCount(1);
  await page.getByRole('button',{name:/OCR-надписи · 2 непроверенных/}).click();
  await expect(page.locator('.recognition-item')).toHaveCount(2);
  await page.locator('.recognition-item').first().click();
  await expect(page.getByRole('heading',{name:'Свойства объекта'})).toBeVisible();
  await expect(page.getByText(/Эвристический балл алгоритма/)).toBeVisible();
});

test('OCR region tool shows rectangle guidance and can be cancelled without fetching models',async ({page})=>{
  await page.goto('/CadRecon/');
  // A drawing image is needed before the action becomes enabled.
  const drawing=newProject();drawing.sheets[0].image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL9SAAAAABJRU5ErkJggg==';
  await page.locator('input[type=file][accept=".json,.cadrecon.json"]').setInputFiles({
    name:'ocr-region.cadrecon.json',mimeType:'application/json',
    buffer:Buffer.from(JSON.stringify(drawing)),
  });
  await page.locator('.panel-tabs button[title="Инструменты"]').click();
  await page.getByRole('button',{name:/OCR области — выбрать два угла рамки/}).click();
  const cv=page.locator('canvas[aria-label="Редактор CAD"]');
  await cv.click({position:{x:80,y:70}});
  await expect(page.getByText(/OCR: укажите второй угол прямоугольной области/)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByText(/OCR: укажите второй угол прямоугольной области/)).toHaveCount(0);
});
