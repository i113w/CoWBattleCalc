// js/pwa.js
document.addEventListener('DOMContentLoaded', () => {
  // 检查浏览器是否支持 Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => {
        console.log('✅ Service Worker Registered. Scope:', reg.scope);
      })
      .catch(err => {
        console.error('❌ Service Worker Failed:', err);
        // GitHub Pages 常见错误提示：
        // 如果出现 404，检查 sw.js 是否在根目录
        // 如果出现 security error，检查 scope 设置
      });
  }
});