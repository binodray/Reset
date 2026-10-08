(() => {
  const report = (message) => {
    if (window.__TAURI__) window.__TAURI__.core.invoke('frontend_report', { message }).catch(() => {});
  };
  window.resetStartupReport = report;
  window.addEventListener('error', (event) => report(`frontend error: ${event.message || event.target?.src || 'asset failed'}`), true);
  window.addEventListener('unhandledrejection', (event) => report(`frontend rejection: ${event.reason}`));
  report(`frontend bootstrap: ${location.href}`);
  setTimeout(() => report(`frontend status: ${document.readyState}; cards=${document.querySelectorAll('.flip-card').length}; ready=${!!window.resetReady}`), 3000);
})();
