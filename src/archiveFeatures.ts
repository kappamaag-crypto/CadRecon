/** Browser-only drawing search and engineering evidence inventory.
 * Inspired by user-provided SearchTextApp and КОМПАС ГАЛС feature categories,
 * NOT a binary port, COM integration, certified ESKD check, or native 3D BOM.
 */
import type {CadProject, Entity, Point, Sheet} from './model';

export type SearchCategory='all'|'positions'|'dimensions'|'text'|'leaders'|'tables'|'requirements'|'welds'|'stamps';
export interface DrawingHit {
  sheetIndex:number;sheetName:string;entityId:string;kind:Entity['kind'];
  category:Exclude<SearchCategory,'all'>;text:string;point:Point;
  verified:boolean;confidence?:number;origin:Entity['origin'];
}
export interface SearchOptions {
  query:string;category?:SearchCategory;caseSensitive?:boolean;allSheets?:boolean;
  currentSheet?:number;limit?:number;
}
export interface SpecificationRow {
  position:string;designation:string;name:string;quantity:string;
  material?:string;mass?:string;note?:string;
}
export interface BomFinding {
  status:'missing-on-drawing'|'not-in-spec'|'duplicate-on-drawing'|'duplicate-in-spec';
  position:string;description:string;sheetIndex?:number;entityId?:string;
}
export interface InventoryRow {
  sheetIndex:number;sheet:string;id:string;kind:string;layer:string;origin:string;
  verified:boolean;detail:string;location:string;
}
export interface CircleGroup {sheetIndex:number;diameter:number;count:number;entityIds:string[];unit:'мм'|'ед.';verified:number;}
export interface WeldGroup {designation:string;count:number;sheetIndices:number[];entityIds:string[];unverified:number;}
export interface StampFields {
 designation:string;name:string;revision:string;sheet:string;
 developed:string;checked:string;technicalControl:string;normControl:string;
 approved:string;date:string;company:string;
}
const MAX_SEARCH=1000;
const normalize=(s:string)=>s.normalize('NFKC').trim().replace(/\s+/g,' ');
const num=(n:number)=>Number.isFinite(n)?Number(n.toFixed(3)).toString():'?';
const heading=/(?:технические\s+требования|тех\.?\s*требования|техтребовани[ея]|тех\.\s*тр\.?)\s*:?\s*/i;
const positionMarker=/(?:^|[\s,;(\[])поз(?:иция|\.)?\s*[№#:]?\s*(\d{1,5}[а-яa-z]?)(?=$|[\s,;.)\]])/iu;
export const DEFAULT_STAMP:StampFields={
  designation:'',name:'',revision:'',sheet:'',developed:'',checked:'',
  technicalControl:'',normControl:'',approved:'',date:'',company:'',
};
export function entityPoint(e:Entity):Point {
  if(e.bbox&&[e.bbox.x0,e.bbox.y0,e.bbox.x1,e.bbox.y1].every(Number.isFinite))
    return {x:(e.bbox.x0+e.bbox.x1)/2,y:(e.bbox.y0+e.bbox.y1)/2};
  if(e.center)return e.center;
  if(e.points.length===0)return {x:0,y:0};
  return {x:e.points.reduce((n,p)=>n+p.x,0)/e.points.length,
    y:e.points.reduce((n,p)=>n+p.y,0)/e.points.length};
}
export function explicitPosition(e:Entity):string|null {
  const text=e.text?.trim();
  if(!text||text.length>200)return null;
  const marked=positionMarker.exec(text);
  if(marked)return marked[1].toUpperCase();
  // A standalone number in an explicit leader is a candidate position;
  // not a generic TEXT or dimension, which would create many false positives.
  if(e.kind==='leader'&&/^\d{1,5}[A-Za-zА-Яа-я]?$/.test(text))return text.toUpperCase();
  return null;
}
function categories(e:Entity):Exclude<SearchCategory,'all'>[]{
  const list:Exclude<SearchCategory,'all'>[]=[];
  if(e.text){
    list.push('text');
    if(explicitPosition(e))list.push('positions');
    if(heading.test(e.text)||/^\s*(?:тт|пункт\s+тт)\s*[:.]/i.test(e.text))list.push('requirements');
  }
  if(e.kind==='dimension')list.push('dimensions');
  if(e.kind==='leader')list.push('leaders');
  if(e.kind==='table')list.push('tables');
  if(e.kind==='stamp')list.push('stamps');
  if((e.kind==='eskd'&&e.symbol==='weld')||
    (e.kind==='leader'&&/(?:^|[^\p{L}])(?:шов|сварн)/iu.test(e.text||'')))list.push('welds');
  return [...new Set(list)];
}
export function searchDrawings(project:CadProject,options:SearchOptions):DrawingHit[]{
  const q=normalize(options.query||'');
  if(!q||q.length>300)return [];
  const limit=Math.min(MAX_SEARCH,Math.max(1,options.limit??250));
  const term=options.caseSensitive?q:q.toLocaleLowerCase('ru-RU');
  const result:DrawingHit[]=[];
  for(let si=0;si<project.sheets.length;si++){
    if(options.allSheets===false&&si!==(options.currentSheet??0))continue;
    const sheet=project.sheets[si];
    for(const e of sheet.entities){
      const cs=categories(e);
      const matched=options.category&&options.category!=='all'?cs.filter(c=>c===options.category):cs.slice(0,1);
      if(!matched.length)continue;
      const text=e.text||'';
      if(!(options.caseSensitive?text:text.toLocaleLowerCase('ru-RU')).includes(term))continue;
      result.push({sheetIndex:si,sheetName:sheet.name,entityId:e.id,kind:e.kind,
        category:matched[0],text:text.slice(0,1000),point:entityPoint(e),
        verified:e.verified,confidence:e.confidence,origin:e.origin});
      if(result.length>=limit)return result;
    }
  }
  return result;
}
/** Only compare explicit, recognizably labelled requirements. No NLP merging. */
export function duplicateTechnicalRequirements(project:CadProject):DrawingHit[][] {
  const groups=new Map<string,DrawingHit[]>();
  for(let si=0;si<project.sheets.length;si++){
    const sheet=project.sheets[si];
    for(const e of sheet.entities){
      if(!e.text||!categories(e).includes('requirements'))continue;
      const stripped=e.text.replace(heading,'').replace(/^\s*(?:тт|пункт\s+тт)\s*[:.]?\s*/i,'');
      const lines=stripped.split(/\r?\n/).map(normalize).filter(x=>x.length>=8).slice(0,200);
      for(const line of lines){
        const key=line.toLocaleLowerCase('ru-RU');
        const list=groups.get(key)||[];
        list.push({sheetIndex:si,sheetName:sheet.name,entityId:e.id,kind:e.kind,
          category:'requirements',text:line,point:entityPoint(e),
          verified:e.verified,confidence:e.confidence,origin:e.origin});
        groups.set(key,list);
      }
    }
  }
  return [...groups.values()].filter(g=>g.length>1&&
    new Set(g.map(x=>x.sheetIndex+':'+x.entityId)).size>1)
    .sort((a,b)=>b.length-a.length).slice(0,100);
}
function csvCells(line:string,delimiter:string):string[]{
  const result:string[]=[];let current='',quoted=false;
  for(let i=0;i<line.length;i++){
    const c=line[i];
    if(c==='"'){if(quoted&&line[i+1]==='"'){current+='"';i++;}else quoted=!quoted;}
    else if(c===delimiter&&!quoted){result.push(current);current='';}
    else current+=c;
  }
  if(quoted)throw new Error('CSV: незакрытая кавычка');
  result.push(current);return result;
}
function csvRows(raw:string,delimiter:string):string[][]{
  const rows:string[][]=[];let buffer='',quoted=false;
  // Respect line breaks inside properly quoted CSV cells.
  for(let i=0;i<raw.length;i++){
    const c=raw[i];
    if(c==='"'){if(quoted&&raw[i+1]==='"'){buffer+='""';i++;}else{quoted=!quoted;buffer+=c;}}
    else if((c==='\r'||c==='\n')&&!quoted){
      if(buffer.trim())rows.push(csvCells(buffer,delimiter));
      buffer='';if(c==='\r'&&raw[i+1]==='\n')i++;
    }else buffer+=c;
    if(rows.length>6000)throw new Error('Спецификация: более 6000 строк');
  }
  if(quoted)throw new Error('CSV: незакрытая кавычка');
  if(buffer.trim())rows.push(csvCells(buffer,delimiter));
  return rows;
}
const columnAliases:Record<keyof SpecificationRow,string[]>={
  position:['позиция','поз','поз.','position','pos','номер позиции'],
  designation:['обозначение','designation','part number','артикул'],
  name:['наименование','название','name','description'],
  quantity:['количество','кол','кол.','qty','quantity'],
  material:['материал','material'],
  mass:['масса','масса (кг)','mass','weight'],
  note:['примечание','прим','note','comment'],
};
export function parseSpecificationCSV(content:string):SpecificationRow[]{
  if(content.length>3_000_000)throw new Error('CSV слишком большой');
  const text=content.replace(/^\uFEFF/,'');
  const headerLine=text.split(/\r?\n/,1)[0]||'';
  const delimiters=['\t',';',','];
  const separator=delimiters.map(c=>({c,count:csvCells(headerLine,c).length}))
    .sort((a,b)=>b.count-a.count)[0].c;
  const rows=csvRows(text,separator);
  if(rows.length<2)throw new Error('Нет строк спецификации');
  const heads=rows[0].map(h=>normalize(h).toLocaleLowerCase('ru-RU'));
  const positions={} as Record<keyof SpecificationRow,number>;
  for(const key of Object.keys(columnAliases) as Array<keyof SpecificationRow>){
    positions[key]=heads.findIndex(h=>columnAliases[key].includes(h));
  }
  if(positions.position<0||positions.name<0)
    throw new Error('Для спецификации обязательны столбцы «Позиция» и «Наименование»');
  if(rows.length>5001)throw new Error('Спецификация: максимум 5000 позиций');
  const parsed:SpecificationRow[]=[];
  for(let index=1;index<rows.length;index++){
    const cells=rows[index];
    const field=(key:keyof SpecificationRow)=>positions[key]<0?'':normalize(cells[positions[key]]||'').slice(0,400);
    const position=field('position'),name=field('name');
    if(!position&&!name)continue;
    if(!position||!name)throw new Error('CSV: нет позиции или наименования в строке '+(index+1));
    parsed.push({position,designation:field('designation'),name,quantity:field('quantity'),
      material:field('material'),mass:field('mass'),note:field('note')});
  }
  return parsed;
}
const normPos=(s:string)=>normalize(s).replace(/^0+(?=\d)/,'').toLocaleUpperCase('ru-RU');
export function compareSpecification(project:CadProject,rows:SpecificationRow[]):BomFinding[]{
  const seen=new Map<string,Array<{si:number;entityId:string}>>();
  for(let si=0;si<project.sheets.length;si++)for(const e of project.sheets[si].entities){
    const pos=explicitPosition(e);
    if(!pos)continue;
    const key=normPos(pos),list=seen.get(key)||[];
    list.push({si,entityId:e.id});seen.set(key,list);
  }
  const spec=new Map<string,SpecificationRow[]>();
  for(const row of rows){const key=normPos(row.position),list=spec.get(key)||[];list.push(row);spec.set(key,list);}
  const results:BomFinding[]=[];
  for(const [key,arr] of spec){
    if(arr.length>1)results.push({status:'duplicate-in-spec',position:arr[0].position,description:'Позиция повторяется в загруженной спецификации: '+arr.length});
    const actual=seen.get(key)||[];
    if(!actual.length)results.push({status:'missing-on-drawing',position:arr[0].position,description:'Позиция спецификации не найдена среди явно отмеченных позиций чертежа'});
  }
  for(const [key,arr] of seen){
    if(!spec.has(key))results.push({status:'not-in-spec',position:key,
      description:'На чертеже найдена позиция, отсутствующая в импортированной спецификации',
      sheetIndex:arr[0].si,entityId:arr[0].entityId});
    if(arr.length>1)results.push({status:'duplicate-on-drawing',position:key,
      description:'Позиция встречается на чертежах '+arr.length+' раза — может быть допустимо на разных видах',
      sheetIndex:arr[0].si,entityId:arr[0].entityId});
  }
  return results;
}
export function inventoryProject(project:CadProject):{rows:InventoryRow[];circles:CircleGroup[];counts:Record<string,number>;unverified:number}{
  const rows:InventoryRow[]=[],circles:CircleGroup[]=[],counts:Record<string,number>={};let unverified=0;
  for(let si=0;si<project.sheets.length;si++){
    const sheet=project.sheets[si],tolerance=sheet.calibrated ? 0.02 : 0.6;
    const groups:CircleGroup[]=[],circleById=new Map<string,Entity>();
    for(const e of sheet.entities){
      counts[e.kind]=(counts[e.kind]||0)+1;
      if(!e.verified)unverified++;
      const point=entityPoint(e);
      const unit=sheet.calibrated?'мм':'ед.';
      const detail=e.kind==='circle'&&e.radius!==undefined?'R '+num(e.radius)+' '+unit:
        e.kind==='line'&&e.points.length===2?'L '+num(Math.hypot(e.points[1].x-e.points[0].x,e.points[1].y-e.points[0].y))+' '+unit:
        e.text?.slice(0,150)||e.symbol||'';
      rows.push({sheetIndex:si,sheet:sheet.name,id:e.id,kind:e.kind,layer:e.layer,
        origin:e.origin,verified:e.verified,detail,location:num(point.x)+', '+num(point.y)});
      if(e.kind==='circle'&&e.radius&&e.radius>0){
        circleById.set(e.id,e);
        const diameter=e.radius*2;
        let group=groups.find(g=>Math.abs(g.diameter-diameter)<=Math.max(tolerance,diameter*.001));
        if(!group){group={sheetIndex:si,diameter,count:0,entityIds:[],unit,verified:0};groups.push(group);}
        // Different centres mean different CAD CIRCLE objects; do not call
        // them real holes or double-count duplicated same-centre hypotheses.
        const duplicates=group.entityIds.some(id=>{
          const old=circleById.get(id)!;
          const op=old.center||entityPoint(old);
          return Math.hypot(point.x-op.x,point.y-op.y)<=Math.max(tolerance,diameter*.005);
        });
        if(!duplicates){group.count++;group.entityIds.push(e.id);if(e.verified)group.verified++;}
      }
    }
    circles.push(...groups);
  }
  return {rows,circles,counts,unverified};
}
export function weldSchedule(project:CadProject):WeldGroup[]{
  const groups=new Map<string,WeldGroup>();
  for(let si=0;si<project.sheets.length;si++)for(const e of project.sheets[si].entities){
    if(!(e.kind==='eskd'&&e.symbol==='weld')&&
      !(e.kind==='leader'&&/(?:^|[^\p{L}])(?:шов|сварн)/iu.test(e.text||'')))continue;
    const designation=normalize(e.text||'Шов без обозначения').slice(0,120);
    const key=designation.toLocaleLowerCase('ru-RU');
    let g=groups.get(key);
    if(!g){g={designation,count:0,sheetIndices:[],entityIds:[],unverified:0};groups.set(key,g);}
    g.count++;g.entityIds.push(e.id);
    if(!g.sheetIndices.includes(si))g.sheetIndices.push(si);
    if(!e.verified)g.unverified++;
  }
  return [...groups.values()].sort((a,b)=>b.count-a.count).slice(0,2000);
}
export function stampText(fields:StampFields):string{
  const items:Array<[string,string]>=[
    ['Обозначение',fields.designation],['Наименование',fields.name],
    ['Изм.',fields.revision],['Лист',fields.sheet],
    ['Разработал',fields.developed],['Проверил',fields.checked],
    ['Т.контроль',fields.technicalControl],['Н.контроль',fields.normControl],
    ['Утвердил',fields.approved],['Дата',fields.date],['Предприятие',fields.company],
  ];
  return items.map(([key,value])=>key+': '+value.slice(0,180)).join('\n');
}
export function applyStampFields(project:CadProject,fields:StampFields,scope:'current'|'all',currentSheet=0):CadProject {
  const sheets=project.sheets.map((sheet,si)=>{
    if(scope==='current'&&si!==currentSheet)return sheet;
    const text=stampText({...fields,sheet:fields.sheet||(si+1).toString()});
    let modified=false;
    const entities=sheet.entities.map(e=>{
      if(e.kind!=='stamp')return e;
      modified=true;
      return {...e,text,verified:false,reason:'Штамп обновлён по предварительному просмотру; требует проверки ЕСКД'};
    });
    if(!modified){
      // Create a basic editable stamp candidate, not certified GOST title block.
      const e:Entity={id:'stamp-'+sheet.id+'-'+Date.now().toString(36),
        kind:'stamp',layer:'Текст',origin:'manual',verified:false,
        points:[{x:Math.max(0,sheet.width-195),y:Math.max(0,sheet.height-65)}],
        width:185,height:55,rows:6,cols:4,text,
        reason:'Новый текстовый штамп; не проверен на соответствие ЕСКД'};
      entities.push(e);
    }
    return {...sheet,entities};
  });
  return {...project,sheets};
}
function protectCsv(value:unknown):string {
  let text=String(value??'').replace(/\u0000/g,'');
  // Excel treats = + - @ and leading control whitespace as formula prefixes.
  if(/^[\s]*[=+\-@]/.test(text))text="'"+text;
  return '"'+text.replace(/"/g,'""')+'"';
}
export function exportTableCSV(header:string[],rows:Array<Array<string|number|boolean>>):string{
  return '\uFEFF'+[header,...rows].map(row=>row.map(protectCsv).join(';')).join('\r\n')+'\r\n';
}
export function specificationCSV(rows:SpecificationRow[]):string {
  return exportTableCSV(['Позиция','Обозначение','Наименование','Количество','Материал','Масса','Примечание'],
    rows.map(r=>[r.position,r.designation,r.name,r.quantity,r.material||'',r.mass||'',r.note||'']));
}
export function inventoryCSV(project:CadProject):string{
  const result=inventoryProject(project);
  return exportTableCSV(['Лист','ID','Тип объекта','Слой','Источник','Проверен','Параметры','Координаты'],
    result.rows.map(r=>[r.sheet,r.id,r.kind,r.layer,r.origin,r.verified?'да':'нет',r.detail,r.location]));
}
export function weldsCSV(project:CadProject):string{
  return exportTableCSV(['Обозначение шва (кандидат)','Количество обозначений','Листы','Непроверенных'],
    weldSchedule(project).map(g=>[g.designation,g.count,g.sheetIndices.map(i=>project.sheets[i].name).join(', '),g.unverified]));
}
export function findingsCSV(findings:BomFinding[]):string{
  return exportTableCSV(['Статус','Позиция','Описание','Лист','ID'],
    findings.map(f=>[f.status,f.position,f.description,f.sheetIndex??'',f.entityId||'']));
}

/** GALS file naming proposal — a local preview, NEVER native KOMPAS file modification.
 * A filename may contain a designation, separator " - " and description;
 * uncertain names must not silently populate CAD or specification metadata.
 */
export interface CadFileProposal {
  filename:string;extension:string;documentType:string;
  designation:string;name:string;status:'proposed'|'unresolved';
}
const documentTypes:Record<string,string>={
  a3d:'Сборка КОМПАС',m3d:'Деталь КОМПАС',cdw:'Чертёж КОМПАС',
  spw:'Спецификация КОМПАС',step:'STEP 3D',stp:'STEP 3D',
  sldprt:'Деталь SOLIDWORKS',sldasm:'Сборка SOLIDWORKS',
  pdf:'PDF',dxf:'DXF',dwg:'DWG (не редактируется)',
};
export function analyzeCadFilenames(names:string[]):CadFileProposal[]{
  if(names.length>4000)throw new Error('Слишком много CAD-файлов: максимум 4000');
  return names.map(raw=>{
    const filename=raw.split(/[\\/]/).pop()?.slice(0,240)||'';
    const ext=/\.([^.]+)$/.exec(filename)?.[1].toLocaleLowerCase('ru-RU')||'';
    const base=ext?filename.slice(0,-ext.length-1):filename;
    const delimiter=base.indexOf(' - ');
    const proposal=delimiter>=0?base.slice(0,delimiter).trim():'';
    const designation=/^[\p{L}\p{N}][\p{L}\p{N}._-]{4,99}$/u.test(proposal)?proposal:'';
    const name=designation?base.slice(delimiter+3).trim():base.trim();
    return {filename,extension:ext,documentType:documentTypes[ext]||'Неизвестный формат',
      designation,name:name.slice(0,180),status:designation&&name?'proposed':'unresolved'};
  });
}
export function cadFileProposalsCSV(rows:CadFileProposal[]):string{
  return exportTableCSV(['Исходный файл','Формат','Тип файла','Предложенное обозначение',
    'Предложенное наименование','Статус','Требование проверки'],
    rows.map(r=>[r.filename,r.extension,r.documentType,r.designation,r.name,
      r.status==='proposed'?'кандидат':'неразобранное имя',
      'Только предварительное предложение; свойства КОМПАС не изменялись']));
}
