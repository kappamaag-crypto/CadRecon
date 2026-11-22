import {test,expect} from '@playwright/test';
import {newProject,entity} from '../src/model';

test('PDF/scan recognition is first, CAD is secondary and export requires a source',async ({page})=>{
  await page.goto('/CadRecon/');
  await expect(page.locator('.panel-tabs button[title="PDF → DXF"]')).toHaveClass(/active/);
  await expect(page.getByText('PDF / скан → редактируемый 2D DXF')).toBeVisible();
  await expect(page.getByRole('button',{name:/Точное распознавание в браузере/})).toBeDisabled();
  await expect(page.getByText(/Лист не загружен/)).toBeVisible();
  await page.locator('.panel-tabs button[title="Инструменты"]').click();
  await expect(page.getByLabel('Поиск CAD-команды')).toBeVisible();
  await page.locator('.panel-tabs button[title="PDF → DXF"]').click();
  await expect(page.getByText('PDF / скан → редактируемый 2D DXF')).toBeVisible();
});

test('recognition summary flags a mixed PDF, intentional dashed line and unknown mm',async ({page})=>{
  const project=newProject(),sheet=project.sheets[0];
  sheet.image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL9SAAAAABJRU5ErkJggg==';
  sheet.sourceType='pdf';sheet.width=500;sheet.height=350;
  sheet.importWarnings=['В PDF обнаружено 2 растровых графических элементов'];
  const native=entity('line',[{x:20,y:30},{x:300,y:30}],'PDF векторы','pdf');
  const line=entity('line',[{x:20,y:45},{x:300,y:45}],'Автообводка','trace');
  line.lineStyle='dashed';
  line.scanEvidence={inkSupport:.48,blankRunRatio:.24,patternMarks:8};
  const weak=entity('line',[{x:20,y:60},{x:300,y:60}],'Автообводка','trace');
  weak.scanEvidence={inkSupport:.11,blankRunRatio:.35};
  sheet.entities=[native,line,weak];
  await page.goto('/CadRecon/');
  await page.locator('input[type=file][accept=".json,.cadrecon.json"]').setInputFiles({
    name:'mixed.cadrecon.json',mimeType:'application/json',
    buffer:Buffer.from(JSON.stringify(project)),
  });
  await expect(page.getByText(/Проект открыт/)).toBeVisible();
  await expect(page.getByText(/Смешанный PDF: растр/)).toBeVisible();
  await expect(page.getByText(/Сомнительных по чернилам: 1/)).toBeVisible();
  await expect(page.getByText(/сплошных линий с пробелами: 1/)).toBeVisible();
  await expect(page.getByText(/Масштаб не подтверждён/)).toBeVisible();
  await page.getByLabel('Режим реконструкции').selectOption('hybrid');
  await expect(page.getByLabel('Режим реконструкции')).toHaveValue('hybrid');
  await page.getByRole('button',{name:'✓ Проверить сомнительные объекты'}).click();
  await expect(page.getByRole('heading',{name:'Проверка распознавания'})).toBeVisible();
});


test('W3 opt-in noise cleanup never removes styled/native/manual lines and Undo restores candidates',async ({page})=>{
  const {readFile}=await import('node:fs/promises');
  const p=newProject(),s=p.sheets[0];s.sourceType='image';
  s.image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL9SAAAAABJRU5ErkJggg==';
  const bad=entity('line',[{x:0,y:0},{x:100,y:0}],'Автообводка','trace');
  bad.confidence=.11;bad.scanEvidence={inkSupport:.07,blankRunRatio:.7};
  const good=entity('line',[{x:0,y:10},{x:100,y:10}],'Автообводка','trace');
  good.confidence=.5;good.scanEvidence={inkSupport:.9,blankRunRatio:0};
  const dash=entity('line',[{x:0,y:20},{x:100,y:20}],'Автообводка','trace');
  dash.confidence=.11;dash.lineStyle='dashed';
  dash.scanEvidence={inkSupport:.07,blankRunRatio:.7};
  s.entities=[bad,good,dash];
  await page.goto('/CadRecon/');
  await page.locator('input[type=file][accept=".json,.cadrecon.json"]').setInputFiles({
    name:'noisy.cadrecon.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(p)),
  });
  await expect(page.getByText(/Проект открыт/)).toBeVisible();
  page.once('dialog',d=>d.accept());
  await page.getByRole('button',{name:/Найти и удалить явно слабые линии/}).click();
  await expect(page.getByText(/Удалено явно слабых автоотрезков: 1/)).toBeVisible();
  const save=async()=>{
    const [dl]=await Promise.all([page.waitForEvent('download'),
      page.getByRole('button',{name:'↓ JSON'}).click()]);
    return JSON.parse(await readFile((await dl.path())!,'utf8')) as typeof p;
  };
  const after=await save();
  expect(after.sheets[0].entities.map(e=>e.id)).toEqual([good.id,dash.id]);
  await page.getByRole('button',{name:/Отмена/}).click();
  const restored=await save();
  expect(restored.sheets[0].entities).toHaveLength(3);
});
