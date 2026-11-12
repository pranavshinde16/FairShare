// Applies the saved theme before the first paint, so a dark-mode user never sees a white flash.
// A file rather than an inline script, because the CSP allows scripts from our origin only.
// Keep the key and values in step with src/lib/theme.ts.
(function () {
  var theme = 'system';
  try {
    theme = localStorage.getItem('fairshare.theme') || 'system';
  } catch {
    // Storage blocked (private mode, sandbox): follow the system.
  }
  var dark =
    theme === 'dark' ||
    (theme !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
})();
