import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';

test('two-page TIFF import preserves BOTH pages locally and reports separate CAD sheets',async ({page})=>{
  // Pillow is already installed by the Python geometry test dependencies in CI.
  execFileSync('python3',['-c',[
    'from PIL import Image,ImageDraw',
    "a=Image.new('RGB',(128,96),'white')",
    "b=Image.new('RGB',(128,96),'white')",
    'ImageDraw.Draw(a).line([(10,10),(110,10)],fill="black",width=2)',
    'ImageDraw.Draw(b).ellipse((35,25,80,70),outline="black",width=2)',
    "a.save('/tmp/cadrecon-two-page.tiff',save_all=True,append_images=[b],compression='raw')",
  ].join('\n')],{stdio:'pipe'});
  await page.goto('/CadRecon/');
  await page.locator('input[type=file][accept*=".pdf"]').setInputFiles({
    name:'two-page.tiff',mimeType:'image/tiff',
    buffer:await readFile('/tmp/cadrecon-two-page.tiff'),
  });
  await expect(page.getByText(/Импортировано листов: 2/)).toBeVisible({timeout:30000});
  const [dl]=await Promise.all([
    page.waitForEvent('download'),page.getByRole('button',{name:'↓ JSON'}).click(),
  ]);
  const project=JSON.parse(await readFile((await dl.path())!,'utf8')) as {
    sheets:Array<{name:string;image:string;width:number;height:number}>;
  };
  expect(project.sheets).toHaveLength(2);
  expect(project.sheets.map(s=>s.name)).toEqual(['two-page.tiff — 1','two-page.tiff — 2']);
  expect(project.sheets.every(s=>s.width===128&&s.height===96&&s.image.startsWith('data:image/png;base64,'))).toBe(true);
});
