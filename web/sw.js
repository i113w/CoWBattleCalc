const CACHE_NAME = 'cow-calc-v1.0';

// 需要缓存的文件列表
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './manifest.json',
  './js/pwa.js',
  './js/main.js',
  './js/engine.js',
  './js/gui.js',
  './js/i18n.js',
  './data/examples.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  // 外部资源建议也缓存，或者下载到本地引用
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css' 
];

// 1. 安装阶段：下载并缓存所有资源
self.addEventListener('install', (e) => {
  console.log('[SW] Installing...');
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting(); // 强制立即激活新 SW
});

// 2. 激活阶段：清理旧版本缓存
self.addEventListener('activate', (e) => {
  console.log('[SW] Activated');
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.map((key) => {
        if (key !== CACHE_NAME) {
          console.log('[SW] Clearing old cache:', key);
          return caches.delete(key);
        }
      })
    ))
  );
  self.clients.claim(); // 立即接管页面
});

// 3. 拦截请求：缓存优先策略 (Cache First)
// 适合计算器这种静态工具，速度最快
self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((response) => {
      // 如果缓存里有，直接返回缓存；否则去网络请求
      return response || fetch(e.request).catch(() => {
          // 如果网络也没网，且是 HTML 请求，可以返回一个 fallback (可选)
          // return caches.match('./index.html');
      });
    })
  );
});