/* MindAuth 独立静态页共用脚本（error.html / oauth-error.html / docs.html）
 *
 * 主题逻辑与用户中心、管理端共用 localStorage 键 `theme`（同 MDTBBS 论坛）：
 * 没有显式选择时跟随系统偏好，显式选择后不再被系统设置覆盖。
 * 这三个页面不经过 Vite 构建，所以单独放一份，避免三个 HTML 各写一遍。
 */
(function () {
  function preferredTheme() {
    try {
      var saved = localStorage.getItem('theme');
      if (saved === 'dark' || saved === 'light') return saved;
    } catch (e) {}
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    var icon = document.getElementById('theme-icon');
    if (icon) icon.textContent = theme === 'dark' ? '☀' : '☾';
  }

  function toggleTheme() {
    var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    try {
      localStorage.setItem('theme', next);
    } catch (e) {}
    applyTheme(next);
  }

  applyTheme(preferredTheme());

  document.addEventListener('DOMContentLoaded', function () {
    var button = document.getElementById('theme-toggle');
    if (button) button.addEventListener('click', toggleTheme);
    document.documentElement.classList.add('theme-ready');
  });
})();
