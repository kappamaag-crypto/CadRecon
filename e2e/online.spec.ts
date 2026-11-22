import {test,expect} from '@playwright/test';
import {newProject} from '../src/model';

test('Online Accurate uses explicit consent, scoped credentials, queue and deletes result',async ({page})=>{
  const project=newProject(),sheet=project.sheets[0];
  sheet.width=300;sheet.height=200;sheet.sourceType='image';
  sheet.image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL9SAAAAABJRU5ErkJggg==';
  const methods:string[]=[];
  let uploaded=false;
  await page.route('https://cadrecon-pilot.example.test/v1/**',async route=>{
    const url=route.request().url();
    const method=route.request().method();
    methods.push(method+' '+new URL(url).pathname);
    const headers=route.request().headers();
    expect(headers.authorization).toBe('Bearer fixture-token');
    if(method==='POST'){
      expect(route.request().postData()||'').toContain('consent');
      expect(route.request().postData()||'').toContain('true');
      uploaded=true;
      await route.fulfill({status:202,contentType:'application/json',
        headers:{'Access-Control-Allow-Origin':'*'},
        body:JSON.stringify({id:'fixture-job',job_token:'job-secret',status:'queued',expires_in_seconds:900})});
    }else if(method==='GET'&&url.endsWith('/result')){
      expect(headers['x-job-token']).toBe('job-secret');
      await route.fulfill({status:200,contentType:'application/json',
        headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify({
          engine:'fixture Online Accurate',width:300,height:200,
          texts:[{text:'R20',box:[10,10,50,22],confidence:.99}],
          lines:[{a:[0,40],b:[200,40],confidence:.9}],circles:[],polygons:[],
        })});
    }else if(method==='GET'){
      await route.fulfill({status:200,contentType:'application/json',
        headers:{'Access-Control-Allow-Origin':'*'},
        body:JSON.stringify({id:'fixture-job',status:'succeeded',expires_in_seconds:900})});
    }else {
      await route.fulfill({status:200,contentType:'application/json',
        headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify({deleted:true})});
    }
  });
  await page.goto('/CadRecon/');
  await page.locator('input[type=file][accept=".json,.cadrecon.json"]').setInputFiles({
    name:'online-fixture.cadrecon.json',mimeType:'application/json',
    buffer:Buffer.from(JSON.stringify(project)),
  });
  await page.getByLabel('Адрес Online Accurate').fill('https://cadrecon-pilot.example.test');
  await page.getByLabel('Токен Online Accurate').fill('fixture-token');
  page.once('dialog',dialog=>dialog.accept());
  await page.getByRole('button',{name:/Online Accurate: распознать лист/}).click();
  await expect(page.getByText(/fixture Online Accurate: 2 новых элементов/))
    .toBeVisible({timeout:15000});
  expect(uploaded).toBe(true);
  await expect.poll(()=>methods.some(x=>x.startsWith('DELETE ')),{timeout:15000}).toBe(true);
  expect(methods.some(x=>x.startsWith('GET /v1/jobs/fixture-job/result'))).toBe(true);
});
