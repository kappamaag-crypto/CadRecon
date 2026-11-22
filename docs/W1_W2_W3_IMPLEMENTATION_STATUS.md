# Отчёт о реализации W1 / W2-pilot / W3 — 22.11.2026

Статус: **частично реализовано и автоматически проверено на синтетике**. Репозиторий `kappamaag-crypto/CadRecon`, `main`. Не является инженерной приемкой любых реальных КМ/КМД, не обещает 100% точность.

## Проверенные изменения

| Область | До (W0) | После | Объективный источник |
|---|---|---|---|
| Native PDF (2 LINE, 1 RECT, 1 circle in Bezier, 2 TEXT) | 2 TEXT, 0 геометрических объектов | 2 LINE, 1 closed LWPOLYLINE, 1 CIRCLE, 2 TEXT | [W1 strict + baseline CI](https://github.com/kappamaag-crypto/CadRecon/actions/runs/45012337486) |
| PDF с q/cm/Q CTM, 2 линии | 0/2 линии | 2/2 линии, endpoint error=0 PDF pt на синтетическом образце | тот же CI; [W0 gold generator](../benchmarks/w0/generate_fixtures.py) |
| Cubic Bézier | 8 отрезков на кривую или отсутствует | отдельный `bezier` entity + DXF `SPLINE` (4 CP, 8 knots) | [независимый ezdxf audit](https://github.com/kappamaag-crypto/CadRecon/actions/runs/45012631233) |
| DXF `$INSUNITS` | всегда 4 (мм) | 0 для некалиброванных листов, 4 после явной калибровки | DXF header test + independent parser |
| Raster PNG (3 линии + 1 пересеченная окружность) | 93 фрагмента, 0 кругов | 93 фрагмента, 1 круг R=80 px, центр отклонен на 2 px, R ошибка 0 px | [W3 browser test](https://github.com/kappamaag-crypto/CadRecon/actions/runs/45012872180) |
| W2 online pilot | отсутствовал | separate FastAPI queue with consent, scoped job capability token, delete; browser UI opt-in | [backend and browser CI](https://github.com/kappamaag-crypto/CadRecon/actions/runs/45013151402) — 27 unit + 10 Playwright |

**Границы утверждений:** `93 фрагмента` не означает 93 true-positive линии; precision/recall неизвестны. Нельзя приравнивать 0 ошибки на идеальном PDF к точности реального скана. Ошибка скана пока в **пикселях**, миллиметры требуют независимой калибровки и 2+ размеров.

## Код

- [PDF.js packed DrawOPS + backward compatibility](../src/pdfPaths.ts), [strict tests](../src/pdfPaths.test.ts), [browser W1 tests](../e2e/w1-native-paths.spec.ts).
- [Отображение Bezier](../src/render.ts), [указание единиц и DXF spline](../src/dxf.ts), [model и audit warnings](../src/model.ts), [index по импортированным PDF путям](../src/pdf.ts).
- [Gradient circle detector](../src/circleDetector.ts), [worker](../src/trace.worker.ts), [tests](../src/circleDetector.test.ts).
- [Online pilot backend](../backend/online_server.py), [API tests](../backend/tests/test_online_server.py), [клиент](../src/online.ts), [E2E тест](../e2e/online.spec.ts), [инструкция](../backend/ONLINE_PILOT.md).

## Открытые требования и блокеры

- **W1:** не гарантирована корректность всех clipping, transparency, Form XObjects, текстовых матриц, SHX/Type3, hidden/unpainted paths и mixed PDF; нет замкнутого набора разрешенных реальных CAD/PDF. См. [#4](https://github.com/kappamaag-crypto/CadRecon/issues/4).
- **W2:** тестирование демо-сервера ≠ production cloud. Нет tenant isolation, долговременной очереди, надежного TTL purge, encryption/storage contract, модельного ансамбля, потоковых тайлов. Прототип не выставлять напрямую в интернет.
- **W3:** ограниченные Hough и sampling, фрагментация линий, неполная семантика размерных линий/стрелок и ЕСКД, нет измеренных OCR CER/WER на реальном наборе.
- **Критично:** manual-created objects ранее получали `verified=true`, но это не инженерное утверждение; W4/W5 следует разделить `createdByUser` и `engineerApproved`. Возможная проблема округления/effective mm scale для mixed PDF требует regression.
- **DWG/CDW:** не создаются нативно; только DXF, дальнейшее через легальный SDK/КОМПАС connector по отдельному этапу.

## Следующие quality gates

1. Сформировать минимум пилотный корпус разрешённых реальных чертежей разных классов (не публиковать закрытую КД), незалежную разметку и независимый контроль размеров.
2. Проверить происхождение PDF paths, paint/style/clip, multipage scale; раскрывать unsupported operations/невидимую геометрию без ложного «полностью конвертировано».
3. Для скана — line merging topology, на реальных датасетах доказать фокус на предотвращении опасных ложных соединений и размеров.
4. Для online — валидировать безопасность/локальные сети, model benchmark и подготовить production architecture, не выдавая pilot за SaaS.
5. Начать W4 point/rectangle/trim/extend/fillet/chamfer с численными инвариантами и E2E тестами, затем ЕСКД profile.

См. [основной инженерный план](ONLINE_CAD_RECONSTRUCTION_PLAN.md), [ROADMAP](../ROADMAP.md), [W0 исходные измерения](W0_BASELINE_STATUS.md), [валидация](VALIDATION_AND_TEST_PLAN.md).
