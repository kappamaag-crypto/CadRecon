import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

test.setTimeout(120000);
test('W3 dotted/dashed and long-dot center line survive scan trace as unverified native DXF styles',async ({page})=>{
  await page.goto('/CadRecon/');
  const b64=await page.evaluate(()=>{
    const c=document.createElement('canvas');c.width=700;c.height=280;
    const ctx=c.getContext('2d')!;ctx.fillStyle='white';ctx.fillRect(0,0,700,280);
    ctx.fillStyle='black';
    for(let x=30;x<=620;x+=40)ctx.fillRect(x,64,25,3);
    let x=30;
    for(const n of [44,5,44,5,44,5,44,5,44]){
      ctx.fillRect(x,174,n,3);x+=n+10;
    }
    return c.toDataURL('image/png').split(',')[1];
  });
  await page.locator('input[type=file][accept*=".pdf"]').setInputFiles({
    name:'synthetic_dash_center.png',mimeType:'image/png',buffer:Buffer.from(b64,'base64'),
  });
  await expect(page.getByText(/Импортировано листов: 1/)).toBeVisible();
  await page.getByRole('button',{name:/Детальная обводка/}).click();
  await expect(page.getByText(/Детальная обводка:/)).toBeVisible({timeout:90000});
  const [json]=await Promise.all([
    page.waitForEvent('download'),page.getByRole('button',{name:'↓ JSON'}).click(),
  ]);
  const project=JSON.parse(await readFile((await json.path())!,'utf8')) as {
    sheets:Array<{entities:Array<{kind:string;lineStyle?:string;verified:boolean}>}>;
  };
  const lines=project.sheets.at(-1)!.entities.filter(e=>e.kind==='line');
  const dash=lines.filter(e=>e.lineStyle==='dashed');
  const center=lines.filter(e=>e.lineStyle==='center');
  console.log('W3_DASH_STYLES '+JSON.stringify({candidates:lines.length,dashed:dash.length,center:center.length}));
  expect(dash.length).toBeGreaterThan(0);
  expect(center.length).toBeGreaterThan(0);
  expect([...dash,...center].every(e=>e.verified===false)).toBe(true);
  page.once('dialog',d=>d.accept());
  const [dxfFile]=await Promise.all([
    page.waitForEvent('download'),page.getByRole('button',{name:'↓ DXF',exact:true}).click(),
  ]);
  const data=await readFile((await dxfFile.path())!,'utf8');
  expect(data).toContain('\n6\nDASHED\n');
  expect(data).toContain('\n6\nCENTER\n');
});
