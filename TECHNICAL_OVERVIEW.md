# Техническое описание проекта Convert

> Документ для code review и анализа возможных улучшений. Описывает проект с точки зрения архитектуры, реализации и ограничений.

---

## 1. Назначение проекта

**Convert** — веб-сервис для пакетной конвертации и сжатия изображений.

**Целевая аудитория:** 2–5 коллег (внутренний инструмент).

**Сценарий использования:**
1. Пользователь открывает веб-интерфейс по ссылке (без авторизации).
2. Загружает одну или несколько фотографий (drag & drop).
3. Настраивает параметры: формат, качество, макс. размер, удаление EXIF.
4. Нажимает «Применить и обработать».
5. Следит за прогрессом обработки.
6. Скачивает результаты по одному или одним ZIP-архивом.

**Деплой:** Docker на VPS, публичный доступ по HTTPS-ссылке.

---

## 2. Стек технологий

| Слой | Технология | Версия (примерно) |
|------|------------|-------------------|
| Frontend | Vue 3 + Vite + TypeScript | Vue 3.5, Vite 6 |
| UI-библиотека | Naive UI | 2.41 |
| Backend | Fastify + TypeScript | Fastify 5 |
| Обработка изображений | sharp (libvips) | 0.33 |
| Очередь задач | p-queue | 8.x |
| ZIP-архивы | archiver | 7.x |
| Валидация файлов | file-type | 20.x |
| Планировщик очистки | node-cron | 3.x |
| ID | uuid | 11.x |
| Runtime | Node.js 22 LTS | ESM (`"type": "module"`) |
| Контейнеризация | Docker multi-stage | node:22-bookworm-slim |

**Намеренно НЕ используется:**
- Redis / BullMQ
- База данных (PostgreSQL, SQLite и т.д.)
- Авторизация (JWT, Basic Auth)
- S3 / облачное хранилище
- Отдельный Nginx-контейнер (рекомендуется Caddy на хосте)
- Тестовый фреймворк (Jest, Vitest и т.д.)

GitHub Actions собирает и проверяет Docker-образ, затем формирует архив для
администратора. Развёртывание выполняет администратор по [DEPLOY.md](DEPLOY.md).

---

## 3. Архитектура

### 3.1. Общая схема

```
┌─────────────────────────────────────────────────────────────┐
│                        Browser (Vue 3)                       │
│  DropZone → SettingsPanel → POST /api/jobs → polling status  │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTP
┌──────────────────────────▼──────────────────────────────────┐
│                   Fastify (один процесс)                       │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────┐  │
│  │ rate-limit  │  │  multipart   │  │  @fastify/static       │  │
│  └─────────────┘  └──────────────┘  │  (Vue dist в /public)  │  │
│                                      └────────────────────────┘  │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ routes/jobs.ts — API endpoints                              │ │
│  └──────────────────────────┬──────────────────────────────────┘ │
│                             │                                    │
│  ┌──────────────────────────▼──────────────────────────────────┐ │
│  │ jobStore.ts — in-memory Map + JSON на диске                  │ │
│  └──────────────────────────┬──────────────────────────────────┘ │
│                             │                                    │
│  ┌──────────────────────────▼──────────────────────────────────┐ │
│  │ p-queue (concurrency: 3) → imageProcessor.ts (sharp)        │ │
│  └──────────────────────────┬──────────────────────────────────┘ │
│                             │                                    │
│  ┌──────────────────────────▼──────────────────────────────────┐ │
│  │ Файловая система: /data/uploads, /data/converted, /data/jobs │ │
│  └──────────────────────────────────────────────────────────────┘ │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │ node-cron (каждый час) → cleanup.ts                        │ │
│  └──────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

### 3.2. Модель обработки — асинхронные jobs

Обработка **не синхронная**. Причина: пачка из 20–50 файлов может превысить HTTP timeout.

**Поток:**
1. `POST /api/jobs` — принимает multipart (файлы + JSON options), сохраняет файлы на диск, создаёт job, **сразу** возвращает `{ jobId }`.
2. Фоново `jobStore.startProcessing()` ставит задачи в `p-queue`.
3. Клиент polling'ом опрашивает `GET /api/jobs/:id` каждые 1.5 сек.
4. По готовности — скачивание через `GET /api/jobs/:id/files/:fileId` или `GET /api/jobs/:id/download` (ZIP).

### 3.3. Dev vs Production

| Режим | Frontend | Backend | API |
|-------|----------|---------|-----|
| Dev | Vite `:5173`, proxy `/api` → `:3000` | `tsx watch src/server.ts` `:3000` | Раздельно |
| Prod | Собран в `frontend/dist`, копируется в `/app/public` | `node dist/server.js` | Один порт `:3000` |

---

## 4. Структура репозитория

```
Convert/
├── backend/
│   ├── src/
│   │   ├── server.ts              # Точка входа, регистрация плагинов
│   │   ├── config.ts              # Env-переменные, пути к data/public
│   │   ├── types.ts               # TypeScript-типы, DEFAULT_OPTIONS
│   │   ├── routes/
│   │   │   └── jobs.ts            # Все API endpoints
│   │   ├── services/
│   │   │   ├── jobStore.ts        # CRUD jobs, оркестрация обработки
│   │   │   ├── imageProcessor.ts  # sharp pipeline
│   │   │   ├── queue.ts           # Singleton p-queue
│   │   │   └── cleanup.ts         # Cron-удаление старых файлов
│   │   └── utils/
│   │       ├── validateFile.ts    # Magic bytes через file-type
│   │       └── paths.ts           # sanitizeFilename, buildOutputFilename
│   ├── public/                    # Vue build (prod, в .gitignore)
│   ├── data/                      # Runtime data (в .gitignore)
│   │   ├── uploads/{jobId}/       # Исходники
│   │   ├── converted/{jobId}/     # Результаты
│   │   └── jobs/{jobId}.json      # Метаданные job
│   ├── package.json
│   └── tsconfig.json
├── frontend/
│   ├── src/
│   │   ├── main.ts                # createApp(App)
│   │   ├── App.vue                # NConfigProvider + NMessageProvider
│   │   ├── api/client.ts          # fetch-обёртки, formatBytes
│   │   ├── types.ts               # Зеркало backend-типов
│   │   └── components/
│   │       ├── AppContent.vue     # Основная логика UI
│   │       ├── DropZone.vue       # NUpload drag & drop
│   │       ├── SettingsPanel.vue  # Настройки обработки
│   │       ├── JobProgress.vue    # Прогресс-бар
│   │       └── ResultsList.vue    # Таблица результатов + скачивание
│   ├── vite.config.ts             # Proxy /api → localhost:3000
│   └── package.json
├── Dockerfile                     # 3-stage: frontend build → backend build → prod
├── docker-compose.yml
├── .env.example
├── .gitignore
├── README.md                      # Пользовательская документация
└── TECHNICAL_OVERVIEW.md          # Этот файл
```

---

## 5. API

### 5.1. Endpoints

| Метод | Путь | Описание |
|-------|------|----------|
| `POST` | `/api/jobs` | Создать job, загрузить файлы |
| `GET` | `/api/jobs/:id` | Статус и прогресс job |
| `GET` | `/api/jobs/:id/files/:fileId` | Скачать один обработанный файл |
| `GET` | `/api/jobs/:id/download` | Скачать ZIP всех готовых файлов |
| `GET` | `/api/health` | Health check `{ status: "ok" }` |

### 5.2. POST /api/jobs

**Content-Type:** `multipart/form-data`

**Поля:**
- `files` — один или несколько файлов (поле повторяется)
- `options` — JSON-строка

**Пример options:**
```json
{
  "format": "webp",
  "quality": 80,
  "maxWidth": 1920,
  "maxHeight": null,
  "stripMetadata": true
}
```

**Семантика `format`:**
- `"webp" | "jpeg" | "png" | "avif"` — конвертировать в указанный формат
- `null` — сохранить исходный формат, только сжать/resize

**Ответ (201):**
```json
{ "jobId": "uuid" }
```

**Ошибки (400):**
```json
{ "error": "описание" }
```

### 5.3. GET /api/jobs/:id

**Ответ:**
```json
{
  "id": "uuid",
  "status": "processing",
  "total": 15,
  "processed": 7,
  "files": [
    {
      "id": "uuid",
      "originalName": "photo.png",
      "sizeBefore": 2048000,
      "sizeAfter": 340000,
      "status": "done",
      "error": null
    }
  ],
  "error": null
}
```

**Статусы job:** `pending` → `processing` → `done` | `failed`

**Статусы file:** `pending` → `processing` → `done` | `failed`

**Подсчёт `processed`:** файлы со статусом `done` или `failed` (завершённые, успешно или нет).

---

## 6. Backend — детали реализации

### 6.1. server.ts

- Создаёт Fastify-приложение.
- Регистрирует `@fastify/rate-limit` (глобально на все routes).
- Регистрирует `@fastify/multipart` с лимитами fileSize и files.
- Регистрирует `jobsRoutes`.
- Если существует `config.publicDir` — регистрирует `@fastify/static` и SPA fallback (`index.html` для не-API 404).
- При старте: создаёт data-директории, загружает jobs с диска в память, запускает cron.

**bodyLimit Fastify:** `maxFileSizeMb * maxFilesPerJob` — суммарный лимит тела запроса.

### 6.2. config.ts

Все настройки из `process.env` с дефолтами:

| Переменная | Default | Описание |
|------------|---------|----------|
| `PORT` | 3000 | Порт сервера |
| `HOST` | 0.0.0.0 | Хост |
| `DATA_DIR` | `./data` (относительно backend/) | Корень данных |
| `MAX_FILE_SIZE_MB` | 50 | Макс. размер одного файла |
| `MAX_FILES_PER_JOB` | 50 | Макс. файлов за запрос |
| `QUEUE_CONCURRENCY` | 3 | Параллельных sharp-задач |
| `FILE_TTL_HOURS` | 2 | Время жизни файлов |
| `RATE_LIMIT_PER_MIN` | 30 | Запросов в минуту с IP |
| `NODE_ENV` | development | Режим |

`publicDir` = `{backendRoot}/public` — для prod static files.

### 6.3. routes/jobs.ts — приём файлов

**Важная деталь:** файлы читаются **целиком в Buffer** в память при upload:

```typescript
const chunks: Buffer[] = [];
for await (const chunk of part.file) {
  chunks.push(chunk);
}
const buffer = Buffer.concat(chunks);
```

После валидации buffer записывается на диск. Это **не потоковая** запись — для файлов до 50 МБ приемлемо, но при множестве одновременных upload'ов RAM может расти.

**parseOptions():**
```typescript
format: parsed.format !== undefined ? parsed.format : DEFAULT_OPTIONS.format
```
Используется `!== undefined`, а не `??`, чтобы корректно обрабатывать `format: null` (сохранить исходный формат). Ранее был баг с `??`, который заменял `null` на `'webp'`.

### 6.4. jobStore.ts — хранение и оркестрация

**In-memory:** `Map<string, Job>` — все активные jobs в RAM.

**Persistence:** каждое изменение job сериализуется в `{dataDir}/jobs/{jobId}.json`.

**При рестарте сервера:** `loadAllJobsFromDisk()` загружает JSON-файлы в Map, но **не возобновляет** прерванную обработку.

**startProcessing():**
1. Ставит job.status = `processing`.
2. Для каждого файла добавляет задачу в `processingQueue.add()`.
3. Внутри задачи: `processImage()` → обновление статуса файла → `persistJob()`.
4. После `processingQueue.onIdle()` — финальный статус job.

**Проблема:** `onIdle()` ждёт завершения **всех** задач в глобальной очереди, не только текущего job. Если параллельно идут 2 job, первый вызов `onIdle()` может дождаться завершения задач второго job.

**Логика финального статуса:**
- Все файлы failed → job `failed`
- Часть failed → job `done` + error message
- Все done → job `done`

### 6.5. queue.ts

Глобальный singleton:
```typescript
export const processingQueue = new PQueue({ concurrency: config.queueConcurrency });
```

Одна очередь на весь сервер. При 2–5 пользователях достаточно. Нет приоритетов, нет per-user лимитов.

### 6.6. imageProcessor.ts — sharp pipeline

**Порядок операций:**
1. `sharp(inputPath, { failOn: 'none' })` — не падать на битых/metadata
2. `.rotate()` — авто-поворот по EXIF
3. `.resize({ fit: 'inside', withoutEnlargement: true })` — если задан maxWidth/maxHeight
4. `.withMetadata()` — **только если** `stripMetadata === false`
5. Кодирование в целевой формат с quality

**resolveOutputFormat():**
- Если `options.format` задан — используется он.
- Если `null` — определяется по расширению исходного файла.
- HEIC/HEIF при сохранении формата конвертируется в JPEG (sharp не всегда умеет HEIC output).

**Именование выходного файла:** `{originalBase}-{fileId.slice(0,8)}.{ext}` — к имени добавляется суффикс, оригинальное имя частично сохраняется.

**GIF:** quality-слайдер не применяется (`.gif()` без параметров качества).

**PNG:** `compressionLevel: 9` + `quality` — оба параметра.

### 6.7. validateFile.ts

Использует `file-type` для определения MIME по magic bytes первых 4100 байт.

**Разрешённые MIME:**
- image/jpeg, image/png, image/webp, image/gif, image/avif, image/tiff, image/heic, image/heif

Не доверяет Content-Type из multipart-заголовка.

### 6.8. cleanup.ts

**Cron:** `0 * * * *` (каждый час в :00).

**Два прохода:**
1. `removeExpiredJobs()` — удаляет jobs старше `FILE_TTL_HOURS` по `createdAt`.
2. `cleanupOrphanDirs()` — удаляет orphan-директории в uploads/converted по `mtime` (на случай если job metadata потерялась).

**Не запускается при старте** — только по расписанию. Файлы могут жить до 2ч + почти 1ч после создания.

### 6.9. ZIP download

`archiver` создаёт zip on-the-fly, стримится в response через `reply.send(archive)`.

Уровень сжатия ZIP: `zlib: { level: 9 }`.

В архив попадают только файлы со статусом `done`.

---

## 7. Frontend — детали реализации

### 7.1. Структура компонентов

```
App.vue (providers)
  └── AppContent.vue (бизнес-логика)
        ├── DropZone.vue
        ├── SettingsPanel.vue
        ├── JobProgress.vue
        └── ResultsList.vue
```

`useMessage()` из Naive UI вызывается в `AppContent.vue`, который обёрнут в `NMessageProvider` в `App.vue`.

### 7.2. AppContent.vue — состояние

```typescript
const options = ref<ProcessOptions>({
  format: 'webp',       // по умолчанию конвертация в WebP
  quality: 80,
  maxWidth: null,
  maxHeight: null,
  stripMetadata: true,
});
```

**Polling:** `setInterval(poll, 1500)` — опрос статуса каждые 1.5 сек. Останавливается при `done` или `failed`. Cleanup в `onUnmounted`.

**Нет:** отмены job, повторной отправки, истории jobs, превью изображений.

### 7.3. SettingsPanel.vue — логика формата

Два способа оставить исходный формат:
1. Снять галочку «Изменить формат» → `format: null`
2. Выбрать в select «Оставить исходный» → `format: null` + галочка снимается

**Локальное состояние `local`** (reactive) дублирует часть `model` — возможна рассинхронизация при внешнем изменении model.

### 7.4. DropZone.vue

Использует `NUpload` с `:default-upload="false"` — файлы не отправляются автоматически, только собираются в список.

**Проблема:** кнопка «Очистить» сбрасывает локальный `selectedFiles`, но **не очищает** внутреннее состояние `NUpload` — UI может показывать файлы в dropzone после очистки.

### 7.5. ResultsList.vue

Таблица Naive UI `NDataTable` с колонками: имя, размер до/после, % экономии, статус, кнопка скачать.

Скачивание через `<a href="..." download>` — обычный GET без авторизации.

### 7.6. api/client.ts

Простые `fetch()` без retry, без abort controller, без progress upload.

`FormData.append('options', JSON.stringify(options))` — options как строковое поле multipart.

---

## 8. Docker

### 8.1. Dockerfile (3 stage)

1. **frontend-build** — `npm ci` + `npm run build` → `dist/`
2. **backend-build** — `npm ci` + `tsc` → `dist/`
3. **production** — `npm ci --omit=dev`, copy dist + public, `CMD node dist/server.js`

Sharp получает платформенную сборку libvips через npm. Контейнер запускается
от пользователя `node` (UID/GID 1000), доступ на запись нужен только для данных
и временного каталога. Настройки готового комплекта находятся в `deploy/`.

### 8.2. docker-compose.yml

```yaml
services:
  convert:
    build: .
    ports: ["3000:3000"]
    env_file: .env
    volumes: ["./data:/data"]
    restart: unless-stopped
```

Volume `./data:/data` — персистентное хранилище файлов и job metadata.

---

## 9. Безопасность

| Мера | Реализовано | Детали |
|------|-------------|--------|
| Авторизация | Нет | Публичный доступ по ссылке |
| Rate limiting | Да | 30 req/min/IP, глобально |
| Валидация MIME | Да | Magic bytes, не заголовок |
| Лимит размера файла | Да | 50 МБ, multipart + ручная проверка |
| Лимит кол-ва файлов | Да | 50 за job |
| Path traversal | Частично | UUID в именах на диске, `sanitizeFilename()` для originalName |
| HTTPS | Вне приложения | Caddy/Nginx на VPS |
| CORS | Не настроен явно | В prod фронт и API на одном origin |
| Заголовки безопасности | Нет | Нет helmet, CSP и т.д. |

---

## 10. Известные ограничения и технический долг

### 10.1. Память

- Upload читает каждый файл целиком в Buffer (до 50 МБ × N файлов в одном запросе).
- sharp обрабатывает с диска (хорошо), но decode всё равно использует RAM.
- Нет лимита на количество **одновременных** jobs — только concurrency sharp (3).

### 10.2. Очередь

- Глобальная `p-queue` — нет изоляции между пользователями.
- `onIdle()` в `startProcessing` привязан к глобальной очереди, не к конкретному job.
- При рестарте сервера незавершённые jobs остаются в статусе `processing` навсегда.
- Нет dead letter queue, нет retry failed файлов.

### 10.3. Хранение

- Job metadata в JSON-файлах — не масштабируется, нет индексов, нет транзакций.
- In-memory Map дублирует данные с диска.
- Нет блокировок при конкурентной записи одного job (маловероятно при 2–5 users).

### 10.4. Обработка изображений

- HEIC input → при `format: null` конвертируется в JPEG (не сохраняет HEIC).
- GIF не поддерживает quality-слайдер.
- Нет прогрессивного JPEG, нет настройки effort для AVIF/WebP.
- Нет preview/thumbnail в UI.
- Нет сравнения до/после визуально.

### 10.5. Frontend

- Нет TypeScript strict check при build (`vite build` без `vue-tsc`).
- Bundle Naive UI ~674 KB JS (без code splitting).
- Polling вместо SSE/WebSocket.

### 10.6. Тестирование

- Нет unit/integration/e2e тестов.
- Ручная проверка через node script и браузер.

### 10.7. DevOps

- Нет метрик (Prometheus и т.д.).

### 10.8. Исправленные баги и улучшения стабильности

- **`format: null` → WebP:** в `parseOptions()` оператор `??` заменял `null` на default `'webp'`. Исправлено на `!== undefined`.
- **`onIdle()` глобальной очереди:** заменён на `Promise.all` per-job; каждый job завершается независимо.
- **Restart recovery:** `recoverJobsOnStartup()` автоматически продолжает прерванные jobs.
- **Потоковый upload:** файлы пишутся на диск через stream, без `Buffer.concat`.
- **Относительные пути:** `inputRelPath` / `outputRelPath` в JSON metadata.
- **Graceful shutdown:** SIGTERM/SIGINT, 503 на новые jobs, drain queue 30s.
- **SettingsPanel:** один source of truth через `defineModel`.
- **DropZone clear:** remount через `:key`.
- **Stuck jobs UI:** предупреждение + «Начать заново» после 20 poll без прогресса.
- **Docker healthcheck** + **pino logging** в prod/dev.

---

## 11. Типы данных (shared concept)

### ProcessOptions
```typescript
interface ProcessOptions {
  format: 'webp' | 'jpeg' | 'png' | 'avif' | null;
  quality: number;          // 1-100
  maxWidth: number | null;
  maxHeight: number | null;
  stripMetadata: boolean;
}
```

### Job (backend, полный)
```typescript
interface Job {
  id: string;
  status: 'pending' | 'processing' | 'done' | 'failed';
  options: ProcessOptions;
  files: JobFile[];
  createdAt: string;  // ISO 8601
  updatedAt: string;
  error: string | null;
}
```

### JobFile (backend)
```typescript
interface JobFile {
  id: string;
  originalName: string;
  inputRelPath: string;   // "uploads/{jobId}/{fileId}-photo.png"
  outputRelPath: string | null;
  sizeBefore: number;
  sizeAfter: number | null;
  status: 'pending' | 'processing' | 'done' | 'failed';
  error: string | null;
}
```

Абсолютные пути резолвятся через `resolveDataPath()` / `toAbsoluteFromStored()` при обработке и скачивании.

---

## 12. Зависимости между модулями

```
server.ts
  ├── config.ts
  ├── routes/jobs.ts
  │     ├── config.ts
  │     ├── services/jobStore.ts
  │     │     ├── services/imageProcessor.ts
  │     │     │     └── utils/paths.ts
  │     │     └── services/queue.ts
  │     │           └── config.ts
  │     ├── utils/validateFile.ts
  │     │     └── types.ts
  │     └── types.ts
  └── services/cleanup.ts
        ├── config.ts
        └── services/jobStore.ts
```

Frontend не шарит типы с backend — `types.ts` продублирован вручную.

---

## 13. Команды разработки

```bash
# Backend dev
cd backend && npm install && npm run dev

# Frontend dev
cd frontend && npm install && npm run dev

# Backend build
cd backend && npm run build

# Frontend build
cd frontend && npm run build

# Docker prod
docker compose up -d --build
```

---

## 14. Вопросы для ревью (что можно улучшить?)

Ниже список областей, по которым интересна обратная связь:

1. **Архитектура очереди** — достаточно ли p-queue или пора BullMQ? Как правильно изолировать `onIdle` per-job?

2. **Память при upload** — стоит ли перейти на потоковую запись на диск без Buffer? Как с `@fastify/multipart`?

3. **Возобновление jobs** — как обрабатывать `processing` jobs после рестарта сервера?

4. **Безопасность** — достаточно ли мер для публичного сервиса? Нужен ли basic auth / API key?

5. **HEIC/AVIF** — корректна ли текущая логика форматов? Что с animated GIF/WebP?

6. **Frontend** — polling vs SSE/WebSocket? Стоит ли добавить upload progress?

7. **Тестирование** — какой минимальный набор тестов даст максимум пользы?

8. **Docker** — node:22-bookworm-slim vs alpine для sharp? Нужен ли multi-container (nginx + app)?

9. **Масштабирование** — что сломается первым при 20+ пользователях?

10. **UX** — preview, drag-reorder, batch presets, история обработок?

11. **Code quality** — дублирование типов, SettingsPanel state, отсутствие shared schema (zod)?

12. **Производительность sharp** — concurrency=3 оптимально для 2GB RAM VPS?

---

## 15. Критерии готовности MVP (из плана)

| Критерий | Статус |
|----------|--------|
| Загрузка 10+ файлов, PNG → WebP quality 80 | Реализовано |
| Сжатие без смены формата (format: null) | Реализовано (после фикса бага) |
| Resize по maxWidth с сохранением пропорций | Реализовано |
| ZIP-скачивание | Реализовано |
| p-queue при параллельных jobs | Реализовано (с оговоркой про onIdle) |
| Автоочистка через 2ч | Реализовано (cron каждый час) |
| docker compose up | Реализовано |
| HTTPS без логина | Зависит от VPS/Caddy, не в коде |

---

## 16. Контекст для анализа

- Проект создан с нуля как MVP за несколько дней.
- Целевая нагрузка: 2–5 коллег, не публичный массовый сервис.
- Приоритет: стабильность и простота деплоя, не enterprise-масштаб.
- Авторизация сознательно отключена — доступ по ссылке.
- Бюджет инфраструктуры: VPS ~$3–5/мес, 2GB RAM.

**Просьба к ревьюеру:** предложи конкретные улучшения с приоритетами (critical / nice-to-have / overkill для нашего масштаба). Укажи риски, которые реально проявятся при 2–5 пользователях, и те, которые станут проблемой только при росте.
