/* Uncompressed ZIP, UTF-8 filenames, RFC 1952/ZIP APPNOTE structure.
 * Bundle all DXF sheets in the browser without a server or third-party service. */
const encoder=new TextEncoder();
const u16=(v:DataView,o:number,n:number)=>v.setUint16(o,n,true);
const u32=(v:DataView,o:number,n:number)=>v.setUint32(o,n>>>0,true);
function crc32(bytes:Uint8Array):number{
  let crc=0xffffffff;
  for(const x of bytes){crc^=x;for(let j=0;j<8;j++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  return (crc^0xffffffff)>>>0;
}
interface ZipEntry {name:string;data:string;}
export function createZip(files:ZipEntry[]):Uint8Array{
  if(files.length>65535)throw new Error('Too many ZIP files');
  const parts:Uint8Array[]=[];const central:Uint8Array[]=[];let offset=0;
  for(const f of files){
    const name=encoder.encode(f.name.replace(/[\/\\]/g,'_'));const data=encoder.encode(f.data);
    const crc=crc32(data),local=new Uint8Array(30+name.length),lv=new DataView(local.buffer);
    u32(lv,0,0x04034b50);u16(lv,4,20);u16(lv,6,0x0800);u16(lv,8,0);u16(lv,10,0);u16(lv,12,0);
    u32(lv,14,crc);u32(lv,18,data.length);u32(lv,22,data.length);u16(lv,26,name.length);u16(lv,28,0);local.set(name,30);
    const dir=new Uint8Array(46+name.length),dv=new DataView(dir.buffer);
    u32(dv,0,0x02014b50);u16(dv,4,20);u16(dv,6,20);u16(dv,8,0x0800);u16(dv,10,0);u16(dv,12,0);u16(dv,14,0);
    u32(dv,16,crc);u32(dv,20,data.length);u32(dv,24,data.length);u16(dv,28,name.length);u16(dv,30,0);u16(dv,32,0);u16(dv,34,0);u16(dv,36,0);u32(dv,38,0);u32(dv,42,offset);dir.set(name,46);
    parts.push(local,data);central.push(dir);offset+=local.length+data.length;
  }
  const cdSize=central.reduce((n,c)=>n+c.length,0),end=new Uint8Array(22),view=new DataView(end.buffer);
  u32(view,0,0x06054b50);u16(view,4,0);u16(view,6,0);u16(view,8,files.length);u16(view,10,files.length);u32(view,12,cdSize);u32(view,16,offset);u16(view,20,0);
  const result=new Uint8Array(offset+cdSize+end.length);let cursor=0;
  for(const p of [...parts,...central,end]){result.set(p,cursor);cursor+=p.length;}
  return result;
}
export function downloadZip(data:Uint8Array,name:string):void{
  const copy=new Uint8Array(data.length);copy.set(data);
  const url=URL.createObjectURL(new Blob([copy],{type:'application/zip'}));
  const link=document.createElement('a');link.href=url;link.download=name;link.click();
  setTimeout(()=>URL.revokeObjectURL(url),10000);
}