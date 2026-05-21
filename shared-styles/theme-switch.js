/* Mindustry Community - 主题切换逻辑 */

/**
 * 初始化主题
 * 默认浅色主题，存储用户偏好到 localStorage
 */
function initTheme() {
  const saved = localStorage.getItem('theme');
  if (saved === 'dark' || saved === 'light') {
    setTheme(saved);
    return saved;
  }
  // 默认浅色主题
  setTheme('light');
  return 'light';
}

/**
 * 设置主题
 * @param {string} theme - 'light' 或 'dark'
 */
function setTheme(theme) {
  // CSS 变量方式 (MindAuth)
  document.documentElement.setAttribute('data-theme', theme);
  // Tailwind 方式 (MindBBS, EasyManager)
  document.documentElement.classList.toggle('dark', theme === 'dark');
  localStorage.setItem('theme', theme);
}

/**
 * 切换主题
 * @returns {string} 新主题名称
 */
function toggleTheme() {
  const current = getCurrentTheme();
  const next = current === 'dark' ? 'light' : 'dark';
  setTheme(next);
  return next;
}

/**
 * 获取当前主题
 * @returns {string} 'light' 或 'dark'
 */
function getCurrentTheme() {
  const saved = localStorage.getItem('theme');
  if (saved) return saved;
  // 检查 HTML 属性或 class
  if (document.documentElement.getAttribute('data-theme') === 'dark') return 'dark';
  if (document.documentElement.classList.contains('dark')) return 'dark';
  return 'light';
}

/**
 * 获取主题图标
 * @param {string} theme - 当前主题
 * @returns {string} 图标字符或 SVG
 */
function getThemeIcon(theme) {
  // 返回图标：深色主题显示太阳（表示可切换到亮色），亮色主题显示月亮
  return theme === 'dark' ? '☀' : '☾';
}

// 导出函数（用于模块化项目）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { initTheme, setTheme, toggleTheme, getCurrentTheme, getThemeIcon };
}