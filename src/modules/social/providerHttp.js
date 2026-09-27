const MAX_RESPONSE_BYTES = 256 * 1024;

async function requestText(url, options, timeoutMs, provider) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || 5000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const declaredSize = Number(response.headers?.get?.('content-length'));
    if (Number.isFinite(declaredSize) && declaredSize > MAX_RESPONSE_BYTES) throw new Error(`${provider} response too large`);
    if (!response.ok) throw new Error(`${provider} request failed`);
    if (response.body?.getReader) {
      const reader = response.body.getReader();
      const chunks = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_RESPONSE_BYTES) {
          await reader.cancel().catch(() => {});
          throw new Error(`${provider} response too large`);
        }
        chunks.push(value);
      }
      const combined = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.byteLength; }
      return new TextDecoder().decode(combined);
    }
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) throw new Error(`${provider} response too large`);
    return text;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error(`${provider} request timed out`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function requestJson(url, options, timeoutMs, provider) {
  const text = await requestText(url, options, timeoutMs, provider);
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid JSON object');
    return value;
  } catch {
    throw new Error(`${provider} response invalid`);
  }
}

module.exports = { requestJson };
