# CadRecon Advanced — локальный сервер PaddleOCR + OpenCV

Этот модуль запускается отдельно от GitHub Pages на Windows/Linux и позволяет распознавать русские инженерные подписи и мелкую геометрию в более высоком качестве.

## Установка

Python 3.10–3.12 рекомендуется (проверьте совместимость конкретной платформы и PaddlePaddle).
В отдельном виртуальном окружении из корня репозитория:

\`\`\`powershell
py -3.11 -m venv .venv
.venv\Scripts\activate
python -m pip install -U pip
# PaddlePaddle CPU/GPU — согласно https://www.paddlepaddle.org.cn/install/quick
python -m pip install paddlepaddle
python -m pip install -r backend/requirements.txt
python -m uvicorn backend.server:app --host 127.0.0.1 --port 8765
\`\`\`

При первом запуске OCR автоматически скачивает веса моделей, затем использует локальные файлы. Предусмотрен русский PP-OCRv5.

## Использование

В CadRecon: «Усиленное распознавание» → URL \`http://127.0.0.1:8765\` → кнопка отправки текущего листа. Лист передаётся только после подтверждения пользователя; третьи стороны не участвуют. Для удалённого сервера нужен HTTPS и настройка CORS через \`CADRECON_ALLOWED_ORIGINS\`.

**Не выставляйте сервис открыто в интернет без TLS и авторизации.** При удалённом размещении задайте \`CADRECON_TOKEN\` и используйте HTTPS (например, за Tailscale Serve с HTTPS или reverse proxy). При передаче на другой компьютер исходное изображение выходит за пределы браузера — это осознанный выбор пользователя.

## Ограничения

Алгоритм включает текст PaddleOCR PP-OCRv5 и LSD/Hough/OpenCV, классификацию простых контуров. Это всё ещё набор гипотез, не полноценное распознавание норм ЕСКД или гарантированная точность КМ/КМД. Корректность OCR/геометрии проверяется по чертежу. На больших сканах без GPU может потребоваться значительное время и RAM. GitHub Pages не может выполнять Python-сервер и сам по себе не активирует модели PaddleOCR.

## Тесты без скачивания моделей

\`\`\`bash
pip install -r backend/requirements-test.txt
python -m unittest discover -s backend/tests -v
\`\`\`
