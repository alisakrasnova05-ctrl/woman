const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { AsyncLocalStorage } = require('async_hooks');
const tripContext = new AsyncLocalStorage();

const PORT = Number(process.env.PORT || 3000);
const DB = path.join(__dirname, '..', 'data', 'db.json');
const PUBLIC = path.join(__dirname, '..', 'public');
const UPLOADS = path.join(__dirname, '..', 'data', 'uploads');
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const TRANSFER_MODES = new Set(['walking', 'car', 'train', 'plane', 'other']);

function readDb() {
  const data = JSON.parse(fs.readFileSync(DB, 'utf8'));
  const result = {
    trips: Array.isArray(data.trips) ? data.trips : [],
    attractions: data.attractions || [],
    points: Array.isArray(data.points) ? data.points : [],
    events: Array.isArray(data.events) ? data.events : [],
    transfers: Array.isArray(data.transfers) ? data.transfers : [],
  };
  const tripId = tripContext.getStore();
  if (tripId) for (const key of ['points','events','transfers']) result[key] = result[key].filter(x => (x.tripId || 'legacy') === tripId);
  return result;
}

function writeDb(data) {
  const tripId = tripContext.getStore();
  if (tripId) {
    const full = JSON.parse(fs.readFileSync(DB, 'utf8'));
    for (const key of ['points','events','transfers']) data[key] = [...(full[key] || []).filter(x => (x.tripId || 'legacy') !== tripId), ...data[key].map(x => ({...x, tripId}))];
  }
  fs.writeFileSync(DB, JSON.stringify(data, null, 2));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) reject(new Error('Размер запроса слишком большой'));
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('Некорректный JSON'));
      }
    });
  });
}

function readRequestBuffer(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      if (!tooLarge) chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) {
        const error = new Error('Общий размер загружаемых фотографий не должен превышать 20 МБ');
        error.statusCode = 413;
        return reject(error);
      }
      resolve(Buffer.concat(chunks));
    });
    req.on('error', reject);
  });
}

function parseMultipartFiles(buffer, contentType) {
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundaryMatch) throw new Error('Не удалось прочитать загруженные файлы');

  const boundary = Buffer.from(`--${(boundaryMatch[1] || boundaryMatch[2]).trim()}`);
  const separator = Buffer.from('\r\n\r\n');
  const files = [];
  let cursor = buffer.indexOf(boundary);

  while (cursor !== -1) {
    cursor += boundary.length;
    if (buffer.subarray(cursor, cursor + 2).toString() === '--') break;
    if (buffer.subarray(cursor, cursor + 2).toString() === '\r\n') cursor += 2;

    const headerEnd = buffer.indexOf(separator, cursor);
    if (headerEnd === -1) break;
    const headers = buffer.subarray(cursor, headerEnd).toString('utf8');
    const nextBoundary = buffer.indexOf(boundary, headerEnd + separator.length);
    if (nextBoundary === -1) break;

    const contentEnd = Math.max(headerEnd + separator.length, nextBoundary - 2);
    const content = buffer.subarray(headerEnd + separator.length, contentEnd);
    const disposition = headers.match(/content-disposition:\s*form-data;([^\r\n]+)/i)?.[1] || '';
    const fieldName = disposition.match(/(?:^|;)\s*name="([^"]+)"/i)?.[1];
    const filename = disposition.match(/(?:^|;)\s*filename="([^"]*)"/i)?.[1];
    if (fieldName === 'photos' && filename) {
      const mimeType = (headers.match(/content-type:\s*([^\r\n]+)/i)?.[1] || '').trim().toLowerCase();
      files.push({ mimeType, content });
    }
    cursor = nextBoundary;
  }

  return files;
}

function imageExtension(file) {
  const jpeg = file.content.length >= 3
    && file.content[0] === 0xff
    && file.content[1] === 0xd8
    && file.content[2] === 0xff;
  const png = file.content.length >= 8
    && file.content.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (jpeg && ['image/jpeg', 'image/jpg', 'image/pjpeg'].includes(file.mimeType)) return '.jpg';
  if (png && file.mimeType === 'image/png') return '.png';
  return null;
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(data === undefined ? '' : JSON.stringify(data));
}

function sendNoContent(res) {
  res.writeHead(204);
  res.end();
}

function id(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function isVisibleOnDate(item, date) {
  return item.date === date || (item.endDate && item.date < date && item.endDate >= date);
}

function validateEvent(body) {
  const errors = [];
  if (!body.title?.trim()) errors.push('Название обязательно');
  if (!body.date) errors.push('Дата обязательна');
  if (!body.startTime) errors.push('Время начала обязательно');
  if (body.endDate && body.endDate < body.date) errors.push('Дата окончания не может быть раньше даты начала');
  if ((body.endDate || body.date) === body.date && body.endTime && body.endTime < body.startTime) {
    errors.push('Время окончания не может быть раньше начала');
  }
  return errors;
}

function validatePoint(body) {
  const errors = [];
  if (!body.name?.trim()) errors.push('Название точки обязательно');
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) errors.push('Широта должна быть от -90 до 90');
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) errors.push('Долгота должна быть от -180 до 180');
  return errors;
}

function validateTransfer(body, db) {
  const errors = [];
  if (!body.fromPointId) errors.push('Начальная точка обязательна');
  if (!body.toPointId) errors.push('Конечная точка обязательна');
  if (body.fromPointId && body.toPointId && body.fromPointId === body.toPointId) {
    errors.push('Начальная и конечная точки должны различаться');
  }
  if (body.fromPointId && !db.points.some((point) => point.id === body.fromPointId)) {
    errors.push('Начальная точка не найдена');
  }
  if (body.toPointId && !db.points.some((point) => point.id === body.toPointId)) {
    errors.push('Конечная точка не найдена');
  }
  if (!TRANSFER_MODES.has(body.mode)) errors.push('Выберите способ передвижения');
  if (!body.date) errors.push('Дата отправления обязательна');
  if (!body.startTime) errors.push('Время отправления обязательно');
  if (!body.endTime) errors.push('Время прибытия обязательно');
  if (body.endDate && body.endDate < body.date) errors.push('Дата прибытия не может быть раньше даты отправления');
  if ((body.endDate || body.date) === body.date && body.endTime && body.endTime < body.startTime) {
    errors.push('Время прибытия не может быть раньше отправления');
  }
  return errors;
}

function findItem(collection, itemId) {
  return collection.findIndex((item) => item.id === itemId);
}

function withUtc(b){const out={...b}; out.startAt=new Date(`${out.date}T${out.startTime}`).toISOString(); if(out.endTime){const endDate=out.endDate||out.date; out.endAt=new Date(`${endDate}T${out.endTime}`).toISOString();}else delete out.endAt; return out}

async function geocoding(endpoint) {
  const response = await fetch('https://geocoding-api.open-meteo.com/v1/' + endpoint, {signal:AbortSignal.timeout(6000)});
  if (!response.ok) throw Error('Сервис поиска городов недоступен');
  return response.json();
}
function cityRecord(city) {
  return {id:city.id,name:city.name,country:city.country,admin1:city.admin1,latitude:city.latitude,longitude:city.longitude,timezone:city.timezone};
}
function isCity(city) { return /^PPL/.test(city.feature_code || ''); }

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;
  tripContext.enterWith(parsed.query.tripId || null);
  const pointMatch = pathname.match(/^\/api\/points\/([^/]+)$/);

  try {
    if (req.method === 'GET' && pathname === '/api/cities') {
      const name = String(parsed.query.name || '').trim();
      if(name.length < 2) return sendJson(res,200,[]);
      const result = await geocoding('search?' + new URLSearchParams({name,count:'20',language:'ru',format:'json'}));
      return sendJson(res,200,(result.results || []).filter(isCity).slice(0,8).map(cityRecord));
    }
    if (req.method === 'GET' && pathname === '/api/trips') {
      const db = readDb();
      return sendJson(res, 200, db.trips.map((trip) => ({
        ...trip,
        pointsCount: db.points.filter((p) => (p.tripId || 'legacy') === trip.id).length,
        eventsCount: db.events.filter((e) => (e.tripId || 'legacy') === trip.id).length,
        days: trip.startDate && trip.endDate ? Math.max(1, Math.round((new Date(trip.endDate)-new Date(trip.startDate))/86400000)+1) : 0,
      })));
    }
    const daySaveMatch = pathname.match(/^\/api\/trips\/([^/]+)\/day-events$/);
    if (daySaveMatch && req.method === 'PUT') {
      const body = await parseBody(req), db = readDb(), tripId = decodeURIComponent(daySaveMatch[1]);
      const trip = db.trips.find(t => t.id === tripId);
      if (!trip) return sendJson(res,404,{error:'Путешествие не найдено'});
      if (!Array.isArray(body.events) || body.events.length>200) return sendJson(res,400,{error:'Допустимо до 200 событий'});
      const prepared = [];
      for (const entry of body.events) {
        if(!entry || typeof entry!=='object')return sendJson(res,400,{error:'Некорректное событие'});
        const errors = validateEvent(entry);
        if(typeof entry.dayNoteId!=='string'||!entry.dayNoteId) errors.push('Не указан идентификатор черновика');
        if(!['excursion','stay','restaurant','meeting','other'].includes(entry.type))errors.push('Некорректный тип события');
        if(!/^\d{4}-\d{2}-\d{2}$/.test(entry.date||'') || !/^([01]\d|2[0-3]):[0-5]\d$/.test(entry.startTime||'')) errors.push('Некорректные дата или время');
        if (!entry.title?.trim() || !entry.startTime || !entry.date) errors.push('Заполните название, дату и время начала каждого события');
        if (entry.pointId && !db.points.some(p=>p.id===entry.pointId && (p.tripId||'legacy')===tripId)) errors.push('Точка не принадлежит поездке');
        if (errors.length) return sendJson(res,400,{errors});
        let event;try {event=withUtc(entry);} catch {return sendJson(res,400,{error:'Некорректные дата или время'});}
        const existing=db.events.find(e=>e.dayNoteId===entry.dayNoteId && e.source==='day-notes' && e.tripId===tripId);
        prepared.push({...event,id:existing?.id||id('e'),tripId,source:'day-notes',dayNoteId:String(entry.dayNoteId),createdAt:existing?.createdAt||new Date().toISOString()});
      }
      if(new Set(prepared.map(e=>e.dayNoteId)).size!==prepared.length) return sendJson(res,400,{error:'Повторяющиеся события в черновике'});
      db.events=db.events.filter(e=>!(e.source==='day-notes' && e.tripId===tripId));
      db.events.push(...prepared);writeDb(db);return sendJson(res,200,{events:prepared});
    }
    const tripMatch = pathname.match(/^\/api\/trips\/([^/]+)$/);
    if (req.method === 'DELETE' && tripMatch) {
      const db = readDb();
      const tripId = decodeURIComponent(tripMatch[1]);
      const tripIndex = db.trips.findIndex((trip) => trip.id === tripId);
      if (tripIndex < 0) return sendJson(res, 404, { error: 'Путешествие не найдено' });

      db.trips.splice(tripIndex, 1);
      db.points = db.points.filter((item) => (item.tripId || 'legacy') !== tripId);
      db.events = db.events.filter((item) => (item.tripId || 'legacy') !== tripId);
      db.transfers = db.transfers.filter((item) => (item.tripId || 'legacy') !== tripId);
      writeDb(db);
      return sendJson(res, 200, { id: tripId, deleted: true });
    }
    if (req.method === 'PATCH' && tripMatch) {
      const body = await parseBody(req);
      const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
      const clearing = body.startDate === null && body.endDate === null;
      if (!clearing && (!validDate(body.startDate) || !validDate(body.endDate) || body.endDate < body.startDate)) return sendJson(res,400,{errors:['Выберите корректный диапазон дат']});
      const db = readDb(), trip = db.trips.find(t => t.id === tripMatch[1]);
      if(!trip) return sendJson(res,404,{error:'Путешествие не найдено'});
      if(clearing) Object.assign(trip,{startDate:null,endDate:null});
      else Object.assign(trip,{startDate:body.startDate,endDate:body.endDate,month:Number(body.startDate.slice(5,7)),year:Number(body.startDate.slice(0,4))});
      writeDb(db); return sendJson(res,200,trip);
    }
    if (req.method === 'POST' && pathname === '/api/trips') {
      const body = await parseBody(req);
      if (!body.destination?.trim()) return sendJson(res, 400, { errors: ['Укажите место назначения'] });
      const currentYear = new Date().getFullYear();
      if (!Number.isInteger(Number(body.month)) || Number(body.month)<1 || Number(body.month)>12 || !Number.isInteger(Number(body.year)) || Number(body.year)<currentYear || Number(body.year)>currentYear+5) return sendJson(res,400,{errors:['Выберите доступные месяц и год']});
      let city = null;
      if (body.city?.id) {
        const found = await geocoding('get?' + new URLSearchParams({id:body.city.id,language:'ru'}));
        if(!isCity(found)) return sendJson(res,400,{errors:['Выберите город из списка']});
        city = cityRecord(found);
      } else if (body.cityFallback !== true) return sendJson(res,400,{errors:['Выберите город из списка']});
      const startDate = `${body.year}-${String(Number(body.month)).padStart(2, '0')}-01`;
      const end = new Date(`${startDate}T00:00:00`); end.setDate(end.getDate() + 3);
      const item = { id: id('trip'), title: city?.name || body.destination.trim(), destination: city?.name || body.destination.trim(), city, month: Number(body.month), year: Number(body.year), startDate, endDate: `${end.getFullYear()}-${String(end.getMonth()+1).padStart(2,'0')}-${String(end.getDate()).padStart(2,'0')}`, createdAt: new Date().toISOString() };
      const db = readDb(); db.trips.push(item); writeDb(db); return sendJson(res, 201, item);
    }
    if (req.method === 'POST' && pathname === '/api/uploads') {
      const body = await readRequestBuffer(req, MAX_UPLOAD_BYTES);
      const files = parseMultipartFiles(body, req.headers['content-type'] || '');
      if (!files.length) return sendJson(res, 400, { error: 'Выберите фотографии JPG или PNG' });
      if (files.length > 10) return sendJson(res, 400, { error: 'За один раз можно загрузить не больше 10 фотографий' });

      for (const file of files) {
        if (file.content.length > MAX_IMAGE_BYTES) {
          return sendJson(res, 413, { error: 'Размер одной фотографии не должен превышать 10 МБ' });
        }
        if (!imageExtension(file)) {
          return sendJson(res, 400, { error: 'Поддерживаются только изображения JPG и PNG' });
        }
      }

      fs.mkdirSync(UPLOADS, { recursive: true });
      const uploaded = files.map((file) => {
        const filename = `${id('photo')}${imageExtension(file)}`;
        fs.writeFileSync(path.join(UPLOADS, filename), file.content, { flag: 'wx' });
        return { url: `/uploads/${filename}` };
      });
      return sendJson(res, 201, uploaded);
    }

    const uploadMatch = pathname.match(/^\/uploads\/([A-Za-z0-9_-]+\.(?:jpg|png))$/);
    if (req.method === 'GET' && uploadMatch) {
      const filePath = path.join(UPLOADS, uploadMatch[1]);
      if (!fs.existsSync(filePath)) return sendJson(res, 404, { error: 'Фото не найдено' });
      const contentType = filePath.endsWith('.png') ? 'image/png' : 'image/jpeg';
      res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=31536000, immutable' });
      return fs.createReadStream(filePath).pipe(res);
    }

    if (req.method === 'GET' && pathname === '/api/points') {
      return sendJson(res, 200, readDb().points);
    }

    if (req.method === 'POST' && pathname === '/api/points') {
      const body = await parseBody(req);
      const errors = validatePoint(body);
      if (errors.length) return sendJson(res, 400, { errors });
      const db = readDb();
      const item = {
        id: id('p'),
        name: body.name.trim(),
        lat: Number(body.lat),
        lng: Number(body.lng),
        description: body.description?.trim() || '',
      };
      db.points.push(item);
      writeDb(db);
      return sendJson(res, 201, item);
    }

    if (pointMatch && req.method === 'PUT') {
      const body = await parseBody(req);
      const errors = validatePoint(body);
      if (errors.length) return sendJson(res, 400, { errors });
      const db = readDb();
      const index = findItem(db.points, pointMatch[1]);
      if (index < 0) return sendJson(res, 404, { error: 'Точка не найдена' });
      db.points[index] = {
        ...db.points[index],
        name: body.name.trim(),
        lat: Number(body.lat),
        lng: Number(body.lng),
        description: body.description?.trim() || '',
        id: pointMatch[1],
      };
      writeDb(db);
      return sendJson(res, 200, db.points[index]);
    }

    if (req.method === 'GET' && (pathname === '/api/events' || pathname === '/api/transfers')) {
      const db = readDb();
      const key = pathname === '/api/events' ? 'events' : 'transfers';
      const items = parsed.query.date
        ? db[key].filter((item) => isVisibleOnDate(item, parsed.query.date))
        : db[key];
      return sendJson(res, 200, items);
    }

    if (req.method === 'POST' && pathname === '/api/events') {
      const body = await parseBody(req);
      const errors = validateEvent(body);
      if (errors.length) return sendJson(res, 400, { errors });
      const db = readDb();
      const item = { ...withUtc(body), id: id('e'), createdAt: new Date().toISOString() };
      db.events.push(item);
      writeDb(db);
      return sendJson(res, 201, item);
    }

    const eventMatch = pathname.match(/^\/api\/events\/([^/]+)$/);
    if (eventMatch && req.method === 'PUT') {
      const body = await parseBody(req);
      const errors = validateEvent(body);
      if (errors.length) return sendJson(res, 400, { errors });
      const db = readDb();
      const index = findItem(db.events, eventMatch[1]);
      if (index < 0) return sendJson(res, 404, { error: 'Событие не найдено' });
      db.events[index] = { ...db.events[index], ...withUtc(body), id: eventMatch[1] };
      writeDb(db);
      return sendJson(res, 200, db.events[index]);
    }

    if (eventMatch && req.method === 'DELETE') {
      const db = readDb();
      db.events = db.events.filter((item) => item.id !== eventMatch[1]);
      writeDb(db);
      return sendNoContent(res);
    }

    if (req.method === 'POST' && pathname === '/api/transfers') {
      const body = await parseBody(req);
      const db = readDb();
      const errors = validateTransfer(body, db);
      if (errors.length) return sendJson(res, 400, { errors });
      const item = {
        ...body,
        endDate: body.endDate || body.date,
        id: id('t'),
        createdAt: new Date().toISOString(),
      };
      db.transfers.push(item);
      writeDb(db);
      return sendJson(res, 201, item);
    }

    const transferMatch = pathname.match(/^\/api\/transfers\/([^/]+)$/);
    if (transferMatch && req.method === 'PUT') {
      const body = await parseBody(req);
      const db = readDb();
      const errors = validateTransfer(body, db);
      if (errors.length) return sendJson(res, 400, { errors });
      const index = findItem(db.transfers, transferMatch[1]);
      if (index < 0) return sendJson(res, 404, { error: 'Перемещение не найдено' });
      db.transfers[index] = {
        ...db.transfers[index],
        ...body,
        endDate: body.endDate || body.date,
        id: transferMatch[1],
      };
      writeDb(db);
      return sendJson(res, 200, db.transfers[index]);
    }

    if (transferMatch && req.method === 'DELETE') {
      const db = readDb();
      db.transfers = db.transfers.filter((item) => item.id !== transferMatch[1]);
      writeDb(db);
      return sendNoContent(res);
    }

    if (pointMatch && req.method === 'DELETE') {
      const db = readDb();
      db.points = db.points.filter((point) => point.id !== pointMatch[1]);
      db.events = db.events.map((event) => (
        event.pointId === pointMatch[1] ? { ...event, pointId: null } : event
      ));
      db.transfers = db.transfers.filter(
        (transfer) => transfer.fromPointId !== pointMatch[1] && transfer.toPointId !== pointMatch[1]
      );
      writeDb(db);
      return sendNoContent(res);
    }

    if (req.method === 'GET') {
      const requestedPath = pathname === '/'
        ? '/home.html'
        : pathname === '/trip'
          ? '/index.html'
          : pathname === '/planner'
            ? '/planner.html'
            : pathname;
      const filePath = path.resolve(PUBLIC, `.${requestedPath}`);
      if (filePath.startsWith(`${PUBLIC}${path.sep}`) && fs.existsSync(filePath)) {
        const extension = path.extname(filePath);
        res.writeHead(200, { 'Content-Type': MIME_TYPES[extension] || 'application/octet-stream' });
        return fs.createReadStream(filePath).pipe(res);
      }
    }

    return sendJson(res, 404, { error: 'Not found' });
  } catch (error) {
    return sendJson(res, error.statusCode || 500, { error: error.message });
  }
});

server.listen(PORT, () => console.log(`Traveler’s Glider: http://localhost:${PORT}`));
