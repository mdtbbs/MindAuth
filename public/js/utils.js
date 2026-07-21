// HTML escaping utility for XSS prevention.

// HTML escape function for XSS prevention
export function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Inject form content into LoginLayout template HTML
 * @param {string} templateHtml - The LoginLayout template HTML
 * @param {string} formContent - The form HTML to inject
 * @param {string} title - The form title (e.g., "返回登录", "注册")
 * @returns {string} Complete HTML with injected content
 */
export function injectLoginFormContent(templateHtml, formContent, title) {
  // Replace the form title in data-form-title attribute
  let html = templateHtml.replace(
    /(<[^>]*\bdata-form-title=")([^"]*)("[^>]*>)([^<]*)(<\/h3>)/i,
    `$1${title}$3${title}$5`
  );
  // Inject form content into data-form-content div
  // Use .*? to match content including HTML entities like &lt;
  html = html.replace(
    /(<div[^>]*\bdata-form-content[^>]*>).*?(<\/div>)/i,
    `$1${formContent}$2`
  );
  return html;
}
