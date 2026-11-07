# TravelHub — сценарий «Наполнение маршрута событиями»

MVP-приложение для событий поездки: CRUD, таймлайн по дням, геоточки Leaflet/OpenStreetMap, выбор места на карте, редактирование/удаление и JSON persistence.

## Запуск

Требуется Node.js 18+.

```bash
cp .env.example .env   # необязательно
npm start
```

Откройте http://localhost:3000. В текущей реализации используются только встроенные модули Node.js, поэтому `npm install` не нужен. Порт можно изменить: `PORT=4000 npm start`.

## Структура

- `server/index.js` — HTTP REST API и раздача frontend без обязательных зависимостей.
- `public/index.html`, `styles.css`, `app.js` — интерфейс, таймлайн и карта.
- `data/db.json` — демо-точки и сохраняемые события.
- `.env.example` — пример настройки; Mapbox token не требуется, карта работает на бесплатных OSM-тайлах. При переходе на Mapbox токен можно получить на https://account.mapbox.com/access-tokens/ и подключить в frontend.

## API

`GET /api/points`, `GET /api/events`, `POST /api/events`, `PUT /api/events/:id`, `DELETE /api/events/:id`, `DELETE /api/points/:id`.

Событие содержит `title`, `type`, `date`, `startTime`, `endTime`, `endDate`, `pointId`, `description`, `bookingUrl`, `materials[]`. Валидация запрещает пустую дату/время и окончание раньше начала; удаление точки автоматически обнуляет `pointId` связанных событий.

## Архитектура и trade-off

Для MVP выбран встроенный Node HTTP + JSON-файл: запуск без сборки и внешних сервисов, данные сохраняются после перезагрузки. Для production JSON следует заменить на PostgreSQL/Supabase с авторизацией и объектное хранилище для материалов. Leaflet и OpenStreetMap не требуют ключей и подходят для демо.
