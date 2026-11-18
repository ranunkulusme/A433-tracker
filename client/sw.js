/**
 * KoW Tracker - Service Worker
 * Стратегия Network-First для навигации/HTML,
 * Stale-While-Revalidate для статических ресурсов (CSS/JS/изображения),
 * сквозной пропуск API-запросов напрямую в сеть.
 */

const CACHE_NAME = 'kow-cache-v3.50.0';

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/logic.js',
  '/tma.js',
  '/smart-scanner.js',
  '/ocr.js',
  '/vendor/i18next.min.js',
  '/i18n.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

// Установка: предварительное кэширование статических ресурсов
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(async cache => {
        // Использование allSettled гарантирует, что даже при временной ошибке одного файла
        // сервис-воркер не упадет и успешно выполнит skipWaiting
        await Promise.allSettled(STATIC_ASSETS.map(asset => cache.add(asset)));
      })
      .then(() => self.skipWaiting())
  );
});

// Активация: удаление устаревших версий кэша и немедленный перехват управления клиентами
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

// Слушатель сообщений от клиента (принудительное обновление)
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Fetch: Network-First для HTML/навигации, Stale-While-Revalidate для ассетов, bypass для API и не-GET
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

  // 4. Network-First стратегия для HTML/навигации (гарантирует получение актуальной версии приложения)
  const isNavigation = request.mode === 'navigate' ||
                       url.pathname === '/' ||
                       url.pathname === '/index.html' ||
                       url.pathname.endsWith('.html');

  if (isNavigation) {
    event.respondWith(
      fetch(request)
        .then(networkResponse => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, responseClone));
          }
          return networkResponse;
        })
        .catch(async () => {
          // Fallback на кэшированную версию только при отсутствии сети
          const cached = await caches.match(request);
          if (cached) return cached;
          return caches.match('/index.html');
        })
    );
    return;
  }

  // 5. Стратегия Stale-While-Revalidate для остальных статических файлов (js, css, images)
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
        .catch(() => cachedResponse);

      // Если ресурс найден в кэше — возвращаем немедленно, обновляя в фоне
      if (cachedResponse) {
        fetchPromise.catch(() => {});
        return cachedResponse;
      }

      // Если в кэше нет — дожидаемся ответа сети
      return fetchPromise;
    })
  );
});
