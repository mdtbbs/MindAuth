const path = require('path');
const fs = require('fs');

// Ensure a resolved path stays under public/ to prevent path traversal
const PUBLIC_ROOT = path.resolve(__dirname, '../../public');

function safePublicPath(relative) {
  if (!relative || typeof relative !== 'string') return null;
  const resolved = path.resolve(PUBLIC_ROOT, '.' + relative);
  if (!resolved.startsWith(PUBLIC_ROOT + path.sep) && resolved !== PUBLIC_ROOT) return null;
  return resolved;
}

function tryRemovePublicFile(relative) {
  const abs = safePublicPath(relative);
  if (!abs) return;
  try {
    if (fs.existsSync(abs)) fs.unlinkSync(abs);
  } catch (err) {
    console.warn('[PublicFiles] failed to remove old file:', relative, err.message);
  }
}

module.exports = { safePublicPath, tryRemovePublicFile };
