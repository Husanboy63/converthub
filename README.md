# Оптимизация изображений

Веб-сервис для конвертации и сжатия изображений. Загрузите пачку фото, настройте формат/качество/размер и скачайте результат (по одному или ZIP-архивом).

## Стек

- **Frontend:** Vue 3 + Vite + TypeScript + Naive UI
- **Backend:** Fastify + TypeScript + sharp
- **Очередь:** p-queue (concurrency: 3)
- **Деплой:** Docker

## Локальная разработка

### Требования

- Node.js 22 LTS
- npm

### Backend

```bash
cd backend
npm install
cp ../.env.example ../.env
npm run dev
```

Сервер запустится на `http://localhost:3000`.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Интерфейс откроется на `http://localhost:5173` (прокси `/api` → backend).

## Docker (продакшн)

Для передачи готового Docker-образа администратору и размещения в Proxmox
см. [DEPLOY.md](DEPLOY.md). Workflow GitHub Actions собирает Linux/amd64-образ,
проверяет конвертацию и формирует комплект с инструкцией.

Для сборки из исходников на Linux:

```bash
cp .env.example .env
sudo install -d -o 1000 -g 1000 -m 0750 data
docker compose up -d --build
```

Приложение будет доступно на `http://localhost:3000`.

## API

| Метод | Путь | Описание |
|-------|------|----------|
| POST | `/api/jobs` | Загрузка файлов + настройки |
| GET | `/api/jobs/:id` | Статус задачи |
| GET | `/api/jobs/:id/files/:fileId` | Скачать один файл |
| GET | `/api/jobs/:id/download` | Скачать ZIP |
| GET | `/api/health` | Health check |

### Настройки обработки (поле `options` в multipart)

```json
{
  "format": "webp",
  "quality": 80,
  "maxWidth": 1920,
  "maxHeight": null,
  "stripMetadata": true
}
```

`format: null` — сохранить исходный формат, только сжать/изменить размер.

## Переменные окружения

| Переменная | По умолчанию | Описание |
|------------|--------------|----------|
| `PORT` | 3000 | Порт сервера |
| `DATA_DIR` | `./data` | Папка для файлов |
| `MAX_FILE_SIZE_MB` | 50 | Макс. размер одного файла |
| `MAX_FILES_PER_JOB` | 50 | Макс. файлов за раз |
| `QUEUE_CONCURRENCY` | 3 | Параллельных задач sharp |
| `FILE_TTL_HOURS` | 2 | Время хранения файлов |
| `RATE_LIMIT_PER_MIN` | 30 | Лимит запросов с IP |

## Деплой на VPS

### 1. Подготовка сервера

Установите Docker Engine и Compose по
[официальной инструкции](https://docs.docker.com/engine/install/).

### 2. Загрузить проект и запустить

```bash
git clone <your-repo> convert
cd convert
cp .env.example .env
sudo install -d -o 1000 -g 1000 -m 0750 data
docker compose up -d --build
```

### 3. HTTPS через Caddy (рекомендуется)

Установите [Caddy](https://caddyserver.com/) и создайте `/etc/caddy/Caddyfile`:

```
your-domain.com {
    reverse_proxy localhost:3000
}
```

```bash
sudo systemctl reload caddy
```

Caddy автоматически получит SSL-сертификат от Let's Encrypt.

### Рекомендуемые характеристики VPS

- 2 GB RAM, 1 vCPU
- 20+ GB диск
- Ubuntu 22.04+

## Безопасность

- Доступ по ссылке без авторизации
- Rate limit: 30 запросов/мин с IP
- Валидация файлов по magic bytes
- Автоудаление файлов через 2 часа

При необходимости позже можно добавить HTTP Basic Auth или IP whitelist.
