/** Repair the most common PDF font-encoding corruption:
 * CP1251 bytes incorrectly read as ISO-8859-1/Latin-1 (e.g. "Áîëò" -> "Болт").
 * Only transform sequences with strong evidence; never fabricate ambiguous single-letter marks.
 */
export interface TextRepair {text:string; changed:boolean; reason?:string; confidence:number;}
const decoder=new TextDecoder('windows-1251');
const run=/[\u00C0-\u00FF\u00A8\u00B8]{3,}/g;
export function repairPdfText(input:string):TextRepair{
  let replacements=0;
  const output=input.replace(run,segment=>{
    const candidate=decoder.decode(Uint8Array.from([...segment].map(x=>x.charCodeAt(0))));
    const cyr=[...candidate].filter(ch=>/[А-Яа-яЁё]/.test(ch)).length;
    if(cyr/segment.length<.85)return segment;
    replacements++;return candidate;
  });
  // A one-letter symbol, named grade, or Latin technical abbreviation is ambiguous.
  return replacements?{text:output,changed:true,reason:'PDF: исправлена предполагаемая ошибка Latin-1/Windows-1251; проверьте надпись по оригиналу',confidence:.64}
    :{text:input,changed:false,confidence:1};
}
export function suspiciousText(input:string):boolean{
  return /(?:[\u00C0-\u00FF]{2,}|�|\u0000)/.test(input);
}
