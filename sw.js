/**
 * KoW Tracker - Service Worker
 * Кэширование статической оболочки (App Shell) по стратегии Stale-While-Revalidate,
 * сквозной пропуск API-запросов напрямую в сеть.
 */

const CACHE_NAME = 'kow-cache-v3.19.0';

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/logic.js',
  '/ocr.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

// Установка: предварительное кэширование статических ресурсов
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Активация: удаление устаревших версий кэша и перехват управления клиентами
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      ))
      .then(() => self.clients.claim())
  );
});

// Fetch: Stale-While-Revalidate для статических ресурсов, bypass для API и не-GET
self.addEventListener('fetch', event => {
  const request = event.request;

  // 1. Игнорировать запросы с методами, отличными от GET
  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);

  // 2. Игнорировать запросы к sw.js и API — пропускать прямо в сеть без кэширования
  if (url.pathname === '/sw.js' || url.pathname.startsWith('/api/')) {
    return;
  }

  // 3. Обрабатывать только запросы текущего origin
  if (url.origin !== self.location.origin) {
    return;
  }

  // 4. Стратегия Stale-While-Revalidate для статических файлов
  event.respondWith(
    caches.open(CACHE_NAME).then(async cache => {
      const cachedResponse = await cache.match(request);

      const fetchPromise = fetch(request)
        .then(networkResponse => {
          if (networkResponse && networkResponse.status === 200) {
            cache.put(request, networkResponse.clone());
          }
          return networkResponse;
        })
        .catch(async err => {
          // При недоступности сети для навигационных запросов (страниц) отдавать fallback index.html
          if (request.mode === 'navigate') {
            const fallback = await cache.match('/index.html');
            if (fallback) {
              return fallback;
            }
          }
          throw err;
        });

      // Если ресурс найден в кэше — возвращаем немедленно, обновляя в фоне
      if (cachedResponse) {
        fetchPromise.catch(() => {});
        return cachedResponse;
      }

      // Если в кэше нет — дожидаемся ответа сети или fallback
      return fetchPromise;
    })
  );
});
