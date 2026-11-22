# CadRecon W0 — базовый уровень и архитектурные решения

**Срез:** 2026-11-22, ветка `main`. **Статус: W0 в работе; не завершён для инженерной приемки.** Приоритет — accurate online DXF, затем raster. Документ обновлять по результатам GitHub Actions и независимых измерений.

## Что подготовлено

| Work package | Статус | Проверяемый артефакт |
|---|---|---|
| Зафиксировать существующий код и CI | выполнено (статический аудит) | `src/pdf.ts`, `src/model.ts`, `src/dxf.ts`, `src/geometry.ts`, `src/ocr.ts`, `backend/*`, `.github/workflows/ci.yml` |
| Synthetic reference corpus | подготовлен генератор и ground truth; результат CI уточняется | [W0 benchmark](../benchmarks/w0/README.md), [generator](../benchmarks/w0/generate_fixtures.py) |
| Diagnostics из реального UI и экспортируемого JSON | тесты добавлены, **результаты требуют завершения CI** | [Playwright W0](../e2e/w0-baseline.spec.ts) |
| Координатная модель и исходные ссылки | ADR proposed, проектное решение, **не код** | [ADR-0001](adr/0001-coordinate-and-provenance.md) |
| Privacy/security для Online Accurate | ADR proposed, **не развернутый backend** | [ADR-0002](adr/0002-online-privacy-and-security.md) |
| DXF/DWG/CDW и версии ЕСКД | ADR proposed, **не оформленные лицензии/SDK** | [ADR-0003](adr/0003-formats-eskd-and-licenses.md) |
| Real-world gold corpus и независимый sign-off | **блокер**: из текущих материалов не получены разрешенные пары native CAD ↔ PDF/scan и подтвержденные контрольные размеры | [Validation plan](VALIDATION_AND_TEST_PLAN.md) |

## Известная техническая отправная точка (на основе кода, не измерения качества)

1. **`src/pdf.ts` — сохранение форм:** `ops.curveTo` разбивается на 8 прямых на каждый Bézier-сегмент, `ops.rectangle` на четыре линии; PDF-stroke clipping/paint semantics остаются недоучтенными. Нет гарантии сохранения CIRCLE/ARC/SPLINE/RECTANGLE как одного CAD object. План W1 требует структурных metric gates.
2. **`src/pdf.ts` — масштаб:** `viewport` зависит от raster `scale`, итоговый `Sheet.width/height` в пикселях и может изменяться между файлами/режимами, отсутствует самостоятельный `paperMm/modelMm`. Для фактических размеров нужна независимая калибровка.
3. **`src/pdf.ts` — пределы:** 40 страниц, 90 MB файл, 30 000 line fragments per page; превышения не должны молча превращаться в «успешный PDF→CAD» без loss report.
4. **`src/dxf.ts` — единицы:** `$INSUNITS=4` (мм) всегда, включая некалиброванную страницу; `src/App.tsx` предупреждает о «условных единицах», но файл маркируется как миллиметровый. **Инженерный риск W1**.
5. **`src/model.ts` — статус проверки:** `entity(...,origin='manual')` по умолчанию ставит `verified=true`. Это «создано человеком», не «сверено с чертежом»: W1/W5 нужно разделить `manualCreated` и `engineerReviewed`.
6. **`src/ocr.ts` / `src/dimensions.ts` — OCR confidence:** Tesseract использует 0–100; часть downstream приводит к 0..1, но основная модель не задаёт единообразной схему. Не публиковать score без calibration.
7. **`src/vectorize.ts` — тайлы:** сканы ограничены размером/пикселями, Hough-кандидаты без полноценного graph proof; необходимы отдельные метрики missed/false joins, а не число линий в DXF.
8. **`backend/server.py` — local prototype:** не multi-tenant, лимит 35 MB/42 MP, token optional; **не является** production Online Accurate, нельзя выставлять в интернет без нового шлюза/изоляции/логирования.

## Metric baseline

Диагностические тесты измеряют только синтетические случаи:

| Case | Ground truth | Метрика | Результат |
|---|---|---|---|
| Native curves | 2 LINE + 1 RECTANGLE + 1 CIRCLE + 2 TEXT | количества форм/кривых и совпавший TEXT | Ожидает CI |
| Affine CTM | 2 LINE с известными концами в PDF pt | максимальное отклонение концов в pt | Ожидает CI |
| Clean scan | 3 прямые + 1 окружность | line fragments, circle proposals и ошибка ближайшего круга в px | Ожидает CI |
| Degraded scan | обрывки и noise | коррекция достоверности/abstention | Только генератор: измерения ещё нет |
| Real native CAD/PDF | **пары отсутствуют** | precision/recall/topology/инженерные размеры | Не измерено |
| Real RU OCR/ЕСКД | **пары отсутствуют** | CER/WER и semantic F1 | Не измерено |

**Важно:** синтетические метрики и успешный CI не означают достигнутые показатели из [плана испытаний](VALIDATION_AND_TEST_PLAN.md). Пороги W1 в нём — **предварительные целевые**, не фактические.

## W0 exit checklist — запрещено делать вид, что всё готово

- [x] Код проинвентаризирован, архитектурные риски классифицированы по W1/W2/W3/W5.
- [x] Предложена версия координат и трех ADR.
- [x] Записан генератор воспроизводимых синтетических PDF и сканов.
- [x] Записан диагностический Playwright benchmark.
- [ ] CI исполнил новый benchmark и сохранены численные результаты.
- [ ] Актуальная ADR-0001 формально подтверждена и все ключевые преобразования согласованы.
- [ ] Реальные разрешенные CAD/PDF/сканы размечены и проверены инженером.
- [ ] Закрытый sealed test разделен по проектам/организациям, определены критерии precision/recall.
- [ ] Подписана таблица рисков данных, бюджет Online Accurate и решение о размещении.
- [ ] W1 acceptance gate утвержден по реальному корпусу.

**Следующее инженерное действие после диагностики:** создать issue W1 на координатную миграцию и lossless native paths и начинать с данных, подтвержденных эталонами. Никаких функций конвертера в W0 не менять; сначала измерить. Связано с [ROADMAP](../ROADMAP.md) и [issue #2](https://github.com/kappamaag-crypto/CadRecon/issues/2).
