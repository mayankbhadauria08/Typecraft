/* Admin console: sets the theme before anything is drawn (loaded in <head>, not deferred).
   The choice is kept in this browser only; without one, the device's setting decides. */
(function () {
  var theme = null;
  try { theme = window.localStorage.getItem('tcConsoleTheme'); } catch (e) { theme = null; }
  if (theme !== 'light' && theme !== 'dark') {
    theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.documentElement.setAttribute('data-theme', theme);
})();
