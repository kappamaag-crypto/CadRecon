# Roadmap CadRecon

## Фактический статус реализации (22.11.2026)

**Source of truth:** [сводка W0–W8 и доказательства CI](docs/IMPLEMENTATION_STATUS_2026-11-22.md). Это текущий статус, разделы с фразами «не реализовано» выше — **историческая редакция плана на момент его подготовки**.

| Трек | Статус | Объективный результат | Открытая задача |
|---|---|---|---|
| W0 | частично | 4 синтетических goldens, baseline, ADR (proposed) | [#3](https://github.com/kappamaag-crypto/CadRecon/issues/3) — разрешённые реальные CAD/PDF/сканы |
| **W1** | частично, геометрический дефект исправлен | Native paths & Bezier editable SPLINE; 2/2 lines CTM, 0 PDF pt в synthetic; независимый DXF parser | [#4](https://github.com/kappamaag-crypto/CadRecon/issues/4) — clip/paint/XObjects и реальные goldens |
| **W2** | pilot, production не готов | Токен+consent+очередь+delete и UI Online Accurate | [#5](https://github.com/kappamaag-crypto/CadRecon/issues/5) — multi-tenant, security, storage, models |
| **W3** | частично | Synthetic scan circle 0→1, центр 2px, радиус 0px; 93 line fragments пока без topology merge | [#6](https://github.com/kappamaag-crypto/CadRecon/issues/6) |
| W4 | частично | Point, rectangle, line trim/extend/chamfer/fillet, atomic Undo; 33 unit+12 E2E | [#7](https://github.com/kappamaag-crypto/CadRecon/issues/7) — полный CAD |
| W5 | частично | Audit closure/gaps/unknown nominal chains, 37 unit+12 E2E | [#8](https://github.com/kappamaag-crypto/CadRecon/issues/8) — подтверждённый ЕСКД ruleset |
| W6 | экспериментальный CPU bootstrap | Windows path chooser + installer/start scripts, Windows syntax+test-install health CI | [#9](https://github.com/kappamaag-crypto/CadRecon/issues/9) — bundled Python/GPU/offline/rollback |
| W7 | запланирован | Только открытый DXF сейчас | Договор/лицензия ODA/КОМПАС и нативные contract tests |
| W8 | запланирован | CI для синтетических примеров | Реальный пилот и инженерная приёмка |

**Главное правило релиза:** пользовательский CAD требует проверки геометрии и независимых размеров. Успешный CI и синтетические графики не равны 100% точности скана. Внешние OCR API и DWG/CDW adapters не включаются без законных оснований, проверенной приватности и лицензий.


## Трек точной реконструкции

Главный документ: [план онлайн-реконструкции 2D CAD](docs/ONLINE_CAD_RECONSTRUCTION_PLAN.md). Трекер: [issue #2](https://github.com/kappamaag-crypto/CadRecon/issues/2).

Приоритет — online accurate: сначала нативные векторные PDF, затем сканы с явной достоверностью и обязательным ревью. Локальный Ultra, CAD-редактор, ЕСКД/размеры и DWG/CDW адаптеры идут по этапам плана.

## Принципы

- Для произвольного скана не обещается 100% автоматическая точность.
- DXF — первичный открытый формат; DWG/CDW требуют лицензированного совместимого адаптера.
- Распознанное остаётся кандидатом до проверки инженером.
- Данные не передаются внешнему сервису без явного согласия.

## Ближайшая последовательность

1. Утвердить эталоны, метрики, безопасность и форматные ADR.
2. Выпустить онлайн-конвейер и проверяемый импорт векторных PDF.
3. Усилить сканы, затем CAD-операции и ЕСКД-контроль.
4. Выпустить Ultra-установщик; затем форматные адаптеры и пилот.


## Реестр инженерных требований — дополнение 2026-11-22

**Что изменилось:** подтвержден приоритет высокоточной **онлайн**-версии. Никаких функций в этом обновлении не реализовано. Вспомогательные документы:

- [Расширенный технический план — 2026-11-22](docs/ONLINE_CAD_RECONSTRUCTION_PLAN.md#дополнение-2026-11-22--инженерная-спецификация-online-first).
- [Разбор «КОМПАС ГАЛС» и SearchTextApp](docs/ARCHIVE_FEATURE_AUDIT.md) — функции, ограничения, предложения.
- [Проверка Werk24, DrawScan AI, CADSoftTools, Digi-Keys, i2PDF, Linnk AI, iLovePDF и OCR/CAD SDK](docs/TECHNOLOGY_EVIDENCE_2026-11-22.md).
- [Метрики, эталоны, тесты и quality gates](docs/VALIDATION_AND_TEST_PLAN.md).
- [Issue #2 — общий инженерный трек](https://github.com/kappamaag-crypto/CadRecon/issues/2) и [issue #1 — существующие ошибки/пробелы ЕСКД](https://github.com/kappamaag-crypto/CadRecon/issues/1).

### Приоритетный backlog (всё ниже — `planned`)

| Порядок | Epic | Приоритет | Зависимости | Gate |
|---|---|---|---|---|
| W0 | Корпус эталонов, source mm model, baseline, ADR privacy / licenses / ЕСКД | P0 | — | измеряемые критерии, права на эталоны |
| W1 | Точная векторная PDF→CAD reconstruction (paths/curves/text/transforms/semantics) | **P0, первый инженерный результат** | W0 | независимый DXF parser + CAD визуальный и геометрический эталон |
| W2 | Online Accurate API, очередь, потоковый UI, security/privacy, ревью | **P0, обязательный онлайн-релиз** | W0/W1 | E2E + security + стоимость |
| W3 | Сканы: multiscale tiling, OCR v5/v6/JS PoC, geometry graph, confidence/abstain | **P0, ключевой прирост точности** | W0/W2 | стратифицированные метрики, меньше опасных FP |
| W4 | Полный 2D CAD: POINT/RECTANGLE/ARC/SPLINE; TRIM/EXTEND, CHAMFER, FILLET, OFFSET, преобразования, snaps, Undo | P1 | W0 | геометрические property/E2E |
| W5 | Размерные цепи/ЕСКД/штампы + отчеты, объектный и текстовый поиск, сварные обозначения | P1 | W0/W3/W4 | versioned ruleset, инженерный sign-off |
| W6 | Ultra Local Windows installer: папка установки, CPU/GPU, offline, signed update | P2 | W2/W3 | install/uninstall/rollback/security |
| W7 | DWG и КОМПАС-3D v25 CDW adapters, лицензия и контроль потерь | P2 | W4/W6 | договоренность SDK и CAD round-trip |
| W8 | Пилот, контроль качества, оптимизация затрат и релиз | P2 | W1–W7 по нужным сценариям | quality report + rollback |

**Product rule:** W6/W7 не блокируют выпуск Online Accurate + DXF. Не обещать 100% точности любого скана или автоматического восстановления исходных CAD-связей из PDF. Каждую wave вести отдельной issue/PR в фазе **реализации**, по нынешнему запросу мы обновляем только план и issue #2.


## W0 фактическое выполнение (22.11.2026)

**Статус: частично выполнено, не закрыт.** Заведена отдельная [issue #3 — W0 Corpus/ADR/Baseline](https://github.com/kappamaag-crypto/CadRecon/issues/3), главный эпик [#2](https://github.com/kappamaag-crypto/CadRecon/issues/2).

- [x] Аудит исходного кода `main`, три предложенных ADR о координатах, online security, форматах/ЕСКД.
- [x] Воспроизводимый генератор четырёх синтетических PDF/PNG-эталонов и Playwright diagnostic baseline.
- [x] [Документ W0 baseline/status](docs/W0_BASELINE_STATUS.md) и [тестовый корпус](benchmarks/w0/README.md).
- [x] Диагностический CI baseline пройден и записан: [run 45010047191 — 7 passed](https://github.com/kappamaag-crypto/CadRecon/actions/runs/45010047191). **Native geometry: 0 линий** на обоих PDF-кейсах, растровый чистый эталон: 93 фрагмента и 0 окружностей — см. [числовой отчет](docs/W0_BASELINE_STATUS.md).
- [ ] Разрешенные реальные пары CAD↔PDF/скан, независимые контрольные размеры и инженерная разметка.
- [ ] ADR formally accepted, измеренный quality gate перед W1.

**W1 P0:** [issue #4 — вернуть PDF paths](https://github.com/kappamaag-crypto/CadRecon/issues/4) основана на воспроизводимой регрессии: native PDF хранит текст, но теряет линии. Сначала исправить детектор PDF paths и зафиксировать lossless geometry gate. **W1 разрешен как следующий этап разработки после W0 review, но не как подтвержденный «accurate release».** Не считать W0 выполненным без реального корпуса/метрик. W0 не менял OCR/CAD алгоритмы; выполнено только точечное исправление сбоя импорта (FileList) для тестируемости.
