import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {isRedundantCircleStroke} from '../src/circleStrokeFilter';

type P={x:number;y:number};
type Ent={kind:string;points:P[];center?:P;radius?:number;verified:boolean;reason?:string;confidence?:number};
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
    // False-positive proxy can only be calculated for the synthetic fixture:
    // candidates are not labelled as valid LINE by merely following a circle
    // already exported as editable CIRCLE.
    const circle={x:550,y:320,radius:80,confidence:.9};
    let outsideKnownStraight=0,explainedStraight=0,nearKnownCircle=0;
    for(const e of lines){
      if(e.points.length!==2)continue;
      let matched=0,circular=0;
      for(let i=0;i<=12;i++){
        const t=i/12;
        const p={x:e.points[0].x*(1-t)+e.points[1].x*t,
          y:e.points[0].y*(1-t)+e.points[1].y*t};
        if(truth.some(([a,b])=>segmentDistance(p,a,b)<=4))matched++;
        if(Math.abs(dist(p,{x:circle.x,y:circle.y})-circle.radius)<=4)circular++;
      }
      if(matched>=9)explainedStraight++;
      else outsideKnownStraight++;
      if(circular>=12)nearKnownCircle++;
    }
    const observed={
      fixture:kind,lines:lines.length,circles:circles.length,
      candidateReferenceProxy:{alignedStraight:explainedStraight,
        notMostlyAlignedStraight:outsideKnownStraight,
        mostlyOnCircleRim:nearKnownCircle,
        redundantCircularChordsRemaining:lines.filter(e=>e.points.length===2&&
          isRedundantCircleStroke({a:e.points[0],b:e.points[1],confidence:.8},circle)).length},
      lineCoverageAt4px:lineCoverage,
      nearestCircle:nearest,
      autoApproved:entities.filter(e=>e.verified).length,
      limitation:'Synthetic line-sample coverage; NOT precision, recall, or engineering mm accuracy',
    };
    await mkdir('test-results',{recursive:true});
    await writeFile('test-results/w3-'+kind+'-quality.json',JSON.stringify(observed,null,2));
    console.log('W3_QUALITY '+JSON.stringify(observed));
    expect(observed.autoApproved).toBe(0);
    expect(lines.every(e=>(e.reason||'').includes('исходный штрих')&&
      (e.confidence===undefined||(e.confidence>=0&&e.confidence<=1)))).toBe(true);
    expect(lineCoverage).toHaveLength(3);
    // Synthetic regression GATE: catch catastrophic axis-aligned loss.
    // This is a line-sample coverage metric, NOT global CAD recall/F1.
    const floor=kind==='clean'?.97:.85;
    for(const c of lineCoverage)expect(c).toBeGreaterThanOrEqual(floor);
    expect(lines.length).toBeGreaterThanOrEqual(3);
    // Preserve valid independent diagonals: the old Hough shortcut compared
    // only first.x / last.y / angle and incorrectly dropped distinct strokes.
    // Its removal recovers more proposals, so do NOT force a numeric target
    // that can only pass by hiding geometry. Still guard against the earlier
    // 310-candidate baseline on these fixed synthetic fixtures.
    expect(lines.length).toBeLessThan(kind==='clean'?270:255);
    // Keep the already detected editable CIRCLE from reappearing as many
    // approximate tangent chords; on this fixture measured 19/22.
    expect(observed.candidateReferenceProxy.redundantCircularChordsRemaining).toBeLessThanOrEqual(25);
    expect(outsideKnownStraight).toBeLessThanOrEqual(kind==='clean'?90:120);
    if(kind==='clean'){
      expect(nearest).not.toBeNull();
      expect(nearest!.centerErrorPx).toBeLessThanOrEqual(6);
      expect(nearest!.radiusErrorPx).toBeLessThanOrEqual(6);
    }
  });
}
