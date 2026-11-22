/** Opt-in LOCAL Ultra transport: only loopback on the user's own computer.
 * No infrastructure owned or operated by CadRecon is needed.
 * The browser asks for explicit confirmation and never persists credentials.
 * Remote redirects are forbidden, including those originating from localhost.
 */
import {decodeAdvancedResponse,validateAdvancedEndpoint,
  type AdvancedResponse,type AdvancedResult} from './advanced';
import type {Sheet} from './model';

type JobCreated={id:string;job_token:string;expires_in_seconds:number};
type JobStatus={id:string;status:'queued'|'running'|'succeeded'|'failed'|'cancelled';expires_in_seconds:number};
type LoopbackRequest=RequestInit&{targetAddressSpace?:'loopback'};

function requestHeaders(token:string,jobToken?:string) {
  const headers:Record<string,string>={'Authorization':'Bearer '+token};
  if(jobToken)headers['X-Job-Token']=jobToken;
  return headers;
}
function request(url:string,token:string,method:'GET'|'POST'|'DELETE',
  signal:AbortSignal,jobToken?:string,body?:FormData):LoopbackRequest {
  const req:LoopbackRequest={method,headers:requestHeaders(token,jobToken),body,signal,redirect:'error'};
  const target=new URL(url);
  if(['127.0.0.1','localhost','[::1]'].includes(target.hostname)&&
    typeof location!=='undefined'&&location.protocol==='https:')
    req.targetAddressSpace='loopback';
  return req;
}
async function assertOk(res:Response):Promise<void>{
  if(res.ok)return;
  throw new Error('Ultra локально: HTTP '+res.status);
}
export async function recognizeOnline(
  sheet:Sheet,endpoint:string,token:string,
  progress?:(message:string)=>void,
  signal?:AbortSignal
):Promise<AdvancedResult> {
  if(!sheet.image)throw new Error('На листе отсутствует исходная подложка');
  if(!token.trim())throw new Error('Укажите токен доступа Ultra локально');
  const base=validateAdvancedEndpoint(endpoint);
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),240000);
  const relay=()=>controller.abort();
  signal?.addEventListener('abort',relay,{once:true});
  if(signal?.aborted)controller.abort();
  let job:JobCreated|undefined;
  try {
    progress?.('Ultra локально: подготовка листа...');
    const source=await fetch(sheet.image,{signal:controller.signal});
    const blob=await source.blob();
    const form=new FormData();
    form.append('image',blob,'cadrecon-page.png');
    // This value may be set ONLY after independent UI user confirmation.
    form.append('consent','true');
    const response=await fetch(base+'/v1/jobs',
      request(base+'/v1/jobs',token,'POST',controller.signal,undefined,form));
    await assertOk(response);
    job=await response.json() as JobCreated;
    if(!job.id||!job.job_token)throw new Error('Ultra локально: неправильный ответ сервера');
    const url=base+'/v1/jobs/'+encodeURIComponent(job.id);
    for(let i=0;i<300;i++){
      const stateResponse=await fetch(url,request(url,token,'GET',controller.signal,job.job_token));
      await assertOk(stateResponse);
      const state=await stateResponse.json() as JobStatus;
      if(state.status==='succeeded'){
        progress?.('Ultra локально: загрузка проверяемых кандидатов...');
        const resultUrl=url+'/result';
        const output=await fetch(resultUrl,
          request(resultUrl,token,'GET',controller.signal,job.job_token));
        await assertOk(output);
        return decodeAdvancedResponse(sheet,await output.json() as AdvancedResponse);
      }
      if(state.status==='failed'||state.status==='cancelled')
        throw new Error('Ultra локально: сервер не смог обработать лист. Проверьте журнал без передачи чертежа.');
      progress?.(state.status==='running'?'Ultra локально: OCR и реконструкция...':
        'Ultra локально: ожидание свободного вычислителя...');
      await new Promise<void>(resolve=>setTimeout(resolve,750));
      if(controller.signal.aborted)throw new Error('Ultra локально: обработка отменена');
    }
    throw new Error('Ultra локально: превышено время ожидания результата');
  } finally {
    // Delete ephemeral result even after successful import; best-effort only.
    if(job?.id&&job.job_token){
      const url=base+'/v1/jobs/'+encodeURIComponent(job.id);
      try{
        await fetch(url,request(url,token,'DELETE',new AbortController().signal,job.job_token));
      }catch{ /* Server TTL remains the fallback when deletion cannot reach it. */ }
    }
    clearTimeout(timeout);
    signal?.removeEventListener('abort',relay);
  }
}
