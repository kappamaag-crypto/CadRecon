import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

type P={x:number;y:number};
type Line={kind:string;points:P[];origin:string;verified:boolean};
const near=(p:P,a:P,b:P)=>{
  const dx=b.x-a.x,dy=b.y-a.y,den=dx*dx+dy*dy;
  const t=den?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/den)):0;
  return Math.hypot(p.x-a.x-dx*t,p.y-a.y-dy*t);
};
function covered(lines:Line[],a:P,b:P){
  let hits=0;
  for(let i=0;i<=100;i++){
    const t=i/100,at={x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};
    if(lines.some(l=>l.kind==='line'&&l.points.length===2&&
      near(at,l.points[0],l.points[1])<=4))hits++;
  }
  return hits/101;
}
test('W3 retains native cyan/green/blue 1px lines in KOMPAS-style PNG and rerun is idempotent',
 async({page})=>{
  test.setTimeout(140000);
  await page.goto('/CadRecon/');
  const base64=await page.evaluate(()=>{
    const c=document.createElement('canvas');c.width=500;c.height=260;
    const ctx=c.getContext('2d')!;
    ctx.fillStyle='#fff';ctx.fillRect(0,0,500,260);
    // Actual CAD line styles, NOT benchmark annotations or extra overlays.
    ctx.fillStyle='rgb(0,220,220)';ctx.fillRect(30,49,330,1);
    ctx.fillStyle='rgb(0,240,0)';ctx.fillRect(410,25,1,210);
    ctx.fillStyle='rgb(35,75,240)';ctx.fillRect(40,190,300,1);
    return c.toDataURL('image/png').split(',')[1];
  });
  await page.locator('input[type=file][accept*=".pdf"]').setInputFiles({
    name:'kompas-native-colours.png',mimeType:'image/png',
    buffer:Buffer.from(base64,'base64'),
  });
  await expect(page.getByText(/Импортировано листов: 1/)).toBeVisible();
  const measure=async()=>{
    const [download]=await Promise.all([
      page.waitForEvent('download'),page.getByRole('button',{name:'↓ JSON'}).click(),
    ]);
    const path=await download.path();
    expect(path).toBeTruthy();
    const project=JSON.parse(await readFile(path!,'utf8')) as {sheets:Array<{entities:Line[]}>};
    const lines=project.sheets[0].entities.filter(x=>x.kind==='line'&&x.origin==='trace');
    return {count:lines.length,cyan:covered(lines,{x:30,y:49},{x:359,y:49}),
      green:covered(lines,{x:410,y:25},{x:410,y:234}),
      blue:covered(lines,{x:40,y:190},{x:339,y:190}),
      allUnverified:lines.every(x=>!x.verified)};
  };
  await page.getByRole('button',{name:/Детальная обводка/}).click();
  await expect(page.getByText(/Детальная обводка:/)).toBeVisible({timeout:90000});
  const first=await measure();
  console.log('KOMPAS_NATIVE_LINES',first);
  expect(first.cyan).toBeGreaterThanOrEqual(.75);
  expect(first.green).toBeGreaterThanOrEqual(.75);
  expect(first.blue).toBeGreaterThanOrEqual(.75);
  expect(first.allUnverified).toBe(true);
  await page.getByRole('button',{name:/Детальная обводка/}).click();
  await expect(page.getByText(/Детальная обводка:/)).toBeVisible({timeout:90000});
  const second=await measure();
  expect(second.count).toBe(first.count);
  expect(second.cyan).toBeGreaterThanOrEqual(first.cyan-.01);
  expect(second.green).toBeGreaterThanOrEqual(first.green-.01);
  expect(second.blue).toBeGreaterThanOrEqual(first.blue-.01);
 });
