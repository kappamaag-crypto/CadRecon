import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';

test.beforeAll(()=>{
  execFileSync('python3',['benchmarks/w0/generate_fixtures.py','--out','test-results/cancel-golden']);
});

test('on-device tracing can be cancelled without any partial CAD commit',async ({page})=>{
  // A stalled local worker is a real-world browser possibility (low-memory
  // devices, driver errors). No server is used. Simulate an unresponsive worker.
  await page.addInitScript(()=>{
    class StalledWorker {
      onmessage:((event:MessageEvent)=>void)|null=null;
      onerror:((event:ErrorEvent)=>void)|null=null;
      postMessage(){}
      terminate(){}
    }
    Object.defineProperty(window,'Worker',{configurable:true,value:StalledWorker});
  });
  await page.goto('/CadRecon/');
  await page.locator('input[type=file][accept*=".pdf"]').setInputFiles({
    name:'scan_clean_300dpi.png',mimeType:'image/png',
    buffer:await readFile('test-results/cancel-golden/scan_clean_300dpi.png'),
  });
  await expect(page.getByText(/Импортировано листов: 1/)).toBeVisible({timeout:20000});
  await page.getByRole('button',{name:/Точное распознавание в браузере/}).click();
  const cancel=page.getByRole('button',{name:/Остановить обработку на устройстве/});
  await expect(cancel).toBeVisible();
  await cancel.click();
  await expect(page.getByText('Распознавание отменено.')).toBeVisible({timeout:15000});
  await expect(cancel).toHaveCount(0);
  const [dl]=await Promise.all([
    page.waitForEvent('download'),page.getByRole('button',{name:'↓ JSON'}).click(),
  ]);
  const json=JSON.parse(await readFile((await dl.path())!,'utf8')) as {
    sheets:Array<{entities:unknown[]}>;
  };
  expect(json.sheets[0].entities).toHaveLength(0);
});
