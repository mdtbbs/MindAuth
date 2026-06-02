import { test, expect } from '@playwright/test';

const ADMIN_SECRET = 'admin123';

// Minimal 1x1 PNG image (base64 encoded)
const PNG_MINIMAL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADggG/nE9PAAAAAABJRU5ErkJggg==',
  'base64'
);

// Minimal 1x1 JPEG image
const JPEG_MINIMAL = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA',
  'base64'
);

// Minimal GIF image
const GIF_MINIMAL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
);

// Minimal WebP image
const WEBP_MINIMAL = Buffer.from(
  'UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4ADAA=',
  'base64'
);

// Generate large buffer
function generateLargeBuffer(sizeKB) {
  const padding = Buffer.alloc(sizeKB * 1024 - PNG_MINIMAL.length, 0xFF);
  return Buffer.concat([PNG_MINIMAL, padding]);
}

// Helper: Register and login user
async function registerAndLogin(page, username, email, password) {
  await page.goto('/#register');
  await page.waitForSelector('#register-form', { timeout: 5000 });
  await page.fill('#username', username);
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.click('#register-form button[type="submit"]');
  await page.waitForSelector('#toast.show', { timeout: 5000 });
  await page.waitForTimeout(500);

  await page.goto('/#login');
  await page.waitForSelector('#login-form', { timeout: 5000 });
  await page.fill('#username', username);
  await page.fill('#password', password);
  await page.click('#login-form button[type="submit"]');
  await page.waitForSelector('#username-display', { timeout: 5000 });

  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);
}

// Helper: Upload file via filechooser
async function uploadFile(page, inputId, file) {
  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.evaluate((id) => {
      const input = document.getElementById(id);
      if (input) input.click();
    }, inputId)
  ]);
  await fileChooser.setFiles(file);
}

test.beforeAll(async ({ request }) => {
  try {
    await request.post('/api/admin/test/clear-rate-limits', {
      data: { secret: ADMIN_SECRET }
    });
  } catch (err) {}
});

test.describe.serial('头像功能', () => {
  const password = 'TestPass123';

  test.beforeAll(async ({ request }) => {
    await request.post('/api/admin/test/clear-rate-limits', {
      data: { secret: ADMIN_SECRET }
    });
  });

  test.beforeEach(async ({ page, context }) => {
    await context.clearCookies();
    const username = 'pw_avatar_' + Date.now();
    const email = 'pw_avatar_' + Date.now() + '@test.com';
    await registerAndLogin(page, username, email, password);
  });

  test.afterEach(async ({ request }) => {
    await request.post('/api/admin/test/clear-rate-limits', {
      data: { secret: ADMIN_SECRET }
    });
  });

  test('头像上传成功', async ({ page }) => {
    await uploadFile(page, 'avatar-file-input', {
      name: 'test-avatar.png',
      mimeType: 'image/png',
      buffer: PNG_MINIMAL
    });

    await page.waitForSelector('#toast.show', { timeout: 5000 });
    await expect(page.locator('#toast')).toContainText('头像已更新');
    await expect(page.locator('#avatar-img')).toBeVisible();
  });

  test('头像大小超限', async ({ page }) => {
    // Use frontend's apiFetch which handles CSRF
    const largeBuffer = generateLargeBuffer(2500);

    const result = await page.evaluate(async (bufferBase64) => {
      const buffer = Uint8Array.from(atob(bufferBase64), c => c.charCodeAt(0));
      const formData = new FormData();
      formData.append('file', new Blob([buffer], { type: 'image/png' }), 'large.png');

      // Use window.apiFetch which handles CSRF tokens
      try {
        const res = await window.apiFetch('/api/account/avatar', {
          method: 'POST',
          body: formData,
          headers: {}
        });
        return { status: res.success ? 200 : 400, body: res };
      } catch (e) {
        return { status: 0, body: { message: e.message } };
      }
    }, largeBuffer.toString('base64'));

    // Multer should reject with error
    expect(result.body.success).toBe(false);
    expect(result.body.message).toContain('图片大小不能超过 2MB');
  });

  test('头像格式错误', async ({ page }) => {
    const textBuffer = Buffer.from('This is not an image');

    await uploadFile(page, 'avatar-file-input', {
      name: 'invalid.txt',
      mimeType: 'text/plain',
      buffer: textBuffer
    });

    await page.waitForSelector('#toast.show', { timeout: 5000 });
    const toastText = await page.locator('#toast').textContent();
    expect(toastText).toBeTruthy();
  });

  test('头像删除成功', async ({ page }) => {
    await uploadFile(page, 'avatar-file-input', {
      name: 'test-avatar.png',
      mimeType: 'image/png',
      buffer: PNG_MINIMAL
    });
    await page.waitForSelector('#toast.show', { timeout: 5000 });
    await page.waitForTimeout(500);

    // Use page.evaluate with apiFetch for proper CSRF handling
    const result = await page.evaluate(async () => {
      const res = await window.apiFetch('/api/account/avatar', { method: 'DELETE' });
      return res;
    });

    expect(result.success).toBe(true);

    await page.reload();
    await page.waitForSelector('#username-display', { timeout: 5000 });
    await page.waitForTimeout(1000);

    await expect(page.locator('#avatar-letter')).toBeVisible();
    await expect(page.locator('#avatar-img')).toBeHidden();
  });

  test('头像更换成功', async ({ page }) => {
    await uploadFile(page, 'avatar-file-input', {
      name: 'avatar1.png',
      mimeType: 'image/png',
      buffer: PNG_MINIMAL
    });
    await page.waitForSelector('#toast.show', { timeout: 5000 });
    await expect(page.locator('#toast')).toContainText('头像已更新');
    await page.waitForTimeout(500);

    await uploadFile(page, 'avatar-file-input', {
      name: 'avatar2.png',
      mimeType: 'image/png',
      buffer: PNG_MINIMAL
    });
    await page.waitForSelector('#toast.show', { timeout: 5000 });
    await expect(page.locator('#toast')).toContainText('头像已更新');
    await expect(page.locator('#avatar-img')).toBeVisible();
  });
});

test.describe.serial('背景图功能', () => {
  const password = 'TestPass123';

  test.beforeAll(async ({ request }) => {
    await request.post('/api/admin/test/clear-rate-limits', {
      data: { secret: ADMIN_SECRET }
    });
  });

  test.beforeEach(async ({ page, context }) => {
    await context.clearCookies();
    const username = 'pw_banner_' + Date.now();
    const email = 'pw_banner_' + Date.now() + '@test.com';
    await registerAndLogin(page, username, email, password);
  });

  test.afterEach(async ({ request }) => {
    await request.post('/api/admin/test/clear-rate-limits', {
      data: { secret: ADMIN_SECRET }
    });
  });

  test('背景图上传成功', async ({ page }) => {
    await uploadFile(page, 'banner-file-input', {
      name: 'test-banner.png',
      mimeType: 'image/png',
      buffer: PNG_MINIMAL
    });

    await page.waitForSelector('#toast.show', { timeout: 5000 });
    await expect(page.locator('#toast')).toContainText('背景图已更新');
    await expect(page.locator('#banner-display img')).toBeVisible();
  });

  test('背景图大小超限', async ({ page }) => {
    const largeBuffer = generateLargeBuffer(6000);

    const result = await page.evaluate(async (bufferBase64) => {
      const buffer = Uint8Array.from(atob(bufferBase64), c => c.charCodeAt(0));
      const formData = new FormData();
      formData.append('file', new Blob([buffer], { type: 'image/png' }), 'large.png');

      try {
        const res = await window.apiFetch('/api/account/banner', {
          method: 'POST',
          body: formData,
          headers: {}
        });
        return { status: res.success ? 200 : 400, body: res };
      } catch (e) {
        return { status: 0, body: { message: e.message } };
      }
    }, largeBuffer.toString('base64'));

    expect(result.body.success).toBe(false);
    expect(result.body.message).toContain('图片大小不能超过 5MB');
  });

  test('背景图格式错误', async ({ page }) => {
    const textBuffer = Buffer.from('This is not an image');

    await uploadFile(page, 'banner-file-input', {
      name: 'invalid.txt',
      mimeType: 'text/plain',
      buffer: textBuffer
    });

    await page.waitForSelector('#toast.show', { timeout: 5000 });
    const toastText = await page.locator('#toast').textContent();
    expect(toastText).toBeTruthy();
  });

  test('背景图删除成功', async ({ page }) => {
    await uploadFile(page, 'banner-file-input', {
      name: 'test-banner.png',
      mimeType: 'image/png',
      buffer: PNG_MINIMAL
    });
    await page.waitForSelector('#toast.show', { timeout: 5000 });
    await page.waitForTimeout(500);

    const result = await page.evaluate(async () => {
      const res = await window.apiFetch('/api/account/banner', { method: 'DELETE' });
      return res;
    });

    expect(result.success).toBe(true);

    await page.reload();
    await page.waitForSelector('#username-display', { timeout: 5000 });
    await page.waitForTimeout(1000);

    await expect(page.locator('#banner-display img')).toBeHidden();
  });

  test('背景图更换成功', async ({ page }) => {
    await uploadFile(page, 'banner-file-input', {
      name: 'banner1.png',
      mimeType: 'image/png',
      buffer: PNG_MINIMAL
    });
    await page.waitForSelector('#toast.show', { timeout: 5000 });
    await expect(page.locator('#toast')).toContainText('背景图已更新');
    await page.waitForTimeout(500);

    await uploadFile(page, 'banner-file-input', {
      name: 'banner2.png',
      mimeType: 'image/png',
      buffer: PNG_MINIMAL
    });
    await page.waitForSelector('#toast.show', { timeout: 5000 });
    await expect(page.locator('#toast')).toContainText('背景图已更新');
    await expect(page.locator('#banner-display img')).toBeVisible();
  });
});

test.describe('头像格式支持', () => {
  test.beforeAll(async ({ request }) => {
    await request.post('/api/admin/test/clear-rate-limits', {
      data: { secret: ADMIN_SECRET }
    });
  });

  test.beforeEach(async ({ page, context }) => {
    await context.clearCookies();
    const username = 'pw_format_' + Date.now();
    const email = 'pw_format_' + Date.now() + '@test.com';
    const password = 'TestPass123';
    await registerAndLogin(page, username, email, password);
  });

  test.afterEach(async ({ request }) => {
    await request.post('/api/admin/test/clear-rate-limits', {
      data: { secret: ADMIN_SECRET }
    });
  });

  test('支持JPEG格式头像', async ({ page }) => {
    await uploadFile(page, 'avatar-file-input', {
      name: 'test.jpeg',
      mimeType: 'image/jpeg',
      buffer: JPEG_MINIMAL
    });

    await page.waitForSelector('#toast.show', { timeout: 5000 });
    await expect(page.locator('#toast')).toContainText('头像已更新');
    await expect(page.locator('#avatar-img')).toBeVisible();
  });

  test('支持PNG格式头像', async ({ page }) => {
    await uploadFile(page, 'avatar-file-input', {
      name: 'test.png',
      mimeType: 'image/png',
      buffer: PNG_MINIMAL
    });

    await page.waitForSelector('#toast.show', { timeout: 5000 });
    await expect(page.locator('#toast')).toContainText('头像已更新');
    await expect(page.locator('#avatar-img')).toBeVisible();
  });

  test('支持GIF格式头像', async ({ page }) => {
    await uploadFile(page, 'avatar-file-input', {
      name: 'test.gif',
      mimeType: 'image/gif',
      buffer: GIF_MINIMAL
    });

    await page.waitForSelector('#toast.show', { timeout: 5000 });
    await expect(page.locator('#toast')).toContainText('头像已更新');
    await expect(page.locator('#avatar-img')).toBeVisible();
  });

  test('支持WebP格式头像', async ({ page }) => {
    await uploadFile(page, 'avatar-file-input', {
      name: 'test.webp',
      mimeType: 'image/webp',
      buffer: WEBP_MINIMAL
    });

    await page.waitForSelector('#toast.show', { timeout: 5000 });
    await expect(page.locator('#toast')).toContainText('头像已更新');
    await expect(page.locator('#avatar-img')).toBeVisible();
  });
});