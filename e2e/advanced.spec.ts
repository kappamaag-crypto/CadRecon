import {test,expect} from '@playwright/test';
test('GitHub Pages uses browser-only recognition by default and hides optional local Ultra',async ({page})=>{
  await page.goto('/CadRecon/');
  await expect(page.getByRole('button',{name:/Точное распознавание в браузере/})).toBeVisible();
  await expect(page.getByRole('button',{name:/Подготовить языковые модели OCR/})).toBeVisible();
  await expect(page.getByText('GitHub Pages — единственный хостинг.',{exact:false})).toBeVisible();
  await expect(page.getByLabel('Адрес Online Accurate')).toHaveCount(0);
  await expect(page.getByRole('button',{name:/Распознать через PaddleOCR/})).toHaveCount(0);
  const settings=page.locator('details.local-ultra');
  await expect(settings).not.toHaveAttribute('open',/.+/);
  await settings.locator('summary').click();
  await expect(page.getByLabel('Локальный адрес Ultra')).toBeVisible();
  await expect(page.getByLabel('Токен Ultra')).toBeVisible();
});
