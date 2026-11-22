import {useMemo,useRef,useState} from 'react';
import type {CadProject} from './model';
import {
  searchDrawings,duplicateTechnicalRequirements,parseSpecificationCSV,compareSpecification,
  inventoryProject,inventoryCSV,weldSchedule,weldsCSV,findingsCSV,
  stampText,DEFAULT_STAMP,analyzeCadFilenames,cadFileProposalsCSV,type CadFileProposal,type SearchCategory,type SpecificationRow,type StampFields
} from './archiveFeatures';
import {downloadFile} from './storage';
import {projectReportXlsx,downloadReportXlsx} from './xlsxExport';
import {parseSpecificationWorkbook} from './specWorkbook';
import {auditScanGeometry,scanReviewCSV} from './scanReview';

interface Props {
  project:CadProject;
  sheetIndex:number;
  onFocus:(sheetIndex:number,entityId:string,edit?:boolean)=>void;
  onImportSpec:(rows:SpecificationRow[])=>void;
  onApplyStamp:(data:StampFields,scope:'current'|'all')=>void;
  onPackage:()=>void;
  onStatus:(message:string)=>void;
}
type Tab='search'|'inventory'|'specification'|'welds'|'stamp'|'files'|'package';
const TAB_NAMES:Record<Tab,string>={
  search:'Поиск',inventory:'Аудит объектов',specification:'Спецификация',
  welds:'Сварка',stamp:'Основная надпись',files:'Файлы КОМПАС',package:'Пакет'
};
const CATEGORY_NAMES:Record<SearchCategory,string>={
  all:'Весь текст',positions:'Позиции',dimensions:'Размеры',text:'Надписи',
  leaders:'Выноски',tables:'Таблицы',requirements:'Техтребования',
  welds:'Сварка',stamps:'Штампы'
};
const STAMP_LABELS:Record<keyof StampFields,string>={
  designation:'Обозначение',name:'Наименование',revision:'Изм.',sheet:'Лист',
  developed:'Разработал',checked:'Проверил',technicalControl:'Технический контроль',
  normControl:'Нормоконтроль',approved:'Утвердил',date:'Дата',company:'Предприятие'
};
const labelStatus:Record<string,string>={
  'missing-on-drawing':'В спецификации, не найдено на чертеже',
  'not-in-spec':'На чертеже, нет в спецификации',
  'duplicate-on-drawing':'Повтор на чертежах — проверить виды',
  'duplicate-in-spec':'Повтор в спецификации'
};
export default function ArchivePanel({project,sheetIndex,onFocus,onImportSpec,onApplyStamp,onPackage,onStatus}:Props){
  const [tab,setTab]=useState<Tab>('search');
  const [query,setQuery]=useState(''),[category,setCategory]=useState<SearchCategory>('all');
  const [caseSensitive,setCaseSensitive]=useState(false),[allSheets,setAllSheets]=useState(true);
  const [ocrTolerance,setOcrTolerance]=useState(false);
  const [showDuplicates,setShowDuplicates]=useState(false),[inventoryKind,setInventoryKind]=useState('all');
  const [showScanReview,setShowScanReview]=useState(false);
  const [stamp,setStamp]=useState<StampFields>({...DEFAULT_STAMP});
  const [scope,setScope]=useState<'current'|'all'>('current');
  const [importing,setImporting]=useState(false);
  const [fileProposals,setFileProposals]=useState<CadFileProposal[]>([]);
  const specInput=useRef<HTMLInputElement>(null),cadInput=useRef<HTMLInputElement>(null);
  const hits=useMemo(()=>searchDrawings(project,{
    query,category,caseSensitive,ocrTolerance,allSheets,currentSheet:sheetIndex,limit:250,
  }),[project,query,category,caseSensitive,ocrTolerance,allSheets,sheetIndex]);
  const duplicates=useMemo(()=>showDuplicates?duplicateTechnicalRequirements(project):[],[project,showDuplicates]);
  const inventory=useMemo(()=>inventoryProject(project),[project]);
  const scanReview=useMemo(()=>showScanReview?auditScanGeometry(project):null,[project,showScanReview]);
  const findings=useMemo(()=>compareSpecification(project,project.specification||[]),[project]);
  const welds=useMemo(()=>weldSchedule(project),[project]);
  const filteredRows=inventory.rows.filter(x=>inventoryKind==='all'||x.kind===inventoryKind);
  const types=Object.entries(inventory.counts).sort((a,b)=>b[1]-a[1]);
  const stamps=project.sheets.flatMap((s,i)=>s.entities.filter(e=>e.kind==='stamp')
    .map(e=>({si:i,id:e.id,name:s.name,text:e.text||''})));
  const exportCsv=(text:string,suffix:string)=>{
    const safe=project.name.replace(/[^\p{L}\p{N}._-]+/gu,'_').slice(0,80)||'cadrecon';
    downloadFile(text,safe+'_'+suffix+'.csv','text/csv;charset=utf-8');
    onStatus('Отчёт CSV создан локально: '+suffix);
  };
  async function importCsv(file:File|undefined){
    if(!file)return;
    setImporting(true);
    try{
      const excel=/\.(?:xlsx|xlsm)$/i.test(file.name);
      if(!excel&&file.size>3_000_000)throw new Error('CSV спецификации больше 3 МБ');
      const parsed=excel?await parseSpecificationWorkbook(file):null;
      const rows=parsed?parsed.rows:parseSpecificationCSV(await file.text());
      if(!rows.length)throw new Error('В файле нет строк спецификации');
      onImportSpec(rows);
      onStatus('Импортировано '+rows.length+' позиций из '+(excel?'Excel XLSX/XLSM':'CSV/TSV')+
        '. Только локальное чтение. '+(parsed?parsed.warnings.join(' '):'')+
        ' Сверка по явно обозначенным позициям, не по связям 3D-сборки.');
    }catch(e){onStatus('Ошибка импорта спецификации: '+String(e));}
    finally{setImporting(false);if(specInput.current)specInput.current.value='';}
  }
  const downloadExcel=()=>{
    try{
      const safe=project.name.replace(/[^\p{L}\p{N}._-]+/gu,'_').slice(0,80)||'CadRecon';
      downloadReportXlsx(projectReportXlsx(project),safe+'_инженерный_отчет.xlsx');
      onStatus('Сводный Excel XLSX сформирован локально: объекты, окружности, сварка, спецификация, расхождения.');
    }catch(e){onStatus('Экспорт XLSX: '+String(e));}
  };
  const preview=stampText(stamp);
  const isEmpty=Object.values(stamp).every(v=>!v.trim());
  return <div className="archive-tools">
    <h3>Инженерные инструменты</h3>
    <p className="muted">Идеи SearchTextApp и КОМПАС ГАЛС. Реализовано самостоятельно в браузере: EXE, VBA и сеть не используются. Результаты OCR и автоматически найденная геометрия требуют проверки.</p>
    <div className="archive-tabs" role="tablist" aria-label="Инструменты ГАЛС и поиска">
      {(Object.keys(TAB_NAMES) as Tab[]).map(key=>
        <button key={key} role="tab" aria-selected={tab===key}
          className={tab===key?'active':''} onClick={()=>setTab(key)}>{TAB_NAMES[key]}</button>)}
    </div>
    {tab==='search'&&<div className="stack">
      <label className="selector-label">Поиск текста и обозначений
        <input aria-label="Поиск по чертежам" value={query} onChange={e=>setQuery(e.target.value)}
          maxLength={300} placeholder="Например: R20, Поз. 12, шов"/>
      </label>
      <label className="selector-label">Категория
        <select aria-label="Категория поиска" value={category}
          onChange={e=>setCategory(e.target.value as SearchCategory)}>
          {(Object.keys(CATEGORY_NAMES) as SearchCategory[]).map(c=>
            <option value={c} key={c}>{CATEGORY_NAMES[c]}</option>)}
        </select>
      </label>
      <label className="check"><input type="checkbox" checked={allSheets}
        onChange={e=>setAllSheets(e.target.checked)}/> Все листы проекта</label>
      <label className="check"><input type="checkbox" checked={caseSensitive}
        onChange={e=>setCaseSensitive(e.target.checked)}/> Учитывать регистр</label>
      <label className="check"><input type="checkbox" checked={ocrTolerance}
        onChange={e=>setOcrTolerance(e.target.checked)}/> OCR-допуск: похожие латинские/кириллические буквы, пробелы в размерах (возможны ложные совпадения)</label>
      <p className="muted">Найдено: {hits.length}{hits.length===250?' (лимит выдачи; уточните поиск)':''}. Ищутся уже извлечённые PDF/OCR и введённые вручную CAD-надписи, новые сканы здесь не распознаются.</p>
      <div className="archive-result-list">
        {hits.map(h=><div className="archive-hit" key={h.sheetIndex+':'+h.entityId}>
          <strong>{h.text.slice(0,180)}</strong>
          <small>{h.sheetName} · {CATEGORY_NAMES[h.category]} · {h.origin} · {h.verified?'проверено':'НЕ проверено'}{h.approximate?' · ВОЗМОЖНОЕ OCR-СОВПАДЕНИЕ':''}</small>
          <div className="archive-actions">
            <button onClick={()=>onFocus(h.sheetIndex,h.entityId)}>◎ Показать</button>
            <button onClick={()=>onFocus(h.sheetIndex,h.entityId,true)}>⚙ Свойства</button>
          </div>
        </div>)}
      </div>
      <label className="check"><input type="checkbox" checked={showDuplicates}
        onChange={e=>setShowDuplicates(e.target.checked)}/> Поиск буквальных дублей техтребований</label>
      {showDuplicates&&<>
        <p className="muted">Групп буквальных дублей: {duplicates.length}. Похожие формулировки не объединяются автоматически.</p>
        {duplicates.slice(0,30).map((group,i)=><div className="issue warning" key={i}>
          <strong>{group.length} совпадения: {group[0].text.slice(0,150)}</strong>
          {group.map((h,j)=><button key={j} onClick={()=>onFocus(h.sheetIndex,h.entityId)}>
            {h.sheetName} · перейти</button>)}
        </div>)}
      </>}
    </div>}
    {tab==='inventory'&&<div className="stack">
      <p className="muted">Объектов: {inventory.rows.length}, непроверенных: {inventory.unverified}. Окружности — кандидаты, а не доказанные отверстия. Диаметр в мм только на калиброванных листах.</p>
      <div className="archive-stat-list">
        {types.map(([kind,count])=><button key={kind} className={inventoryKind===kind?'active':''}
          onClick={()=>setInventoryKind(inventoryKind===kind?'all':kind)}>{kind} <strong>{count}</strong></button>)}
      </div>
      <label className="selector-label">Тип объекта
        <select aria-label="Фильтр объектов" value={inventoryKind} onChange={e=>setInventoryKind(e.target.value)}>
          <option value="all">Все типы</option>{types.map(([key])=><option key={key} value={key}>{key}</option>)}
        </select>
      </label>
      <button className="action" onClick={()=>exportCsv(inventoryCSV(project),'objects')}>↓ Инвентаризация CSV</button>
      <button className="action" onClick={downloadExcel}>↓ Полный отчёт Excel XLSX</button>
      <h3>Группы одинаковых окружностей</h3>
      <p className="muted">Соседние контуры одного размера группируются для отчёта. Дубли одной окружности с одинаковым центром не считаются отдельными отверстиями.</p>
      {inventory.circles.slice(0,80).map((g,i)=><div className="archive-hit" key={i}>
        <strong>⌀ {Number(g.diameter.toFixed(3))} {g.unit} · {g.count} объектов</strong>
        <small>{project.sheets[g.sheetIndex].name} · подтверждено {g.verified} из {g.count}</small>
        {g.entityIds[0]&&<button onClick={()=>onFocus(g.sheetIndex,g.entityIds[0])}>◎ Показать</button>}
      </div>)}
      <h3>Проверка топологии W3</h3>
      <p className="muted">Диагностика растровой автообводки: близкие концы линий и слабая опора на пиксели. Никаких автоматических соединений и правок. Зазоры — в единицах листа, не в подтверждённых мм.</p>
      <button className="action" onClick={()=>setShowScanReview(v=>!v)}>{showScanReview?'Скрыть проверку W3':'⚠ W3: проверить топологию автообводки'}</button>
      {showScanReview&&scanReview&&<>
        <p className="muted">Исследовано отрезков: {scanReview.examinedLines}. Возможных разрывов: {scanReview.nearGaps}. Слабо подтверждённых штрихов: {scanReview.weakInk}. Длинных белых участков: {scanReview.longGaps}. {scanReview.truncated?'Часть результатов ограничена для защиты браузера.':''}</p>
        <button className="action" onClick={()=>exportCsv(scanReviewCSV(scanReview),'w3_scan_review')}>↓ Диагностика W3 CSV</button>
        {scanReview.findings.slice(0,100).map((f,i)=><div key={i} className="archive-hit">
          <strong>{f.kind==='near-gap'?'Возможный разрыв':f.kind==='long-gap'?'Длинный белый участок':'Слабое подтверждение'}</strong>
          <small>{f.sheetName} · {f.description}</small>
          <button onClick={()=>onFocus(f.sheetIndex,f.entityId)}>◎ Показать</button>
          {f.relatedEntityId&&<button onClick={()=>onFocus(f.sheetIndex,f.relatedEntityId!)}>◎ Второй отрезок</button>}
        </div>)}
        {scanReview.findings.length>100&&<p className="muted">Показаны первые 100 результатов; сохраните CSV для полного списка.</p>}
      </>}
      <h3>Реестр объектов</h3>
      <p className="muted">Показаны первые 100; полный перечень доступен в CSV.</p>
      {filteredRows.slice(0,100).map(e=><div key={e.id} className="archive-hit">
        <strong>{e.kind} · {e.detail.slice(0,110)}</strong>
        <small>{e.sheet} · {e.layer} · {e.origin} · {e.verified?'проверен':'не проверен'}</small>
        <button onClick={()=>onFocus(e.sheetIndex,e.id)}>◎ Показать</button>
      </div>)}
    </div>}
    {tab==='specification'&&<div className="stack">
      <p className="muted">Сопоставляются ТОЛЬКО явно обозначенные «Поз. 12» и числа в CAD-выносках. Это не нативная связь с 3D-сборкой. Количество деталей по одному PDF не восстанавливается автоматически.</p>
      <input hidden ref={specInput} type="file" accept=".csv,.tsv,.txt,.xlsx,.xlsm,text/csv,text/plain"
        onChange={e=>{void importCsv(e.currentTarget.files?.[0]);}}/>
      <button className="action" disabled={importing} onClick={()=>specInput.current?.click()}>↑ Импорт CSV / TSV / Excel XLSX / XLSM</button>
      <button onClick={()=>exportCsv(
        '\uFEFF"Позиция";"Обозначение";"Наименование";"Количество";"Материал";"Масса";"Примечание"\r\n"1";"АБВГ.100";"Деталь";"2";"Сталь";"0,5";""\r\n','spec_template')}>↓ Скачать образец CSV</button>
      <p className="muted">XLSX/XLSM читаются только как таблица: макросы и формулы НЕ запускаются. XLS старого бинарного формата не поддерживается.</p>
      <p className="muted">Загружено позиций: {project.specification?.length||0}. Требуются столбцы «Позиция», «Наименование»; дополнительные — «Обозначение», «Количество», «Материал», «Масса», «Примечание».</p>
      {!!project.specification?.length&&<>
        <button className="action" onClick={()=>exportCsv(findingsCSV(findings),'bom_audit')}>↓ Отчёт расхождений CSV</button>
        <p className="muted">Расхождений/предупреждений: {findings.length}. Повтор позиции на разных видах может быть допустим.</p>
        {findings.slice(0,100).map((f,i)=><div className="issue warning" key={i}>
          <strong>{labelStatus[f.status]} · {f.position}</strong>
          <p>{f.description}</p>
          {f.sheetIndex!==undefined&&f.entityId&&<button onClick={()=>onFocus(f.sheetIndex!,f.entityId!)}>◎ Показать</button>}
        </div>)}
        {findings.length===0&&<p className="notice">Совпадение номеров позиций не подтверждает корректность количества, материала или геометрии.</p>}
      </>}
    </div>}
    {tab==='welds'&&<div className="stack">
      <p className="muted">Группировка ТОЛЬКО явно отмеченных знаков сварки ЕСКД и выносок со словом «шов»/«сварн». Стандарт, тип сварного соединения, длина и число мест не выводятся по непроверенному тексту.</p>
      <button className="action" onClick={()=>exportCsv(weldsCSV(project),'weld_schedule')}>↓ Ведомость обозначений сварки CSV</button>
      <p>Групп обозначений: {welds.length}; всего отметок {welds.reduce((n,g)=>n+g.count,0)}</p>
      {welds.slice(0,100).map((g,i)=><div className="archive-hit" key={i}>
        <strong>{g.designation}</strong>
        <small>Отметок: {g.count} · непроверенных: {g.unverified} · листы: {g.sheetIndices.map(idx=>project.sheets[idx].name).join(', ')}</small>
        <button onClick={()=>{const idx=g.sheetIndices[0];const id=g.entityIds[0];if(idx!==undefined&&id)onFocus(idx,id);}}>◎ Показать</button>
      </div>)}
      {welds.length===0&&<p className="muted">Явно помеченные сварные обозначения пока не найдены.</p>}
    </div>}
    {tab==='stamp'&&<div className="stack">
      <p className="muted">Штамп — текстовый CAD-кандидат без подтверждённой привязки к форме ГОСТ. Все изменения показываются заранее и записываются одной отменяемой операцией.</p>
      {(Object.keys(STAMP_LABELS) as Array<keyof StampFields>).map(key=>
        <label key={key} className="selector-label">{STAMP_LABELS[key]}
          <input maxLength={180} value={stamp[key]} onChange={e=>setStamp(prev=>({...prev,[key]:e.target.value}))}/>
        </label>)}
      <label className="selector-label">К каким листам применить
        <select aria-label="Область заполнения штампа" value={scope}
          onChange={e=>setScope(e.target.value as 'current'|'all')}>
          <option value="current">Только текущий лист</option>
          <option value="all">Все листы проекта</option>
        </select>
      </label>
      <h3>Предпросмотр изменения</h3>
      <p className="muted">Существующие штампы в выбранной области будут заменены новым текстом. Если штампа нет, создастся новый. Исходное содержимое сохраняется в Undo/резервной копии.</p>
      <pre className="archive-preview">{preview}</pre>
      {stamps.filter(x=>scope==='all'||x.si===sheetIndex).slice(0,5).map(x=><details key={x.id}>
        <summary>До: {x.name}</summary><pre className="archive-preview">{x.text}</pre>
      </details>)}
      <button className="action" disabled={isEmpty} onClick={()=>{
        if(window.confirm('Подтвердить изменение текстовых штампов ('+(scope==='all'?'все листы':'текущий лист')+')? Проверка ЕСКД обязательна.'))
          onApplyStamp(stamp,scope);
      }}>✓ Применить после просмотра</button>
    </div>}
    {tab==='files'&&<div className="stack">
      <p className="muted">Пакетный разбор имен по принципу ГАЛС: «Обозначение - Наименование». Пользователь самостоятельно выбирает файлы. Содержимое файлов КОМПАС, STEP и SOLIDWORKS НЕ читается и НЕ изменяется.</p>
      <input ref={cadInput} hidden type="file" multiple
        accept=".a3d,.m3d,.cdw,.spw,.step,.stp,.sldprt,.sldasm,.pdf,.dxf,.dwg"
        onChange={e=>{
          try{
            const picked=Array.from(e.currentTarget.files||[]).map(f=>f.webkitRelativePath||f.name);
            setFileProposals(analyzeCadFilenames(picked));
            onStatus('Разобрано имён файлов: '+picked.length+'. Это только предложения, не изменения нативных документов.');
          }catch(err){onStatus('Импорт списка файлов: '+String(err));}
          if(cadInput.current)cadInput.current.value='';
        }}/>
      <button className="action" onClick={()=>cadInput.current?.click()}>↑ Выбрать файлы CAD для анализа имен</button>
      <p className="muted">Кандидатов: {fileProposals.filter(x=>x.status==='proposed').length},
      неразобранных: {fileProposals.filter(x=>x.status==='unresolved').length},
      всего: {fileProposals.length}. Ни один файл не был открыт или отправлен.</p>
      <button disabled={!fileProposals.length} className="action"
        onClick={()=>exportCsv(cadFileProposalsCSV(fileProposals),'cad_filenames')}>↓ Предложения по свойствам CSV</button>
      {fileProposals.slice(0,100).map((f,i)=><div key={i} className="archive-hit">
        <strong>{f.filename}</strong>
        <small>{f.documentType} · {f.status==='proposed'?'предложено':'не разобрано'}</small>
        <span>Обозначение: {f.designation||'не определено'}</span>
        <span>Наименование: {f.name||'не определено'}</span>
      </div>)}
      <p className="notice">Это не пакетное изменение свойств КОМПАС-3D. Для записи в A3D/M3D/CDW необходим установленный КОМПАС-3D, совместимый лицензированный SDK и отдельный локальный коннектор.</p>
    </div>}
    {tab==='package'&&<div className="stack">
      <p className="muted">Локальный ZIP-пакет проекта: DXF по листам, результаты анализа, CSV-ведомости, данные спецификации и README с предупреждениями. Не отправляет чертежи на сервер.</p>
      <button className="action" onClick={downloadExcel}>↓ Сводный отчёт Excel XLSX</button>
      <button className="action" onClick={onPackage}>↓ Скачать пакет проекта ZIP</button>
      <p className="muted">В архивах не создаются и не изменяются исходные файлы КОМПАС-3D, STEP и SOLIDWORKS. Их можно связать отдельно через локальный лицензионный SDK.</p>
    </div>}
  </div>;
}
