import {validateProject,type CadProject} from './model';
const DB='cadrecon-projects';const VERSION=1;
const STORE='records';
interface RecordItem {key:string;project:CadProject;time:number;}
function openDB():Promise<IDBDatabase>{
  return new Promise((resolve,reject)=>{
    const r=indexedDB.open(DB,VERSION);r.onerror=()=>reject(r.error);
    r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains(STORE))r.result.createObjectStore(STORE,{keyPath:'key'});};
    r.onsuccess=()=>resolve(r.result);
  });
}
async function write(record:RecordItem){
  const db=await openDB();return new Promise<void>((resolve,reject)=>{
    const tx=db.transaction(STORE,'readwrite');
    tx.objectStore(STORE).put(record);tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>{db.close();reject(tx.error);};
  });
}
async function read(key:string) {
  const db=await openDB();return new Promise<RecordItem|undefined>((resolve,reject)=>{
    const tx=db.transaction(STORE,'readonly');const r=tx.objectStore(STORE).get(key);
    r.onsuccess=()=>{db.close();resolve(r.result as RecordItem|undefined);};r.onerror=()=>{db.close();reject(r.error);};
  });
}
export async function saveProject(project:CadProject){await write({key:'latest',project:validateProject(project),time:Date.now()});}
export async function loadProject(){const x=await read('latest');return x?validateProject(x.project):null;}
export async function createBackup(project:CadProject){
  const key='backup-'+Date.now()+'-'+Math.random().toString(16).slice(2,6);
  await write({key,project:structuredClone(validateProject(project)),time:Date.now()});
  const all=await listBackups();
  for(const old of all.slice(8))await deleteBackup(old.key);
  return key;
}
export async function listBackups():Promise<{key:string;time:number;name:string}[]>{
  const db=await openDB();return new Promise((resolve,reject)=>{
    const r=db.transaction(STORE,'readonly').objectStore(STORE).getAll();
    r.onsuccess=()=>{db.close();resolve((r.result as RecordItem[]).filter(v=>v.key.startsWith('backup-')).map(v=>({key:v.key,time:v.time,name:v.project.name})).sort((a,b)=>b.time-a.time));};
    r.onerror=()=>{db.close();reject(r.error);};
  });
}
export async function restoreBackup(key:string) {if(!key.startsWith('backup-'))throw new Error('Неверный резервный ключ');const v=await read(key);if(!v)throw new Error('Резервная копия отсутствует');return validateProject(v.project);}
export async function deleteBackup(key:string){const db=await openDB();return new Promise<void>((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).delete(key);tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>{db.close();reject(tx.error);};});}
export function downloadFile(data:string,filename:string,type='application/octet-stream'){const a=document.createElement('a');const href=URL.createObjectURL(new Blob([data],{type}));a.href=href;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(href),10000);}
export function exportProject(p:CadProject){downloadFile(JSON.stringify(p,null,2),p.name.replace(/[^\p{L}\p{N}._-]+/gu,'_')+'.cadrecon.json','application/json');}
export async function importProject(file:File){if(file.size>90*1024*1024)throw new Error('Слишком большой JSON');const parsed=JSON.parse(await file.text());return validateProject(parsed);}