/** Read-only quality gate for PDF/scan -> editable 2D reconstruction.
 * THESE ARE RISK FLAGS, not accuracy percentages or automatically approved
 * engineering entities. Never use this report to set verified=true.
 */
import type {Entity,Sheet} from './model';

export interface RecognitionQuality {
  source:'empty'|'scan'|'vector-pdf'|'raster-pdf'|'mixed-pdf';
  lines:number;circles:number;curves:number;texts:number;dimensions:number;
  styledDashed:number;styledCenter:number;
  unverified:number;weakInk:number;brokenSolid:number;
  weakOcr:number;missingPixels:boolean;
  warnings:string[];
  nextSteps:string[];
}
const geometry=(e:Entity)=>['line','polyline','circle','arc','bezier','ellipse'].includes(e.kind);
export function assessRecognitionQuality(sheet:Sheet):RecognitionQuality{
  const entities=sheet.entities;
  const native=entities.some(e=>e.origin==='pdf'&&geometry(e));
  const raster=sheet.sourceType==='pdf'&&
    (sheet.importWarnings||[]).some(w=>/растровых графических элементов/.test(w));
  const source:RecognitionQuality['source']=!sheet.image?'empty':
    sheet.sourceType!=='pdf'?'scan':native?(raster?'mixed-pdf':'vector-pdf'):'raster-pdf';
  const trace=entities.filter(e=>e.origin==='trace'&&e.kind==='line'&&!e.verified);
  const styledDashed=trace.filter(e=>e.lineStyle==='dashed').length;
  const styledCenter=trace.filter(e=>e.lineStyle==='center').length;
  const weakInk=trace.filter(e=>e.scanEvidence&&e.scanEvidence.inkSupport<.35).length;
  const brokenSolid=trace.filter(e=>!e.lineStyle&&e.scanEvidence&&e.scanEvidence.blankRunRatio>=.20).length;
  const texts=entities.filter(e=>e.kind==='text');
  const weakOcr=texts.filter(e=>{
    if(e.origin!=='ocr'||e.verified)return false;
    // OCR Tesseract.js now writes 0..1; older saved projects may have 0..100.
    // Comparing normalized .93 to 60 incorrectly flagged EVERY OCR line.
    const score=e.confidence===undefined?null:
      e.confidence>1?e.confidence/100:e.confidence;
    return score===null||score<.60||
      /КОНФЛИКТ OCR|ПОДОЗРЕНИЕ OCR|несовпад|ошиб|conflict/i.test(e.reason||'');
  }).length;
  const unverified=entities.filter(e=>!e.verified).length;
  const missingPixels=!!sheet.image&&
    (sheet.importWarnings||[]).some(w=>/уменьшен|уменьшена|не обработаны|НЕ обработаны|сжата с потерями|превышен лимит|часть.*не импортирована/i.test(w));
  const warnings:string[]=[],nextSteps:string[]=[];
  if(source==='empty')nextSteps.push('Загрузите PDF или PNG/TIFF/JPEG с чертежом.');
  if(source==='raster-pdf'||source==='scan')nextSteps.push('Запустите «Распознать»: обводка линий + OCR RU/EN.');
  if(source==='mixed-pdf')nextSteps.push('Выберите «Гибридный» режим: часть PDF — растр, а не нативные линии.');
  if(source==='vector-pdf')nextSteps.push('Сначала проверьте извлечённые нативные PDF-линии; сканировать их повторно не нужно.');
  if(!sheet.calibrated&&sheet.image){
    warnings.push('Масштаб не подтверждён. Координаты и значения размеров — не инженерные миллиметры.');
    nextSteps.push('Калибруйте по известному размеру и проверьте вторым независимым размером.');
  }
  if(missingPixels){
    warnings.push('В исходной подложке или импорте есть потеря данных/разрешения. Ищите исходник более высокого качества.');
    nextSteps.push('Проверьте предупреждения импорта; по возможности используйте исходный PDF или PNG/TIFF.');
  }
  const unresolved=(sheet.importWarnings||[]).filter(w=>
    /clipping|не распознана|НЕ рассчитано|Form XObject|некоррект|переполн|не импортирован|НЕ обработан/i.test(w));
  if(unresolved.length){
    warnings.push('Неполный PDF/скан: '+unresolved.length+' замечаний к импорту.');
    nextSteps.push('Сверьте сложные PDF-пути, clipping и пропуски с исходным чертежом.');
  }
  if(weakInk){
    warnings.push('Линии со слабой пиксельной опорой: '+weakInk+'. Это кандидаты, не доказанные контуры.');
    nextSteps.push('В «Проверке распознавания» сравните сомнительные линии с подложкой.');
  }
  if(brokenSolid){
    warnings.push('Сплошные кандидаты с длинными участками без чернил: '+brokenSolid+'.');
    nextSteps.push('Проверьте разрывы, тип штриховой линии и возможные ложные соединения.');
  }
  if(styledDashed||styledCenter)nextSteps.push('Подтвердите типы штриховых и осевых линий по оригиналу; это автоматические гипотезы.');
  if(weakOcr){
    warnings.push('Сомнительный OCR-текст: '+weakOcr+' элементов, особенно критичны размерные надписи.');
    nextSteps.push('Сверьте каждую размерную надпись, допуск, штамп и смешанные кириллицу/латиницу.');
  }
  if(unverified)warnings.push('Неподтверждённых объектов: '+unverified+'. Не выпускайте DXF без инженерной проверки.');
  if(sheet.image&&!nextSteps.length)nextSteps.push('Сравните геометрию с подложкой, затем экспортируйте DXF.');
  return {
    source,lines:entities.filter(e=>e.kind==='line').length,
    circles:entities.filter(e=>e.kind==='circle').length,
    curves:entities.filter(e=>['polyline','arc','ellipse','bezier'].includes(e.kind)).length,
    texts:texts.length,dimensions:entities.filter(e=>e.kind==='dimension').length,
    styledDashed,styledCenter,unverified,weakInk,brokenSolid,weakOcr,missingPixels,
    warnings,nextSteps,
  };
}
