# CadRecon — стратегия проверки инженерной точности и выпуска

Документ требований от 2026-11-22. Никакие числовые пороги здесь не считаются достигнутыми без результатов независимых испытаний. **Скан нельзя объявить автоматически восстановленным на 100%.**

## 1. Эталонный корпус и происхождение

Создать метаданные каждого эталона: ID, разрешение на обработку, источник (vector/scanned/mixed), формат/масштаб/единицы, PDF версии/шрифты, DPI, шум, типовой лист (КМ/КМД/машиностроение), вариант штампа и ЕСКД, разрешенная передача в облако, ground-truth CAD, независимые контрольные размеры, версия разметки. Никаких чужих секретных чертежей в публичном GitHub/CI.

Страты: (1) исходно векторные CAD PDF, (2) формально векторные PDF со шрифтами-векторами SHX, (3) Form XObject/clip/transforms, (4) hybrid PDF, (5) 200/300/600 DPI сканы, (6) skew/perspective/разный X-Y масштаб, (7) слабый контраст/линии в разрывах, (8) наложение текста на геометрию, (9) отверстия/скругления/сегменты/мелкие детали, (10) размерные цепи/цепной и базовый способы, (11) русский/латиница/дроби/символы, (12) геометрические допуски/шероховатость/сварка, (13) штампы/спецификации, (14) многолистовые/большие листы, (15) поврежденные/враждебные PDF/TIFF.

Разделить train/dev/test по первоисточнику и семейству проекта, а не по тайлам. Не тренировать на sealed test. Эталоны подписывают два независимых разметчика, разногласия решает инженер. Для чертежей КОМПАС хранить исходную CDW/экспортную пару только при разрешении владельца.

## 2. Метрики и честность оценивания

- **Vector PDF:** recall/precision исходных видимых paths, топологические связности, координатная погрешность относительно PDF, корректность CTM/clip, число утраченных curves, текст/слои, visual diff после повторного рендера. *Восстановление исходной параметрической истории CAD не измеряется как «точное», если ее нет в PDF.*
- **Raster:** object precision/recall/F1 по типам, endpoint/center/radius/angle errors в мм *после независимой калибровки*, topology F1, ложные соединения, Chamfer distance; оценивать отдельно clean и degraded.
- **OCR:** CER/WER, exact-match числовых и критических знаков (Ø, ±, R, M, градусы, шероховатость), detection recall/bbox IoU, столбцы и клетки таблицы.
- **Семантика:** dimension chain closure residual, правильность привязки стрелок/выносных, дубли и пробелы позиций, correct reject/abstention для неоднозначности, нормы ruleset/версии.
- **Confidence:** калибровка вероятности (ECE/reliability), рисковые false positives, selective precision при разных уровнях coverage; не превращать процент Tesseract 0–100 в 0–1 без нормализации.
- **Производительность:** P50/P95 загрузки и обработки по форматам/страницам, peak RAM/VRAM, расходы CPU/GPU и на страницу, crash rate, cancellation recovery, скорость до принятого DXF.
- **CAD:** независимый разбор DXF, entity count, editable objects, UTF-8/Russian/Unicode, scale/units, round-trip, инвентаризация потерь, opening в AutoCAD/LibreCAD/КОМПАС v25; исходные файлы неизменны.

## 3. Предлагаемые целевые пороги для утверждения, НЕ текущие достижения

| Gate | Предварительный критерий | Условия применения |
|---|---|---|
| Native PDF P1 | >=99.5% охвата поддерживаемых видимых vector path операций на **sealed synthetic наборе**; ошибки положения P95 <= 0.10 мм в координатах листа, без существенных ошибок CTM/clip | Отдельно фиксировать не поддерживаемые виды XObject/шрифтов, круги из Bezier и потерянные CAD-связи |
| Online scan P3 | На **clean 600 DPI** target primitive F1 >=0.95, P95 метрической ошибки <=0.5 мм; сравнение с baseline обязательно | **Не распространяется** на плохие сканы; числовые цели пересмотреть после пилота и стратификации |
| Critical dimensions | >=99.5% exact-match среди **автоматически предлагаемых как высоконадежные** на оговоренном наборе; 0 случаев silent auto-approval | Recall и доля abstain публикуются рядом, высокий precision не маскирует пропуски |
| DXF export | 100% тестовых DXF проходят независимый parser/audit; нет silent-loss критических entity без предупреждения | Это критерий по выбранному тестовому набору, не гарантия для любого файла |
| User review | Все низкоконфидентные/спорные critical entities имеют source bbox, объяснение, acceptance log; user может редактировать/отклонить | Обязательный gate релиза Online Accurate |
| Privacy/Security | 0 данных чертежа в логах и CI; нет кросс-tenant доступа в тестах; TTL/delete и cancel подтверждены | Проводится security review |
| Ultra | Чистая установка CPU/GPU, выбор любого разрешенного пути, offline models, update/uninstall/rollback, localhost-only default | Windows 11 — первичный target; Linux позже по ADR |
| DWG/CDW | Проверенный round-trip не менее оговоренной версии CAD с журналом потерь и без подмены расширения | Закрытый SDK/лицензия; эта цель не блокирует выпуск DXF |

Пороги — **проектные предложения**, нуждающиеся в согласовании с инженером и ресурсами. Измеренная точность указывается **раздельно** для каждого типа PDF, DPI, языка, объекта и confidence threshold.

## 4. Набор испытаний по слоям

**Unit/property:** affine/projective transforms и обратимость, точные пересечения прямых/дуг/сплайнов, near-parallel/degenerate cases, trim/extend, offset, chamfer/fillet, rounded rectangle, snap; детерминированные undo/redo, CAD transactions; ruleset/толерансы размеров без геометрического «подгона».

**Native PDF golden:** CTM state stack, path paint/stroke/fill/clip, Bézier and compound paths, Form XObject, text glyph positions and Unicode recovery, hatch/lineweights, mixed raster/vector; независимые сравнения результатов с render source.

**Recognition integration:** тайловая обработка с overlap без потерь на границах; перестройка топологии, grouping, OCR альтернативы, ложные похожие цифры, conflict resolution; постоянные IDs и source references.

**Online/API:** MIME+magic bytes, PDF polyglot/bombs, limit page/pixels/uncompressed, malware scan, antivirus/worker sandbox, rate/tenant quotas, queue retry/idempotency, reconnect/cancel, signed URLs/TTL, storage encryption, authorization, payload race, injection, no data into traces.

**CAD E2E:** upload→preview→crop→calibrate→trace/OCR→candidate review→draw/trim/chamfer/fillet→audit→DXF→reopen in CAD→save/reopen CDW using licensed adapter; manual engineer sign-off; physical measurement with second independent size.

**Install/release:** custom path with Cyrillic/spaces, no-admin option where possible, CPU-only, supported NVIDIA GPU on driver check, model download checksum and reproducible offline bundle, uninstall without deleting user projects, rollback and health-check; browser CORS localhost/PNA and HTTPS-HTTP interactions verified on actual targets.

## 5. Матрица приемки и CI бюджет

- На каждый PR: TypeScript + Python unit, format/typing, маленькие geometric golden и DXF independent parse; быстрый browser smoke. Чрезмерно дорогие/дублирующие тесты не запускать на каждом коммите.
- Nightly: расширенная синтетика и raster regression, fuzz с ограниченным временем, edge-case реплеи; информация о регрессии с привязкой к конкретному случаю.
- Перед релизом: locked sealed test + security suite + многостраничные/большие файлы + реальные CAD-приемники/Ultra installer + инженерная выборка.
- При падении quality gate: stop rollout, feature flag off, отчет по ошибкам; никакой автоматической «поправки размера» в обход review.
- Для каждого этапа: PRD/ADR, issue, implementation checklist (после отдельного запроса), tests, benchmark report, reviewer sign-off.

Источники и требования: [план](ONLINE_CAD_RECONSTRUCTION_PLAN.md), [исследование технологий](TECHNOLOGY_EVIDENCE_2026-11-22.md), [архивы](ARCHIVE_FEATURE_AUDIT.md).
