# Traveler’s Glider — события и перемещения поездки

MVP-приложение для событий и перемещений поездки: CRUD, таймлайн по дням, геоточки Leaflet/OpenStreetMap, связи между точками на карте и JSON persistence.

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

`GET /api/points`, `POST /api/points`, `PUT /api/points/:id`, `DELETE /api/points/:id`, `GET /api/events`, `POST /api/events`, `PUT /api/events/:id`, `DELETE /api/events/:id`, `GET /api/transfers`, `POST /api/transfers`, `PUT /api/transfers/:id`, `DELETE /api/transfers/:id`.

Событие содержит `title`, `type`, `date`, `startTime`, `endTime`, `endDate`, `pointId`, `description`, `bookingUrl`, `materials[]`.

Перемещение содержит `fromPointId`, `toPointId`, `mode`, `date`, `startTime`, `endDate`, `endTime`, `description`. Поддерживаются способы `walking`, `car`, `train`, `plane` и `other`. Валидация запрещает одинаковые точки, неизвестные точки и окончание раньше начала; удаление точки удаляет связанные перемещения.

Точка содержит `name`, `lat`, `lng`, `description`. Её можно создать, изменить или удалить из интерфейса; координаты можно ввести вручную или выбрать кликом по карте.

## Архитектура и trade-off

Для MVP выбран встроенный Node HTTP + JSON-файл: запуск без сборки и внешних сервисов, данные сохраняются после перезагрузки. Для production JSON следует заменить на PostgreSQL/Supabase с авторизацией и объектное хранилище для материалов. Leaflet и OpenStreetMap не требуют ключей и подходят для демо.
