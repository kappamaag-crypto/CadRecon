import type {RecognitionQuality} from './recognitionQuality';

interface Props {
  quality:RecognitionQuality;
  loaded:boolean;
  busy:boolean;
  recognitionMode:'auto'|'hybrid';
  onMode:(mode:'auto'|'hybrid')=>void;
  ocrLanguages:'rus+eng'|'rus'|'eng';
  onLanguages:(v:'rus+eng'|'rus'|'eng')=>void;
  onImport:()=>void;onRecognize:()=>void;onTrace:()=>void;onOcr:()=>void;
  onReview:()=>void;onCompare:()=>void;onExport:()=>void;
  onCalibrate:()=>void;onEdit:()=>void;onStop:()=>void;onPrepareOcr:()=>void;
}
/** Recognition-first workflow, CAD drawing tools deliberately remain optional.
 * All controls invoke existing browser-only pipeline actions, never a server.
 */
export default function ReconstructionPanel({
  quality,loaded,busy,recognitionMode,onMode,ocrLanguages,onLanguages,
  onImport,onRecognize,onTrace,onOcr,onReview,onCompare,onExport,
  onCalibrate,onEdit,onStop,onPrepareOcr,
}:Props){
  const names:Record<RecognitionQuality['source'],string>={
    empty:'Лист не загружен',
    scan:'Растровый скан / изображение',
    'vector-pdf':'PDF с нативной векторной геометрией',
    'raster-pdf':'PDF без найденных нативных векторных контуров',
    'mixed-pdf':'Смешанный PDF: растр + нативные векторы',
  };
  return <div className="reconstruction-workflow">
    <h3>PDF / скан → редактируемый 2D DXF</h3>
    <p className="muted">Приоритет — точность распознавания линий, штриховых и осевых, размеров,
      текста и контуров. Без 3D, облачного распознавания и собственного сервера.</p>
    <section className="recognition-step">
      <div className="recognition-step-title"><span>1</span><strong>Исходный чертёж</strong></div>
      <p aria-label="Тип исходника">{names[quality.source]}</p>
      <button className="action" disabled={busy} onClick={onImport}>
        ＋ Загрузить PDF, TIFF, PNG или JPG</button>
      {quality.source==='mixed-pdf'&&<p className="notice">В PDF есть как векторы, так и растровые изображения.
        Не все изображённые линии обязательно представлены в PDF-геометрии.</p>}
    </section>
    <section className="recognition-step">
      <div className="recognition-step-title"><span>2</span><strong>Настроить распознавание</strong></div>
      <label className="selector-label">Режим реконструкции
        <select aria-label="Режим реконструкции" disabled={busy} value={recognitionMode}
          onChange={ev=>onMode(ev.target.value as 'auto'|'hybrid')}>
          <option value="auto">Приоритет исходных PDF-векторов; сканы обводить автоматически</option>
          <option value="hybrid">Гибридный PDF: векторы + растровая обводка + OCR</option>
        </select>
      </label>
      <label className="selector-label">Языки распознавания
        <select aria-label="Языки реконструкции" disabled={busy} value={ocrLanguages}
          onChange={ev=>onLanguages(ev.target.value as 'rus+eng'|'rus'|'eng')}>
          <option value="rus+eng">Русский + English</option>
          <option value="rus">Русский</option>
          <option value="eng">English</option>
        </select>
      </label>
      <button className="action primary recognition-primary" disabled={!loaded||busy}
        onClick={onRecognize}>◎ Точное распознавание в браузере (PDF / скан)</button>
      {busy&&<button className="action" onClick={onStop}>× Остановить обработку на устройстве</button>}
      <details open>
        <summary>Отдельные операции и сложные случаи</summary>
        <div className="stack">
          <button className="action" disabled={!loaded||busy} onClick={onTrace}>⌁ Детальная обводка (исходное разрешение)</button>
          <button className="action" disabled={!loaded||busy} onClick={onOcr}>Aa Только OCR текста</button>
          <button className="action" disabled={busy} onClick={onPrepareOcr}>↓ Подготовить языковые модели OCR (RU/EN)</button>
        </div>
        <p className="muted">Для смешанного PDF гибридный режим добавляет кандидатов поверх исходных
          векторов; совпадения и ошибочные линии требуют проверки.</p>
      </details>
    </section>
    <section className="recognition-step">
      <div className="recognition-step-title"><span>3</span><strong>Проверить восстановление</strong></div>
      <div className="recognition-stats" aria-label="Результаты распознавания">
        <div><strong>{quality.lines}</strong><small>LINE</small></div>
        <div><strong>{quality.circles}</strong><small>CIRCLE</small></div>
        <div><strong>{quality.curves}</strong><small>Контуры и кривые</small></div>
        <div><strong>{quality.texts}</strong><small>Текст</small></div>
        <div><strong>{quality.dimensions}</strong><small>Размеры</small></div>
        <div><strong>{quality.styledDashed + quality.styledCenter}</strong><small>Пунктир/оси</small></div>
      </div>
      <p className="muted">Сомнительных по чернилам: {quality.weakInk};
        сплошных линий с пробелами: {quality.brokenSolid};
        сомнительных OCR: {quality.weakOcr}.
        Эти числа — флаги проверки, не процент точности.</p>
      {quality.warnings.length>0&&<div className="reconstruction-warnings" aria-label="Замечания к распознаванию">
        {quality.warnings.slice(0,6).map((warning,i)=><p key={i}>{warning}</p>)}
      </div>}
      <button className="action" disabled={!loaded} onClick={onCompare}>◫ Сравнить до / после</button>
      <button className="action" disabled={!loaded} onClick={onReview}>✓ Проверить сомнительные объекты</button>
      <button className="action" disabled={!loaded} onClick={onCalibrate}>⊞ Калибровать по размеру</button>
      <details>
        <summary>Рекомендуемые действия по качеству</summary>
        <div className="stack">{quality.nextSteps.map((step,i)=><p className="muted" key={i}>• {step}</p>)}</div>
      </details>
    </section>
    <section className="recognition-step">
      <div className="recognition-step-title"><span>4</span><strong>Экспорт редактируемого DXF</strong></div>
      <button className="action primary" disabled={!loaded||busy} onClick={onExport}>↓ Скачать DXF (2D)</button>
      <button className="action" disabled={!loaded||busy} onClick={onEdit}>✎ Ручная коррекция CAD</button>
      <p className="muted">Результат не является автоматически проверенным чертежом:
        сравните масштабы и размерные надписи с оригиналом. Для DWG/CDW
        используйте установленную CAD-систему и законный конвертер.</p>
    </section>
  </div>;
}
