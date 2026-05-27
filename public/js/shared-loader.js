/**
 * Shared Loader - 加载预渲染HTML模板片段的工具
 * 用于MindAuth SPA加载shared组件预渲染的HTML
 */

/**
 * 加载预渲染的HTML模板片段
 * @param {string} name - 模板名称 (如 'LoginLayout', 'Header')
 * @returns {Promise<string>} HTML内容
 */
async function loadTemplate(name) {
  // Validate template name (defense-in-depth)
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    throw new Error(`Invalid template name: ${name}`);
  }
  const res = await fetch(`/templates/${name}.html`);
  if (!res.ok) {
    throw new Error(`Failed to load template: ${name} (status ${res.status})`);
  }
  return res.text();
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
};