import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {readFile,mkdir,writeFile} from 'node:fs/promises';

type P={x:number;y:number};
const truth:[P,P][]=[
  [{x:110,y:140},{x:1660,y:140}],
  [{x:110,y:140},{x:110,y:1020}],
  [{x:280,y:400},{x:1520,y:960}],
];
function distSegment(p:P,a:P,b:P){
  const dx=b.x-a.x,dy=b.y-a.y,den=dx*dx+dy*dy;
  const t=den?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/den)):0;
  return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);
}
test.setTimeout(120000);
test('W3 2x synthetic raster resolution: local tiled trace retains all axis directions',async ({page})=>{
  await mkdir('test-results/w3-2x',{recursive:true});
  execFileSync('python3',['benchmarks/w0/generate_fixtures.py','--out','test-results/w3-2x']);
  execFileSync('python3',['-c',[
    'from PIL import Image',
    'im=Image.open("test-results/w3-2x/scan_clean_300dpi.png")',
    'im.resize((1800,1200),resample=Image.Resampling.NEAREST).save("test-results/w3-2x/scan_simulated_2x.png")',
  ].join('\n')]);
  await page.goto('/CadRecon/');
  await page.locator('input[type=file][accept*=".pdf"]').setInputFiles({
    name:'scan_simulated_2x.png',mimeType:'image/png',
    buffer:await readFile('test-results/w3-2x/scan_simulated_2x.png'),
  });
  await expect(page.getByText(/Импортировано листов: 1/)).toBeVisible({timeout:20000});
  await page.getByRole('button',{name:/Детальная обводка/}).click();
  await expect(page.getByText(/Детальная обводка: /)).toBeVisible({timeout:90000});
  const [dl]=await Promise.all([page.waitForEvent('download'),
    page.getByRole('button',{name:'↓ JSON'}).click()]);
  const p=JSON.parse(await readFile((await dl.path())!,'utf8')) as {
    sheets:Array<{entities:Array<{kind:string;points:P[];verified:boolean;center?:P;radius?:number}>}>;
  };
  const lines=p.sheets[0].entities.filter(e=>e.kind==='line'&&e.points.length===2);
  const coverage=truth.map(([a,b])=>{
    let matched=0;
    for(let i=0;i<=150;i++){
      const t=i/150,point={x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};
      if(lines.some(e=>distSegment(point,e.points[0],e.points[1])<=8))matched++;
    }
    return Number((matched/151).toFixed(4));
  });
  const diagnostic={fixture:'2x-nearest-neighbor, NOT real 600dpi scanner',
    lineCoverageAt8px:coverage,traceCandidates:lines.length,
    autoApproved:p.sheets[0].entities.filter(e=>e.verified).length};
  await writeFile('test-results/w3-2x-quality.json',JSON.stringify(diagnostic,null,2));
  console.log('W3_RESOLUTION '+JSON.stringify(diagnostic));
  expect(diagnostic.autoApproved).toBe(0);
  expect(coverage).toHaveLength(3);
  // Strict loss regression on deterministic 2x-upsampled synthetic strokes.
  // Does not measure any real scanner's DPI, geometric precision or F1.
  for(const c of coverage)expect(c).toBeGreaterThanOrEqual(.97);
  // Regression budget from the same deterministic upsampled fixture: 824
  // candidates after W3 centering. This is NOT a real-scan precision gate.
  expect(lines.length).toBeLessThan(720);
});