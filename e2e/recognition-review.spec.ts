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


test('OCR benchmark compares source-pixel annotated labels locally without network OCR',async ({page})=>{
  const p=newProject(),sheet=p.sheets[0];
  sheet.width=100;sheet.height=100;
  sheet.image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL9SAAAAABJRU5ErkJggg==';
  const t=entity('text',[{x:10,y:20}],'OCR','ocr');
  t.text='6000';t.bbox={x0:10,y0:10,x1:30,y1:20};t.confidence=.82;
  sheet.entities=[t];
  await page.goto('/CadRecon/');
  await page.locator('input[type=file][accept=".json,.cadrecon.json"]').setInputFiles({
    name:'benchmark-project.cadrecon.json',mimeType:'application/json',
    buffer:Buffer.from(JSON.stringify(p)),
  });
  await expect(page.getByText(/Проект открыт:/)).toBeVisible();
  await page.locator('.panel-tabs button[title="Распознавание"]').click();
  await page.getByText('Измерить точность OCR по размеченному эталону JSON').click();
  await page.getByLabel('Загрузить OCR эталон JSON').setInputFiles({
    name:'ocr-ground-truth.json',mimeType:'application/json',
    buffer:Buffer.from(JSON.stringify([{id:'label-1',text:'6000',
      x0:.1,y0:.1,x1:.3,y1:.2}])),
  });
  await expect(page.getByText(/Найдено 1 \/ 1 надписей/)).toBeVisible();
  await expect(page.getByText(/CER: 0.0%/)).toBeVisible();
  await expect(page.getByText(/точных критичных текстов: 1 \/ 1/)).toBeVisible();
});

test('OCR language and enhanced quality profiles can be changed in the browser without downloading models',async ({page})=>{
  await page.goto('/CadRecon/');
  await page.locator('.panel-tabs button[title="Инструменты"]').click();
  const language=page.getByLabel('Языки OCR');
  const quality=page.getByLabel('Качество онлайн-OCR');
  await expect(language).toHaveValue('rus+eng');
  await language.selectOption('eng');
  await expect(language).toHaveValue('eng');
  await quality.selectOption('standard');
  await expect(page.getByRole('checkbox',{name:/Искать вертикальные надписи/})).toBeDisabled();
  await quality.selectOption('enhanced');
  await expect(page.getByRole('checkbox',{name:/Искать вертикальные надписи/})).toBeEnabled();
});
