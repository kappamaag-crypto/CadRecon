import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';

// W0 diagnostic baseline: never assert that a scan or native PDF is 100% reconstructed.
// Synthetic fixtures have exact source truth; their results are NOT claims about real CAD.
const OUT='test-results/w0-goldens';
type Pt={x:number;y:number};
type Entity={kind:string;origin?:string;text?:string;points:Pt[];center?:Pt;radius?:number};
type Sheet={width:number;height:number;entities:Entity[]};
type CadFile={sheets:Sheet[]};

test.describe.configure({mode:'serial'});
test.beforeAll(()=>{
  execFileSync('python3',['benchmarks/w0/generate_fixtures.py','--out',OUT],{stdio:'pipe'});
});
test.setTimeout(120_000);

async function importAndRead(page:import('@playwright/test').Page,filename:string) {
  await page.goto('/CadRecon/');
  await page.locator('input[type=file][accept*=".pdf"]').setInputFiles({
    name:filename,mimeType:filename.endsWith('.pdf')?'application/pdf':'image/png',
    buffer:await readFile(join(OUT,filename)),
  });
  await expect(page.getByText(/Импортировано листов: 1/)).toBeVisible({timeout:60_000});
  return exportJson(page);
}
async function exportJson(page:import('@playwright/test').Page):Promise<CadFile>{
  const [download]=await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button',{name:'↓ JSON'}).click(),
  ]);
  const path=await download.path();expect(path).toBeTruthy();
  return JSON.parse(await readFile(path!,'utf8')) as CadFile;
}
async function saveBaseline(name:string,payload:Record<string,unknown>) {
  await mkdir('test-results',{recursive:true});
  await writeFile(join('test-results',name+'.json'),JSON.stringify(payload,null,2)+'\n','utf8');
  console.log('W0_DIAGNOSTIC '+JSON.stringify({name,...payload}));
}
function countKind(entities:Entity[],kind:string) {
  return entities.filter(e=>e.kind===kind).length;
}
function pointDistance(a:Pt,b:Pt) {return Math.hypot(a.x-b.x,a.y-b.y);}
function lineError(actual:Entity,expected:[Pt,Pt]) {
  if(actual.points.length!==2)return Infinity;
  const [a,b]=actual.points,[x,y]=expected;
  return Math.min(Math.max(pointDistance(a,x),pointDistance(b,y)),
                  Math.max(pointDistance(a,y),pointDistance(b,x)));
}
function matchingLineError(entities:Entity[],expected:[Pt,Pt]) {
  return Math.min(Infinity,...entities.filter(e=>e.kind==='line').map(e=>lineError(e,expected)));
}
test('W0 baseline: native PDF circles, rectangles and editable text',async ({page})=>{
  const project=await importAndRead(page,'native_curves.pdf');
  const sheet=project.sheets[0];
  expect(sheet).toBeTruthy();
  const texts=sheet.entities.filter(e=>e.kind==='text').map(e=>e.text);
  const metrics={
    fixture:'native_curves',sourceType:'vector_pdf',
    sourceTruth:{standaloneLines:2,rectangles:1,circles:1,textExact:['6000','R20']},
    observed:{editableEntities:sheet.entities.length,lineSegments:countKind(sheet.entities,'line'),
      circles:countKind(sheet.entities,'circle'),arcs:countKind(sheet.entities,'arc'),
      rectanglePrimitives:countKind(sheet.entities,'rectangle'),polylines:countKind(sheet.entities,'polyline'),
      textExactMatches:['6000','R20'].filter(t=>texts.includes(t)).length},
    unit:'source PDF pt mapped to viewport px; page has not been calibrated to model mm',
    assessment:'diagnostic entity counts only — NOT precision, recall or dimensional accuracy',
  };
  await saveBaseline('w0-vector-baseline',metrics);
  expect(sheet.entities.length).toBeGreaterThan(0);
});
test('W0 baseline: PDF q/cm/Q affine transforms preserve endpoint positions',async ({page})=>{
  const project=await importAndRead(page,'native_ctm.pdf');
  const sheet=project.sheets[0];
  const scale=sheet.width/500;
  const viewport=(pt:Pt):Pt=>({x:pt.x*scale,y:(350-pt.y)*scale});
  const expected:[[Pt,Pt],[Pt,Pt]]=[
    [viewport({x:50,y:80}),viewport({x:130,y:80})],
    [viewport({x:180,y:40}),viewport({x:180,y:120})],
  ];
  const errors=expected.map(v=>matchingLineError(sheet.entities,v)/scale);
  await saveBaseline('w0-ctm-baseline',{
    fixture:'native_ctm',sourceType:'vector_pdf',
    lineCount:countKind(sheet.entities,'line'),
    expectedEndpointsPt:[[[50,80],[130,80]],[[180,40],[180,120]]],
    endpointWorstErrorsPt:errors.map(e=>Number.isFinite(e)?Number(e.toFixed(6)):null),
    missedLines:errors.filter(e=>!Number.isFinite(e)).length,
    unit:'PDF pt, not model mm',
    assessment:'null means no matching line candidate, NOT zero error; missing candidates are W1 regression blockers',
  });
  // Diagnostic mode: failure to recover a geometric path is a MEASURED product defect,
  // not a test-runner failure. Strict accuracy gates belong to W1 acceptance tests.
  expect(sheet).toBeTruthy();
});
test('W0 baseline: clean raster line/circle proposals remain unverified',async ({page})=>{
  await importAndRead(page,'scan_clean_300dpi.png');
  await page.getByRole('button',{name:/Детальная обводка/}).click();
  await expect(page.getByText(/Детальная обводка: /)).toBeVisible({timeout:90_000});
  const project=await exportJson(page);
  const entities=project.sheets[0].entities;
  const circles=entities.filter(e=>e.kind==='circle'&&e.center&&e.radius);
  const truth={x:550,y:320,r:80};
  const nearest=circles.map(e=>({
    centerErrorPx:pointDistance(e.center!,{x:truth.x,y:truth.y}),
    radiusErrorPx:Math.abs(e.radius!-truth.r),
  })).sort((a,b)=>a.centerErrorPx-b.centerErrorPx)[0];
  await saveBaseline('w0-scan-baseline',{
    fixture:'scan_clean',sourceType:'raster_png',sourceTruth:{lines:3,circles:1},
    observed:{lineFragments:countKind(entities,'line'),circleCandidates:circles.length,
      nearestCircle:nearest||null,automaticallyVerified:entities.filter(e=>e.verified).length},
    unit:'pixels, no independent model calibration',
    assessment:'candidate counts and nearest-circle errors, NOT recall/F1; full matching still required',
  });
  expect(entities.every(e=>!e.verified)).toBeTruthy();
});
