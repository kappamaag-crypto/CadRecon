# Локальный Ultra API — исторический экспериментальный модуль

> **Изменение архитектуры 22.11.2026:** CadRecon **не использует серверный Online Accurate**. Этот документ описывает только исторически созданный код, который можно использовать **необязательно и только как локальный Ultra на компьютере пользователя**. Основная программа — [GitHub Pages без backend](../docs/STATIC_PAGES_ARCHITECTURE.md). Никакой сервер проекта, SaaS и удалённое подключение не предусматриваются. Для пользователя актуальна [инструкция локального Ultra](../docs/ULTRA_WINDOWS_INSTALLER.md).

> **Не production SaaS.** API нужно запускать на собственной машине. GitHub Pages обслуживает только фронтенд. Нельзя публиковать этот Python-процесс непосредственно в интернет.

## Что уже работает

- `backend/online_server.py`: FastAPI, очередь в памяти, один worker (CPU/GPU определяется `backend.recognizer`), до 3 активных задач, максимум 20 записей, 25 МБ и 42 Мп на вход, поддержка только одностраничных PNG/JPEG/TIFF.
- **Fail-closed:** обязательный `CADRECON_ONLINE_TOKEN` длиной ≥24 символов, отдельный случайный секрет для каждого задания, требования `consent=true`, проверка magic bytes/размеров, CORS со списком origins.
- `POST /v1/jobs` -> `GET /v1/jobs/{id}` -> `GET /v1/jobs/{id}/result` -> `DELETE /v1/jobs/{id}`; TTL около 15 минут, **удаление по TTL происходит при следующем обращении к API**, а не по гарантированному фоновому таймеру.
- `src/online.ts` и интерфейс CadRecon: ввод URL/token без сохранения в IndexedDB, явное подтверждение передачи листа, ожидание очереди, отмена, импорт редактируемых **непроверенных** кандидатов, попытка DELETE в конце. При обрыве соединения удаление best-effort и защита зависит от серверного TTL.

Это отдельный однопользовательский пилот на существующем PaddleOCR PP-OCRv5 + OpenCV, **пока не ансамбль моделей**, не автоматическая гарантия точности любых сканов.

## Установка для локального теста Windows 11

Нужны Python 3.11 (поддержка конкретного PaddlePaddle зависит от ОС/GPU), свободное место под языковые модели. Рекомендуется сначала CPU.

```powershell
git clone https://github.com/kappamaag-crypto/CadRecon.git
cd CadRecon
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
# По инструкции PaddlePaddle для вашей ОС/CPU-GPU:
python -m pip install paddlepaddle
python -m pip install -r backend/requirements.txt
# Токен задайте самостоятельно криптографически случайной строкой, >=24 символов:
$env:CADRECON_ONLINE_TOKEN = Read-Host "Введите длинный токен"
$env:CADRECON_ONLINE_ORIGINS = "http://localhost:5173,https://kappamaag-crypto.github.io"
python -m uvicorn backend.online_server:app --host 127.0.0.1 --port 8766
```

Отдельно открыть CadRecon по `http://localhost:5173` (`npm install; npm run dev`) или штатный сайт Pages. В панели «Обработка документа» заполнить «Адрес Online Accurate» = `http://127.0.0.1:8766`, токен, затем после загрузки чертежа подтвердить передачу. **При работе с GitHub Pages через HTTPS** доступ к HTTP loopback зависит от политики браузера; проверять разрешения локальной сети. Удалённые машины/HTTPS reverse proxy в актуальной архитектуре не предусмотрены. Только localhost на устройстве пользователя.

## Автоматические проверки без загрузки тяжелых OCR-моделей

```bash
python -m pip install -r backend/requirements-test.txt
python -m unittest discover -s backend/tests -v
npm test
npm run build
npx playwright test e2e/online.spec.ts
```

Playwright использует фиктивный удалённый API, тестирует реальный браузерный UX: consent, токены, получение кандидатов, DELETE; тест **не подтверждает реальные модели OCR на сервере**.

## API и состояния

| Endpoint | Требования | Ответ |
|---|---|---|
| `GET /v1/health` | Без токена; не раскрывает КД | `ready: true/false`, profile |
| `POST /v1/jobs` | `Authorization: Bearer ...`, multipart `image`, `consent=true` | 202 `id`, `job_token`, `expires_in_seconds` |
| `GET /v1/jobs/{id}` | Bearer + `X-Job-Token` | queued/running/succeeded/failed |
| `GET /v1/jobs/{id}/result` | Bearer + `X-Job-Token` | Данные распознавания, только при succeeded |
| `DELETE /v1/jobs/{id}` | Bearer + `X-Job-Token` | Удаление записи; уже исполняющийся CPU job может физически продолжить выполнение, результат отбрасывается |

**Важные ограничения**: API предназначен исключительно для локальной установки на компьютере пользователя. Вся очередь и результаты — только в памяти процесса, после рестарта потеряются. Нет распределённой очереди, восстановлений заданий, шифрованного постоянного хранения, tenant isolation, централизованной политики удаления резервных копий, готового signed installer или встроенной проверки лицензий. На Production не запускать до устранения этих пробелов.

## Архивный W2 cloud production gate — отменён

- [ ] Независимый аудит угроз и PDF/image input processing, resource limits, DoS/malware; изоляция вычислительных workers, rate limits.
- [ ] TLS, authentication с tenant isolation, quotas, короткоживущими credentials; регламент размещения и обработки персональных/коммерческих данных.
- [ ] Надёжная внешняя очередь и durable/ephemeral encrypted storage с TTL enforcement (включая backup-delete), retry/idempotency, observability без КД.
- [ ] Streaming previews и tiles, не один большой лист; оценка стоимости CPU/GPU, benchmark PP-OCRv5 vs v6 и других моделей на разрешённом corpus.
- [ ] Доказанная частота ложноположительных критических размеров и ЕСКД, независимая инженерная приемка, возможное `abstain`.
- [ ] Многочасовые load/failure/restart/browser compatibility испытания и UX удаления/отмены.

Связано с [главным планом](../docs/ONLINE_CAD_RECONSTRUCTION_PLAN.md), [ADR privacy](../docs/adr/0002-online-privacy-and-security.md), [ROADMAP](../ROADMAP.md) и [W0](../docs/W0_BASELINE_STATUS.md).
