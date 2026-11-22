/** Minimal valid Office Open XML workbook from safe inline strings.
 * No Excel automation, VBA, third-party hosting, macro data or executable
 * formulas. The user-supplied content is ALWAYS encoded as text.
 */
import type {CadProject} from './model';
import {inventoryProject,weldSchedule,compareSpecification} from './archiveFeatures';
import {createZip} from './zip';
import {auditScanGeometry} from './scanReview';

export type Cell=string|number|boolean|null|undefined;
export interface ReportSheet {name:string;headers:string[];rows:Cell[][];}
const ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const esc=(value:unknown):string=>String(value??'')
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'')
  .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  .replace(/"/g,'&quot;').replace(/'/g,'&apos;');
function col(index:number):string {
  let x=index+1,value='';
  while(x>0){x--;value=String.fromCharCode(65+x%26)+value;x=Math.floor(x/26);}
  return value;
}
function validSheetName(name:string,used:Set<string>):string{
  const base=(name.replace(/[\\\/?*:[\]]/g,'_').trim()||'Лист').slice(0,31);
  let out=base,n=1;
  while(used.has(out.toLocaleLowerCase('ru-RU'))){
    const suffix='_'+n++;
    out=base.slice(0,31-suffix.length)+suffix;
  }
  used.add(out.toLocaleLowerCase('ru-RU'));
  return out;
}
function worksheet(spec:ReportSheet):string{
  const cols=spec.headers.length,rows=spec.rows.length+1;
  if(cols<1||cols>60||rows>60000)throw new Error('Слишком большой отчёт Excel');
  const cells=(values:Cell[],row:number,header:boolean):string=>{
    return '<row r="'+row+'">'+values.map((value,index)=>{
      if(index>=cols)return '';
      const ref=col(index)+row,style=header?' s="1"':'';
      if(!header&&typeof value==='number'&&Number.isFinite(value))
        return '<c r="'+ref+'"'+style+'><v>'+value+'</v></c>';
      return '<c r="'+ref+'" t="inlineStr"'+style+'><is><t xml:space="preserve">'+
        esc(value)+'</t></is></c>';
    }).join('')+'</row>';
  };
  const widths=spec.headers.map((header,i)=>{
    const length=Math.max(header.length,...spec.rows.slice(0,100).map(r=>String(r[i]??'').length));
    return '<col min="'+(i+1)+'" max="'+(i+1)+'" width="'+Math.min(43,Math.max(13,Math.ceil(length*.9)))+'" customWidth="1"/>';
  }).join('');
  const data=[cells(spec.headers,1,true),...spec.rows.map((row,i)=>cells(row,i+2,false))].join('');
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
    '<worksheet xmlns="'+ns+'">'+
    '<dimension ref="A1:'+col(cols-1)+rows+'"/>'+
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'+
    '<sheetFormatPr defaultRowHeight="16"/><cols>'+widths+'</cols><sheetData>'+data+'</sheetData>'+
    '<autoFilter ref="A1:'+col(cols-1)+rows+'"/>'+
    '<pageMargins left="0.5" right="0.5" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>'+
    '</worksheet>';
}
const styles='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
  '<styleSheet xmlns="'+ns+'">'+
  '<fonts count="2"><font><sz val="10"/><name val="Aptos"/></font>'+
  '<font><b/><color rgb="FFFFFFFF"/><sz val="10"/><name val="Aptos"/></font></fonts>'+
  '<fills count="3"><fill><patternFill patternType="none"/></fill>'+
  '<fill><patternFill patternType="gray125"/></fill>'+
  '<fill><patternFill patternType="solid"><fgColor rgb="FF164563"/><bgColor indexed="64"/></patternFill></fill></fills>'+
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'+
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'+
  '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'+
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>'+
  '</styleSheet>';

export function createReportXlsx(sheets:ReportSheet[]):Uint8Array{
  if(!sheets.length||sheets.length>25)throw new Error('Неверное число листов отчёта');
  const names=new Set<string>();
  const namesSafe=sheets.map(s=>validSheetName(s.name,names));
  const book='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
    '<workbook xmlns="'+ns+'" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'+
    '<sheets>'+namesSafe.map((name,i)=>'<sheet name="'+esc(name)+'" sheetId="'+(i+1)+'" r:id="rId'+(i+1)+'"/>').join('')+
    '</sheets></workbook>';
  const relType='http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
  const rels='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+
    sheets.map((_,i)=>'<Relationship Id="rId'+(i+1)+'" Type="'+relType+'worksheet" Target="worksheets/sheet'+(i+1)+'.xml"/>').join('')+
    '<Relationship Id="rId'+(sheets.length+1)+'" Type="'+relType+'styles" Target="styles.xml"/></Relationships>';
  const types='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'+
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'+
    '<Default Extension="xml" ContentType="application/xml"/>'+
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'+
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'+
    sheets.map((_,i)=>'<Override PartName="/xl/worksheets/sheet'+(i+1)+'.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('')+
    '</Types>';
  const entries=[
    {name:'[Content_Types].xml',data:types},
    {name:'_rels/.rels',data:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+
      '<Relationship Id="rId1" Type="'+relType+'officeDocument" Target="xl/workbook.xml"/></Relationships>'},
    {name:'xl/workbook.xml',data:book},
    {name:'xl/_rels/workbook.xml.rels',data:rels},
    {name:'xl/styles.xml',data:styles},
    ...sheets.map((sheet,i)=>({name:'xl/worksheets/sheet'+(i+1)+'.xml',data:worksheet(sheet)})),
  ];
  return createZip(entries);
}
export function projectReportXlsx(project:CadProject):Uint8Array{
  const inventory=inventoryProject(project);
  const welds=weldSchedule(project);
  const scan=auditScanGeometry(project);
  const issues=project.specification?.length?compareSpecification(project,project.specification):[];
  const sheets:ReportSheet[]=[
    {name:'Сводка',headers:['Показатель','Значение','Пояснение'],rows:[
      ['Проект',project.name,'Данные получены локально в браузере'],
      ['Листов',project.sheets.length,''],
      ['Всего CAD-объектов',inventory.rows.length,''],
      ['Непроверенных CAD-объектов',inventory.unverified,'Не использовать без инженерной проверки'],
      ['Листов без калибровки',project.sheets.filter(s=>!s.calibrated).length,'На них единицы условные'],
      ['Групп сварных обозначений',welds.length,'Проверять по подложке'],
      ['Расхождений позиций',issues.length,'Контроль только явно подписанных позиций'],
      ['Потенциальных разрывов W3',scan.nearGaps,'Диагностика без автоматических соединений'],
      ['Слабых штрихов W3',scan.weakInk,'Не является доказательством ошибки'],
      ['Выдача диагностики W3 ограничена',scan.truncated?'да':'нет','Максимум 600 замечаний; плотные области могут быть пропущены'],
    ]},
    {name:'Объекты',headers:['Лист','ID','Тип','Слой','Источник','Проверен','Параметр','Координаты'],
      rows:inventory.rows.map(e=>[e.sheet,e.id,e.kind,e.layer,e.origin,e.verified?'да':'нет',e.detail,e.location])},
    {name:'Окружности',headers:['Лист','Диаметр','Единицы','Различных центров','Проверенных','Комментарий'],
      rows:inventory.circles.map(c=>[project.sheets[c.sheetIndex].name,
        Number(c.diameter.toFixed(3)),c.unit,c.count,c.verified,
        'Только окружности, НЕ доказанные отверстия'])},
    {name:'Сварка',headers:['Обозначение','Отметок','Листы','Непроверенных'],
      rows:welds.map(w=>[w.designation,w.count,w.sheetIndices.map(i=>project.sheets[i].name).join(', '),w.unverified])},
    {name:'Диагностика W3',headers:['Тип','Лист','Объект','Связанный объект','Зазор (ед. листа)','Замечание'],
      rows:scan.findings.map(f=>[f.kind,f.sheetName,f.entityId,f.relatedEntityId||'',
        f.distance===undefined?'':Number(f.distance.toFixed(3)),f.description])},
  ];
  if(project.specification?.length){
    sheets.push({name:'Спецификация',headers:['Позиция','Обозначение','Наименование','Количество','Материал','Масса','Примечание'],
      rows:project.specification.map(r=>[r.position,r.designation,r.name,r.quantity,r.material||'',r.mass||'',r.note||''])});
    sheets.push({name:'Сверка позиций',headers:['Статус','Позиция','Описание','Лист','ID'],
      rows:issues.map(f=>[f.status,f.position,f.description,f.sheetIndex===undefined?'':project.sheets[f.sheetIndex].name,f.entityId||''])});
  }
  return createReportXlsx(sheets);
}
export function downloadReportXlsx(data:Uint8Array,filename:string):void{
  // Copy into a fresh ArrayBuffer accepted by the browser Blob API.
  const safe=new Uint8Array(data.length);safe.set(data);
  const url=URL.createObjectURL(new Blob([safe],{
    type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }));
  const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);
  a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
