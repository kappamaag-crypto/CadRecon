/** Read-only browser import for Excel OOXML (XLSX/XLSM).
 * Never execute VBA, formulas, external links, ActiveX or Office macros.
 * ZIP entries are validated and bounded to prevent common ZIP bombs.
 * Older binary XLS or encrypted workbooks are intentionally not supported.
 */
import {parseSpecificationCSV,type SpecificationRow} from './archiveFeatures';

interface Entry {name:string;offset:number;compressed:number;uncompressed:number;method:number;flags:number}
const decoder=new TextDecoder('utf-8',{fatal:false});
const MAX_FILE=25_000_000,MAX_XML=18_000_000,MAX_TOTAL=50_000_000;
const u16=(v:DataView,i:number)=>v.getUint16(i,true);
const u32=(v:DataView,i:number)=>v.getUint32(i,true);

function catalog(data:Uint8Array):Map<string,Entry>{
  const view=new DataView(data.buffer,data.byteOffset,data.byteLength);
  let tail=-1;
  for(let i=data.length-22;i>=Math.max(0,data.length-65557);i--){
    if(u32(view,i)===0x06054b50){tail=i;break;}
  }
  if(tail<0)throw new Error('Excel: повреждённая структура ZIP');
  const num=u16(view,tail+10),centralSize=u32(view,tail+12),start=u32(view,tail+16);
  if(num>4000||centralSize>15_000_000||start+centralSize>data.length)
    throw new Error('Excel: превышен лимит структуры ZIP');
  const files=new Map<string,Entry>();
  let offset=start;
  for(let i=0;i<num;i++){
    if(offset+46>data.length||u32(view,offset)!==0x02014b50)
      throw new Error('Excel: повреждённый каталог ZIP');
    const flags=u16(view,offset+8),method=u16(view,offset+10);
    const compressed=u32(view,offset+20),uncompressed=u32(view,offset+24);
    const n=u16(view,offset+28),extra=u16(view,offset+30),comment=u16(view,offset+32);
    const local=u32(view,offset+42);
    if(n>800||offset+46+n+extra+comment>data.length)
      throw new Error('Excel: повреждено имя ZIP');
    const name=decoder.decode(data.subarray(offset+46,offset+46+n)).replace(/\\/g,'/');
    if((flags&1)!==0)throw new Error('Excel: зашифрованный файл не поддерживается');
    if(method!==0&&method!==8)throw new Error('Excel: неподдерживаемый способ сжатия');
    if(name.startsWith('/')||name.includes('../')||name.includes('\0'))
      throw new Error('Excel: небезопасный путь внутри архива');
    files.set(name,{name,offset:local,compressed,uncompressed,method,flags});
    offset+=46+n+extra+comment;
  }
  return files;
}
async function unpack(
  source:Uint8Array,entry:Entry,maxBytes=MAX_XML
):Promise<Uint8Array>{
  if(entry.uncompressed>maxBytes||entry.compressed>MAX_FILE)
    throw new Error('Excel: внутренний XML слишком большой');
  const view=new DataView(source.buffer,source.byteOffset,source.byteLength);
  if(entry.offset<0||entry.offset+30>source.length||u32(view,entry.offset)!==0x04034b50)
    throw new Error('Excel: повреждено расположение ZIP');
  const n=u16(view,entry.offset+26),extra=u16(view,entry.offset+28);
  const start=entry.offset+30+n+extra,end=start+entry.compressed;
  if(end>source.length)throw new Error('Excel: ZIP данные усечены');
  const compressed=source.subarray(start,end);
  if(entry.method===0){
    if(compressed.length!==entry.uncompressed)throw new Error('Excel: неверный размер данных');
    return compressed;
  }
  if(typeof DecompressionStream==='undefined')
    throw new Error('Браузер не поддерживает распаковку XLSX; экспортируйте спецификацию в CSV');
  // The browser handles DEFLATE; we never load a JS executable from XLSM.
  const copy=new Uint8Array(compressed.length);copy.set(compressed);
  const stream=new Blob([copy]).stream()
    .pipeThrough(new DecompressionStream('deflate-raw' as CompressionFormat));
  const reader=stream.getReader(),chunks:Uint8Array[]=[];let total=0;
  try{
    for(;;){
      const item=await reader.read();
      if(item.done)break;
      total+=item.value.byteLength;
      if(total>maxBytes)throw new Error('Excel: распакованный XML превышает лимит');
      chunks.push(item.value);
    }
  }finally{await reader.cancel().catch(()=>{});}
  if(total!==entry.uncompressed)throw new Error('Excel: несоответствие размеров распаковки');
  const out=new Uint8Array(total);let offset=0;
  for(const chunk of chunks){out.set(chunk,offset);offset+=chunk.length;}
  return out;
}
function parseXml(bytes:Uint8Array):Document{
  const xml=decoder.decode(bytes);
  // OOXML does not require DTD. Reject entity expansion and external resource
  // declarations rather than parsing a potentially hostile Excel document.
  if(/<!\s*(?:DOCTYPE|ENTITY)/i.test(xml))throw new Error('Excel: запрещены DTD и XML-сущности');
  const doc=new DOMParser().parseFromString(xml,'application/xml');
  if(doc.getElementsByTagName('parsererror').length)
    throw new Error('Excel: повреждённый XML');
  return doc;
}
function elements(root:Document|Element,name:string):Element[]{
  return Array.from(root.getElementsByTagNameNS('*',name));
}
function texts(el:Element):string{
  return elements(el,'t').map(x=>x.textContent||'').join('');
}
function readSharedStrings(doc:Document):string[]{
  const list=elements(doc,'si');
  if(list.length>150000)throw new Error('Excel: слишком много строк словаря');
  return list.map(texts);
}
function readWorksheet(doc:Document,shared:string[]):string[][]{
  const output:string[][]=[];
  const rows=elements(doc,'row');
  for(const row of rows.slice(0,5500)){
    const cells:string[]=[];
    for(const c of elements(row,'c')){
      const ref=c.getAttribute('r')||'';
      const match=/^([A-Z]{1,3})\d+$/i.exec(ref);
      if(!match)continue;
      let column=0;
      for(const letter of match[1].toUpperCase())column=column*26+(letter.charCodeAt(0)-64);
      const index=column-1;
      if(index<0||index>100)continue;
      const t=c.getAttribute('t')||'';
      const v=elements(c,'v')[0]?.textContent||'';
      let value=t==='inlineStr'?texts(c):
        t==='s'?shared[Number(v)]||'':v;
      if(value.length>600)value=value.slice(0,600);
      cells[index]=value;
    }
    if(cells.some(Boolean))output.push(cells.map(s=>s||''));
  }
  return output;
}
function isSpecHeader(row:string[]):boolean{
  const normalized=row.map(x=>x.trim().replace(/\s+/g,' ').toLocaleLowerCase('ru-RU'));
  return normalized.some(s=>s==='позиция'||s==='поз.'||s==='position'||s==='pos')&&
    normalized.some(s=>s==='наименование'||s==='название'||s==='name'||s==='description');
}
function rowsToCSV(rows:string[][]):string{
  return rows.map(r=>r.map(s=>'"'+(s||'').replace(/"/g,'""')+'"').join(';')).join('\n');
}
export async function parseSpecificationWorkbook(file:File):Promise<{
  rows:SpecificationRow[];sheetNumber:number;warnings:string[];
}>{
  if(file.size>MAX_FILE)throw new Error('Excel: максимальный размер файла 25 МБ');
  const source=new Uint8Array(await file.arrayBuffer());
  const files=catalog(source),warnings:string[]=[
    'Excel открыт только для чтения. Макросы, формулы и внешние подключения не выполнялись.',
    'Кэшированные значения формул могут быть устаревшими; проверьте спецификацию в исходном КОМПАС/Excel.',
  ];
  if(!files.has('xl/workbook.xml'))throw new Error('Excel: отсутствует xl/workbook.xml');
  let shared:string[]=[];
  let total=0;
  const strings=files.get('xl/sharedStrings.xml');
  if(strings){
    total+=strings.uncompressed;
    if(total>MAX_TOTAL)throw new Error('Excel: слишком большой набор XML');
    shared=readSharedStrings(parseXml(await unpack(source,strings)));
  }
  const sheets=[...files.values()].filter(x=>/^xl\/worksheets\/sheet\d+\.xml$/.test(x.name))
    .sort((a,b)=>Number(a.name.match(/\d+/)?.[0]||0)-Number(b.name.match(/\d+/)?.[0]||0)).slice(0,40);
  if(!sheets.length)throw new Error('Excel: нет таблиц');
  for(let idx=0;idx<sheets.length;idx++){
    const part=sheets[idx];
    // Skip implausibly large template sheets instead of allowing huge RAM.
    if(part.uncompressed>MAX_XML)continue;
    total+=part.uncompressed;
    if(total>MAX_TOTAL)throw new Error('Excel: суммарный XML превышает 50 МБ');
    const matrix=readWorksheet(parseXml(await unpack(source,part)),shared);
    const start=matrix.findIndex(isSpecHeader);
    if(start<0)continue;
    const relevant=matrix.slice(start).filter(row=>row.some(c=>c.trim()));
    const rows=parseSpecificationCSV(rowsToCSV(relevant));
    if(!rows.length)throw new Error('В листе спецификации нет заполненных позиций');
    return {rows,sheetNumber:idx+1,warnings};
  }
  throw new Error('Excel: не найдена таблица с заголовками «Позиция» и «Наименование». Экспортируйте нужный лист в CSV.');
}
