import {describe,it,expect} from 'vitest';
import {entity,newProject,validateProject} from './model';
import {
 searchDrawings,duplicateTechnicalRequirements,parseSpecificationCSV,
 compareSpecification,inventoryProject,weldSchedule,stampText,applyStampFields,
 exportTableCSV,specificationCSV,inventoryCSV,explicitPosition,
 type SpecificationRow,type StampFields,
} from './archiveFeatures';
const e=(kind:'text'|'dimension'|'leader'|'circle'|'eskd'|'stamp',text='')=>{
 const p=entity(kind,[{x:10,y:20}],'Текст',kind==='text'?'ocr':'manual');
 p.text=text;return p;
};
const row=(position:string,name='Деталь'):SpecificationRow=>({
 position,designation:'АБВГ.100',name,quantity:'1'
});
describe('SearchTextApp-style local drawing search',()=>{
 it('finds text across sheets, respects category and case, keeps exact bbox coordinates',()=>{
  const p=newProject(),first=p.sheets[0],second={...first,id:'second',name:'Вид 2',entities:[] as typeof first.entities};
  p.sheets.push(second);
  const a=e('text','Болт М16'),b=e('leader','Поз. 12'),c=e('dimension','12');
  a.bbox={x0:11,y0:22,x1:51,y1:46};first.entities=[a,c];second.entities=[b];
  const hits=searchDrawings(p,{query:'болт',category:'text'});
  expect(hits).toHaveLength(1);
  expect(hits[0].point).toEqual({x:31,y:34});
  expect(searchDrawings(p,{query:'болт',caseSensitive:true})).toHaveLength(0);
  expect(searchDrawings(p,{query:'Поз. 12',category:'positions'})).toHaveLength(1);
  expect(searchDrawings(p,{query:'Поз. 12',allSheets:false,currentSheet:0})).toHaveLength(0);
  expect(searchDrawings(p,{query:'12',category:'dimensions'})).toHaveLength(1);
 });
 it('does not classify a plain numeric OCR dimension as position',()=>{
  expect(explicitPosition(e('text','12'))).toBeNull();
  expect(explicitPosition(e('dimension','12'))).toBeNull();
  expect(explicitPosition(e('leader','12'))).toBe('12');
  expect(explicitPosition(e('text','Поз. 12'))).toBe('12');
 });
 it('finds identical explicit technical requirements but never rewrites them',()=>{
  const p=newProject();
  p.sheets[0].entities=[
   e('text','Технические требования:\nСварные швы зачистить'),
   e('text','Технические требования:\nСварные швы зачистить'),
   e('text','Технические требования:\nНе окрашивать поверхность'),
  ];
  const groups=duplicateTechnicalRequirements(p);
  expect(groups).toHaveLength(1);
  expect(groups[0]).toHaveLength(2);
  expect(p.sheets[0].entities.every(x=>!x.verified)).toBe(true);
 });
});
describe('ГАЛС-style CSV specification and position comparison',()=>{
 it('parses real Russian semicolon CSV with quoted cells and optional columns',()=>{
  const source='\uFEFF"Позиция";"Обозначение";"Наименование";"Количество";"Масса (кг)"\r\n'
    +'"1";"A.100";"Кронштейн; левый";"2";"0,45"\r\n'
    +'"2";"A.101";"Деталь ""Б""";"1";"0,2"\r\n';
  const rows=parseSpecificationCSV(source);
  expect(rows).toHaveLength(2);
  expect(rows[0].name).toBe('Кронштейн; левый');
  expect(rows[1].name).toBe('Деталь "Б"');
  expect(rows[0].mass).toBe('0,45');
 });
 it('accepts TSV and quoted multiline descriptions, rejects absent required columns',()=>{
  expect(parseSpecificationCSV('Позиция\tНаименование\n2\tКрышка')).toHaveLength(1);
  expect(parseSpecificationCSV('Позиция;Наименование\n1;"Шов\nвнутренний"')[0].name).toBe('Шов внутренний');
  expect(()=>parseSpecificationCSV('Наименование;Количество\nДеталь;2')).toThrow(/Позиция/);
  expect(()=>parseSpecificationCSV('Позиция;Наименование\n2;')).toThrow(/наименования/);
 });
 it('compares only explicit printed positions and reports duplicates without inventing BOM quantity',()=>{
  const p=newProject();
  p.sheets[0].entities=[
   e('text','Поз. 1'),e('leader','2'),e('text','Поз. 2'),
   e('dimension','300'),e('text','500'),
  ];
  const issues=compareSpecification(p,[row('1'),row('2'),row('3'),row('3')]);
  expect(issues.map(i=>i.status)).toContain('duplicate-on-drawing');
  expect(issues.map(i=>i.status)).toContain('duplicate-in-spec');
  expect(issues.some(i=>i.status==='missing-on-drawing'&&i.position==='3')).toBe(true);
  expect(issues.some(i=>i.position==='300'||i.position==='500')).toBe(false);
 });
 it('escapes spreadsheet formulas in CSV, preserves quotes and newlines',()=>{
  const csv=exportTableCSV(['Name','Mass'],[['=HYPERLINK("http://example.com")',1],['+cmd','-2'],['@SUM(1)','safe']]);
  expect(csv).toContain('"\'=HYPERLINK(""http://example.com"")"');
  expect(csv).toContain('"\'-2"');
  expect(csv.startsWith('\uFEFF')).toBe(true);
  expect(specificationCSV([row('1')])).toContain('Наименование');
 });
 it('persists bounded specification in validated project only',()=>{
  const p=newProject();p.specification=[row('5')];
  expect(validateProject(p).specification).toHaveLength(1);
  expect(()=>validateProject({...p,specification:[{...row('1'),position:''}]})).toThrow();
 });
});
describe('ГАЛС-style inventory, weld candidates and stamp change audit',()=>{
 it('deduplicates coincident circle proposals, keeps different centers, never assumes holes',()=>{
  const p=newProject(),s=p.sheets[0];s.calibrated=true;
  const circle=(x:number,r:number)=>{
   const c=e('circle');c.center={x,y:20};c.points=[{x,y:20}];c.radius=r;return c;
  };
  s.entities=[circle(10,5),circle(10.01,5),circle(100,5),circle(190,8)];
  const result=inventoryProject(p);
  expect(result.circles).toHaveLength(2);
  expect(result.circles.find(g=>g.diameter===10)?.count).toBe(2);
  expect(result.circles.find(g=>g.diameter===16)?.count).toBe(1);
  expect(result.unverified).toBe(4);
  expect(result.circles[0].unit).toBe('мм');
  expect(inventoryCSV(p)).toContain('Координаты');
 });
 it('welds count only explicit ESKD marks and welding leaders',()=>{
  const p=newProject();const w=e('eskd','У6');w.symbol='weld';
  p.sheets[0].entities=[w,e('leader','Шов У6'),e('text','сварной стол'),e('text','Поз. 2')];
  expect(weldSchedule(p)).toHaveLength(2);
  expect(weldSchedule(p).reduce((a,g)=>a+g.count,0)).toBe(2);
 });
 it('previews and applies stamp to current or all sheets, without approvals',()=>{
  const p=newProject(),s=p.sheets[0];const old=e('stamp','Старые данные');old.verified=true;
  s.entities=[old];p.sheets.push({...s,id:'sheet2',name:'Лист 2',entities:[]});
  const fields:StampFields={
   designation:'АБВГ.100',name:'Опора',revision:'0',sheet:'',
   developed:'Инженер',checked:'',technicalControl:'',normControl:'',
   approved:'',date:'22.11.2026',company:'СПК',
  };
  expect(stampText(fields)).toContain('Разработал: Инженер');
  const current=applyStampFields(p,fields,'current',0);
  expect(current.sheets[0].entities[0].text).toContain('Опора');
  expect(current.sheets[0].entities[0].verified).toBe(false);
  expect(current.sheets[1].entities).toHaveLength(0);
  expect(p.sheets[0].entities[0].text).toBe('Старые данные');
  const all=applyStampFields(p,fields,'all');
  expect(all.sheets[1].entities).toHaveLength(1);
  expect(all.sheets[1].entities[0].text).toContain('Лист: 2');
  expect(all.sheets[1].entities[0].verified).toBe(false);
 });
});
