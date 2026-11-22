# Сводка разработки CadRecon — W0–W8, 22 ноября 2026

> **Обновление в тот же день, после архитектурного уточнения:** CadRecon теперь **GitHub Pages + браузерные вычисления, без собственного сервера**. Прежний W2-серверный прототип в таблице ниже — **историческая реализация**, которая не является активной архитектурой. [Новые правила](STATIC_PAGES_ARCHITECTURE.md), [обновлённый ROADMAP](../ROADMAP.md), [issue #5](https://github.com/kappamaag-crypto/CadRecon/issues/5). В `main` дополнительно появились `src/browserAccurate.ts`, кнопка подготовки моделей и локальный-only Ultra.

**Репозиторий:** `kappamaag-crypto/CadRecon`, `main`. **Приоритет:** максимально точная онлайн-реконструкция; Ultra — дополнение. **Статус:** опытная система; не подтверждённая промышленная точность любого PDF/скана. Никаких «100% любого скана».

## Что реально внедрено и проверено

| Трек | Реализованный результат | Что проверено / что остаётся |
|---|---|---|
| **W0 — эталоны** | Четыре воспроизводимых синтетических PDF/PNG с SHA256 и размеченной геометрией, W0 диагностические E2E | CI и отчеты; **нет разрешенного независимого корпуса реальных CAD↔PDF/scan** |
| **W1 — native vector PDF** | Совместимый с PDF.js 5.x packed/legacy path parser, 2D линии, замкнутые контуры, окружности с проверяемым fit, cubic Bézier→редактируемый SPLINE; source ID и предупреждения | [W1 9 браузерных тестов](https://github.com/kappamaag-crypto/CadRecon/actions/runs/45012337486), независимый ezdxf; **не покрыты все clip/paint/mixed PDF и source scaling** |
| **W2 — Accurate Browser (текущий)** | Единый браузерный конвейер native PDF / scan / OCR RU-EN / dimensions / ЕСКД, устранение явных повторов, предварительная загрузка моделей; только необязательный Ultra через localhost. Старый `backend/online_server.py` — локальное наследие, не облако. | [41 unit + 14 browser — GitHub Pages pipeline](https://github.com/kappamaag-crypto/CadRecon/actions/runs/45015447436); испытания реальной OCR-точности/оффлайн-кэша ещё предстоят |
| **W3 — raster** | Дополнительная Hough-gradient circle detection в браузере, при пересечении с линиями, сохраняет unverified статус | [W0 circle 0→1; 2px центр, 0px R](https://github.com/kappamaag-crypto/CadRecon/actions/runs/45012872180), **93 line fragments, F1 неизвестен** |
| **W4 — 2D commands** | POINT/DXF POINT, прямоугольник→closed polyline, line TRIM, EXTEND, равная CHAMFER, касательное FILLET, атомарный Undo/Redo | [6 unit geometric и 2 browser E2E, всего 33+12](https://github.com/kappamaag-crypto/CadRecon/actions/runs/45013628722); **не вся номенклатура CAD** |
| **W5 — размеры** | Номинальные цепи: closure, пропуски, перекрытия, нечитаемые надписи, информативные предупреждения; без догадок/изменения размеров | [4 unit и общий CI 37+12](https://github.com/kappamaag-crypto/CadRecon/actions/runs/45013857350), **нет формально подтвержденного ЕСКД ruleset** |
| **W6 — Ultra** | `Install-CadRecon-Ultra.cmd` и PowerShell folder chooser, isolated CPU venv, token ACL, loopback API, start launcher | [Windows runner успешно: PowerShell parser, test-profile install, API health](https://github.com/kappamaag-crypto/CadRecon/actions/runs/45014077921); **не полный Paddle/GPU production installer** |
| W7 — DWG/CDW | Нативные форматы пока не пишутся | Требуются лицензированные SDK и реальный КОМПАС-3D v25 для contract tests |
| W8 — production pilot | Не развёрнут | Отсутствуют независимая инженерная приемка, реальный корпус, безопасная инфраструктура и аудит |

## Показатели синтетических W0 до/после

| Эталон | До | После | Границы измерения |
|---|---|---|---|
| `native_curves.pdf` | 2 TEXT, **0 CAD геометрии** | 2 LINE, 1 замкнутая полилиния, 1 окружность, 2 TEXT | Только 1 программно созданный PDF |
| `native_ctm.pdf` | 0/2 линии | 2/2, ошибка концов 0 PDF pt | Только контроль двух affine CTM |
| `scan_clean_300dpi.png` | 93 line fragments, 0 circles | 93 line fragments, 1 circle; центр 2px, R 0px | Не доказаны precision/recall/ошибка в миллиметрах |

Синтетика не экстраполируется на произвольные scans, размерные цепи, реальные проектные чертежи. `verified` не означает нормоконтроль. Номинал на чертеже и визуальная длина линии — не взаимозаменяемы.

## Критические незавершённые задачи (P0→P2)

1. **P0 реальный закрытый разрешённый corpus**, независимое измерение DPI/масштаба/ошибок/precision/recall, инженерный контроль (без загрузки секретной КД в публичный GitHub).
2. **P0 native PDF:** clipping/paint semantics, XObjects/optional content, кривые/штриховки/повороты, изменение единиц и CTM, безопасная миграция v1→v2.
3. **P0 scan:** сегментация слоев и граф топологии; восстановление непрерывных LINE/POLYLINE/ARC, OCR RU/EN/ESKD ансамбль с confidence, многостраничные тайлы, калибровка по независимым размерам; отказ при неопределенности.
4. **P0 online production:** независимый security review, очередь/TTL на внешнем хранилище и deletion guarantee, tenant isolation, CPU/GPU budget, регион/политика данных, TLS, наблюдаемость без содержимого КД.
5. **P1 CAD/ESKD:** robust геометрия, ручная настройка координат, полный список CAD commands, associative dims, версии ГОСТ, правила оформления/штампа и нормоконтроль; прямые CAD round-trips.
6. **P2 Ultra:** подписанный runtime bundle без зависимости от предустановленного Python, отдельная папка моделей, GPU/CPU profiles, offline weights, update/uninstall/rollback и Windows installation tests с реальными OCR моделями.
7. **P2 DWG/CDW** лицензирование SDK КОМПАС/ODA, CAD version contracts, подтверждение открытия файлов и loss reports.

## Запуск и тесты

- Quick Web: [CadRecon GitHub Pages](https://kappamaag-crypto.github.io/CadRecon/), входные файлы по умолчанию остаются в браузере (внешние OCR-модели могут загружаться из сети).
- Online Accurate pilot: [инструкция](../backend/ONLINE_PILOT.md); запуск сервера отдельно, **никакого автоматического запуска через GitHub Pages**.
- Ultra Windows: [инструкция](ULTRA_WINDOWS_INSTALLER.md), [установочный CMD](../Install-CadRecon-Ultra.cmd). CPU экспериментален; требуется Python 3.11 и интернет для моделей.
- Локальные тесты: `npm test`, `npm run build`, `npx playwright test`, `python -m unittest discover -s backend/tests -v`. Windows installer smoke в отдельном GitHub Actions.

## Source of truth

- [Подробный инженерный план](ONLINE_CAD_RECONSTRUCTION_PLAN.md), [ROADMAP](../ROADMAP.md), [эталоны/метрики](VALIDATION_AND_TEST_PLAN.md), [ADR](adr/0001-coordinate-and-provenance.md).
- Issues: [#2 master](https://github.com/kappamaag-crypto/CadRecon/issues/2), [#3 W0](https://github.com/kappamaag-crypto/CadRecon/issues/3), [#4 W1](https://github.com/kappamaag-crypto/CadRecon/issues/4), [#5 W2](https://github.com/kappamaag-crypto/CadRecon/issues/5), [#6 W3](https://github.com/kappamaag-crypto/CadRecon/issues/6), [#7 W4](https://github.com/kappamaag-crypto/CadRecon/issues/7).

**Примечание:** Скрипты Ultra на Windows проверены только на тестовом профиле без Paddle model download. Никакие коммерческие CAD SDK, закрытые пользовательские файлы, конфиденциальные данные, внешние сервисы для OCR и реальные производственные чертежи без согласия не задействовались.

## Обязательная конфигурация после уточнения архитектуры

**Публикация:** только GitHub Pages. **Вычисления:** браузер пользователя (PDF.js, Canvas, Web Worker, Tesseract.js). **Статические ML/worker пакеты:** GET-загрузка пользователем при необходимости, не отправка КД. **Память/хранилище:** локальный IndexedDB, экспортируемые JSON/DXF/ZIP. **Дополнение:** самостоятельно установленный Ultra на localhost, строго необязательно. Внешние HTTPS endpoints для OCR/отправки файлов запрещены. Полноценный офлайн-режим/ONNX/WebGPU-пакеты пока **не реализованы**.

Действующий source of truth: [STATIC_PAGES_ARCHITECTURE.md](STATIC_PAGES_ARCHITECTURE.md), [ROADMAP.md](../ROADMAP.md). Тесты отсутствия POST к OCR-серверу и запрета внешнего Ultra URL: [e2e/browser-accurate.spec.ts](../e2e/browser-accurate.spec.ts), [src/advanced.test.ts](../src/advanced.test.ts).

## Дополнение: приоритет браузера и количественные регрессии W3 (после 22.11.2026)

Актуальный [ROADMAP](../ROADMAP.md) и [архитектура GitHub Pages](STATIC_PAGES_ARCHITECTURE.md) имеют приоритет над любыми историческими рекомендациями серверных GPU.

- **Проверенный P0-фикс скана:** прежняя периодическая пиксельная выборка целиком пропускала горизонтальный и вертикальный штрихи; сначала извлекаются все границы, потом выполняется ограниченная выборка. Synthetic line-sample coverage @4px: 0/0/74,83% → **100/100/100%** на чистом; **94,7/96,03/96,03%** на деградированном скане. Окружность: центр 2px, радиус 0px. [Полный метод и ограничения](W3_RASTER_QUALITY_2026-11-22.md).
- **Остался P0-долг:** 310 candidate LINE на 3 линии+окружность — ложные/дублирующиеся кандидаты, без измеренной истинной precision/F1 реальных чертежей.
- **Только локально в браузере:** отменяемые Worker и Tesseract, ограниченные тайлы и предупреждения о downsampling; OCR больших листов фрагментирован с перекрытиями и глобальными координатами. Различные локальные этапы могут завершиться частично с явными предупреждениями; нет внешнего API.
- **Поддержка форматов:** TIFF сохраняет до 20 страниц отдельно, с предупреждением о непрочитанных; PDF ограничен 65 Мп суммарно и 22 Мп на страницу, может понизить scale ниже 1 с явным уведомлением.
- **Безопасность КД:** пользовательский JSON не может задавать URL удалённой подложки; DXF значения защищены от управляющих символов; manual/edited entities требуют подтверждения, незакалиброванные измерения не обозначаются как миллиметры.
- **Статус CI:** [первый полностью зелёный run 45017843959](https://github.com/kappamaag-crypto/CadRecon/actions/runs/45017843959) — **61 unit + 18 Playwright**, независимый разбор DXF и Python geometry tests. Реальный A0 OCR inference и независимая инженерная точность не подтверждены.

Этот отчёт — фиксация сделанной работы, **не заключение о пригодности для выпуска КМ/КМД**.

