// Applies the saved theme before first paint so dark mode never flashes white.
// Loaded as a blocking <script> in <head> (not inline) so a strict Content-Security-Policy works.
// Keep the storage key and logic in sync with src/context/ThemeContext.jsx.
(function () {
  var t = 'system';
  try {
    t = localStorage.getItem('na_theme') || 'system';
  } catch (e) {}
  var dark = t === 'dark' || (t !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  var root = document.documentElement;
  if (dark) root.classList.add('dark');
  root.style.colorScheme = dark ? 'dark' : 'light';
})();
