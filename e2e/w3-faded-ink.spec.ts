import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

test.setTimeout(120000);
test('W3 adaptive recognition preserves pale-grey scan lines and dashed marks with no false verification',async ({page})=>{
  await page.goto('/CadRecon/');
  const b64=await page.evaluate(()=>{
    const canvas=document.createElement('canvas');canvas.width=730;canvas.height=300;
    const ctx=canvas.getContext('2d')!;
    ctx.fillStyle='rgb(250,250,250)';ctx.fillRect(0,0,730,300);
    ctx.fillStyle='rgb(185,185,185)';
    ctx.fillRect(30,55,640,4);
    for(let x=40;x<675;x+=42)ctx.fillRect(x,150,26,4);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.locator('input[type=file][accept*=".pdf"]').setInputFiles({
    name:'faded-pale-grey-technical-scan.png',mimeType:'image/png',
    buffer:Buffer.from(b64,'base64'),
  });
  await expect(page.getByText(/Импортировано листов: 1/)).toBeVisible();
  await page.getByRole('button',{name:/Детальная обводка/}).click();
  await expect(page.getByText(/Детальная обводка:/)).toBeVisible({timeout:90000});
  const [json]=await Promise.all([
    page.waitForEvent('download'),page.getByRole('button',{name:'↓ JSON'}).click(),
  ]);
  const project=JSON.parse(await readFile((await json.path())!,'utf8')) as {
    sheets:Array<{entities:Array<{kind:string;verified:boolean;
      points:Array<{x:number;y:number}>;
      lineStyle?:string;scanEvidence?:{inkSupport:number;blankRunRatio:number}}>}>;
  };
  const lines=project.sheets.at(-1)!.entities.filter(e=>e.kind==='line');
  const faintSolid=lines.filter(e=>!e.lineStyle&&
    e.points.some(p=>Math.abs(p.y-57)<6));
  const fadedDashes=lines.filter(e=>e.lineStyle==='dashed'&&
    e.points.some(p=>Math.abs(p.y-152)<7));
  console.log('W3_FADED_INK '+JSON.stringify({all:lines.length,solid:faintSolid.length,dashed:fadedDashes.length}));
  expect(faintSolid.length).toBeGreaterThan(0);
  expect(dashedDashes.length).toBeGreaterThan(0);
  expect(lines.every(e=>!e.verified)).toBe(true);
  expect(lines.some(e=>e.scanEvidence&&e.scanEvidence.inkSupport>.35)).toBe(true);
});
