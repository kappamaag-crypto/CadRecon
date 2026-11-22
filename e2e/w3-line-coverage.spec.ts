import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';

type P={x:number;y:number};
type Ent={kind:string;points:P[];center?:P;radius?:number;verified:boolean};
const truth:[P,P][]=[
  [{x:55,y:70},{x:830,y:70}],
  [{x:55,y:70},{x:55,y:510}],
  [{x:140,y:200},{x:760,y:480}],
];
const dist=(a:P,b:P)=>Math.hypot(a.x-b.x,a.y-b.y);
function segmentDistance(p:P,a:P,b:P){
  const dx=b.x-a.x,dy=b.y-a.y,den=dx*dx+dy*dy;
  const t=den?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/den)):0;
  return dist(p,{x:a.x+t*dx,y:a.y+t*dy});
}
function coverage(segments:Ent[],a:P,b:P,stepCount=150,tolerance=4){
  let matched=0;
  for(let i=0;i<=stepCount;i++){
    const t=i/stepCount,p={x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};
    if(segments.some(e=>e.points.length===2&&segmentDistance(p,e.points[0],e.points[1])<=tolerance))matched++;
  }
  return matched/(stepCount+1);
}
test.describe.configure({mode:'serial'});
test.setTimeout(120000);
test.beforeAll(()=>execFileSync('python3',['benchmarks/w0/generate_fixtures.py','--out','test-results/w3-goldens']));
for(const [kind,filename] of [
  ['clean','scan_clean_300dpi.png'],
  ['degraded','scan_degraded_300dpi.png'],
] as const){
  test('W3 '+kind+' synthetic line coverage diagnostic, without false accuracy claims',async ({page})=>{
    await page.goto('/CadRecon/');
    await page.locator('input[type=file][accept*=".pdf"]').setInputFiles({
      name:filename,mimeType:'image/png',
      buffer:await readFile(join('test-results/w3-goldens',filename)),
    });
    await expect(page.getByText(/Импортировано листов: 1/)).toBeVisible();
    await page.getByRole('button',{name:/Детальная обводка/}).click();
    await expect(page.getByText(/Детальная обводка: /)).toBeVisible({timeout:90000});
    const [dl]=await Promise.all([
      page.waitForEvent('download'),page.getByRole('button',{name:'↓ JSON'}).click(),
    ]);
    const path=await dl.path();expect(path).toBeTruthy();
    const project=JSON.parse(await readFile(path!,'utf8')) as {sheets:Array<{entities:Ent[]}>};
    const entities=project.sheets[0].entities;
    const lines=entities.filter(e=>e.kind==='line');
    const circles=entities.filter(e=>e.kind==='circle'&&e.center&&e.radius);
    const lineCoverage=truth.map(([a,b])=>Number(coverage(lines,a,b).toFixed(4)));
    const nearest=circles.map(e=>({
      centerErrorPx:dist(e.center!,{x:550,y:320}),
      radiusErrorPx:Math.abs(e.radius!-80),
    })).sort((a,b)=>a.centerErrorPx-b.centerErrorPx)[0]||null;
    const observed={
      fixture:kind,lines:lines.length,circles:circles.length,
      lineCoverageAt4px:lineCoverage,
      nearestCircle:nearest,
      autoApproved:entities.filter(e=>e.verified).length,
      limitation:'Synthetic line-sample coverage; NOT precision, recall, or engineering mm accuracy',
    };
    await mkdir('test-results',{recursive:true});
    await writeFile('test-results/w3-'+kind+'-quality.json',JSON.stringify(observed,null,2));
    console.log('W3_QUALITY '+JSON.stringify(observed));
    expect(observed.autoApproved).toBe(0);
    expect(lineCoverage).toHaveLength(3);
  });
}
