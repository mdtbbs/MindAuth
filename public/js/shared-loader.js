/**
 * Shared Loader - 加载预渲染HTML模板片段的工具
 * 用于MindAuth SPA加载shared组件预渲染的HTML
 */

// 模板缓存，避免重复请求
const templateCache = new Map();

// 默认超时时间（毫秒）
const DEFAULT_TIMEOUT = 5000;

/**
 * 获取模板加载失败的 fallback UI
 * @param {string} name - 模板名称
 * @returns {string} Fallback HTML
 */
function getFallbackTemplate(name) {
  if (name === 'login-layout') {
    return `
      <div class="auth-split-container" style="min-height: 100vh;">
        <div class="auth-brand-section" style="flex: 1; background: #333; display: flex; flex-direction: column; justify-content: center; align-items: center; padding: 3rem;">
          <div class="auth-brand-content">
            <div class="auth-logo" style="display: flex; align-items: center; gap: 0.5rem; justify-content: center; color: #fff; margin-bottom: 1.5rem;">
              <div class="auth-logo-dot" style="width: 8px; height: 8px; background: var(--primary); border-radius: 50%;"></div>
              MindAuth
            </div>
            <h2 style="color: #fff; font-size: 1.25rem; margin-bottom: 1rem;">Mindustry 社区统一认证</h2>
          </div>
        </div>
        <div class="auth-form-section" style="flex: 1; display: flex; flex-direction: column; justify-content: center; align-items: center; padding: 3rem; background: var(--bg);">
          <div class="auth-form-wrapper" style="width: 100%; max-width: 400px;">
            <h3 style="font-size: 1.25rem; font-weight: 600; color: var(--text); margin-bottom: 1.5rem;">加载失败</h3>
            <p style="color: var(--text-muted); margin-bottom: 1rem;">页面加载失败，请检查网络连接后刷新页面。</p>
            <button onclick="location.reload()" class="btn-primary" style="width: 100%; padding: 0.75rem 1rem; background: var(--primary); color: #fff; border: none; border-radius: var(--radius); cursor: pointer;">刷新页面</button>
          </div>
        </div>
      </div>
    `;
  }
  return '<div class="empty-state" style="text-align: center; padding: 2rem; color: var(--text-muted);">加载失败</div>';
}

/**
 * 加载预渲染的HTML模板片段
 * @param {string} name - 模板名称 (如 'login-layout', 'header')
 * @param {number} timeout - 超时时间（毫秒），默认 5000
 * @returns {Promise<string>} HTML内容
 */
async function loadTemplate(name, timeout = DEFAULT_TIMEOUT) {
  // Validate template name (defense-in-depth)
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    throw new Error(`Invalid template name: ${name}`);
  }

  // 检查缓存
  if (templateCache.has(name)) {
    return templateCache.get(name);
  }

  // 创建 AbortController 用于超时控制
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(`/templates/${name}.html`, {
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      throw new Error(`Failed to load template: ${name} (status ${res.status})`);
    }

    const html = await res.text();
    // 存入缓存
    templateCache.set(name, html);
    return html;
  } catch (err) {
    clearTimeout(timeoutId);

    // 超时或网络错误时使用 fallback
    if (err.name === 'AbortError') {
      console.warn(`Template load timeout: ${name}`);
    } else {
      console.error(`Template load failed: ${name}`, err.message);
    }

    // 返回 fallback 而不是抛出错误，让页面能继续显示
    const fallbackHtml = getFallbackTemplate(name);
    templateCache.set(name, fallbackHtml); // 缓存 fallback 防止重复请求
    return fallbackHtml;
  }
}

/**
 * 加载模板并插入到指定元素
 * @param {string} name - 模板名称
 * @param {string|HTMLElement} target - 目标元素ID或元素本身
 * @returns {Promise<void>}
 */
async function renderTemplate(name, target) {
  const html = await loadTemplate(name);
  const element = typeof target === 'string'
    ? document.getElementById(target)
    : target;
  if (element) {
    element.innerHTML = html;
  } else {
    console.warn(`Target element not found for template: ${name}`);
  }
}

/**
 * 替换模板中的占位符（使用 {{key}} 格式）
 * @param {string} html - HTML模板
 * @param {Object} data - 替换数据 { key: value }
 * @returns {string} 替换后的HTML
 * @warning Data values are inserted as-is. Callers must sanitize user input.
 */
function fillTemplate(html, data) {
  return html.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return data[key] !== undefined ? data[key] : match;
  });
}

/**
 * 替换模板中data属性的元素内容
 * @param {string} html - HTML字符串
 * @param {Object} data - { attributeName: value }
 * @returns {string} 处理后的HTML
 */
function fillDataAttributes(html, data) {
  // 创建临时DOM解析
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  for (const [attr, value] of Object.entries(data)) {
    const elements = doc.querySelectorAll(`[data-${attr}]`);
    elements.forEach(el => {
      el.textContent = value;
    });
  }

  return doc.body.innerHTML;
}

// 导出到全局
window.SharedLoader = {
  loadTemplate,
  renderTemplate,
  fillTemplate,
  fillDataAttributes,
  clearCache: () => templateCache.clear(),
  getCacheSize: () => templateCache.size,
};