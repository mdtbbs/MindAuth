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

// ─── 共享工具（同 auth.spec.js 风格）─────────────────────────────────────────

/** React ToastProvider 渲染 .toast-container > .toast（无 #toast 旧 id） */
function toastWith(page, text) {
  return page.locator('.toast', { hasText: text }).first();
}

/** 注册一个新用户；注册成功后应用会自动登录并跳转 /dashboard */
async function registerUser(page, prefix) {
  // 注册限流为 5/小时，本文件会注册多个用户，先清理限流计数
  await page.request.post('/api/admin/test/clear-rate-limits', {
    data: { secret: ADMIN_SECRET }
  }).catch(() => {});
  const username = `${prefix}_${Date.now()}`;
  await page.goto('/register');
  await page.waitForSelector('#register-form', { timeout: 5000 });
  await page.fill('#username', username);
  await page.fill('#email', `${username}@test.com`);
  await page.fill('#password', 'TestPass123');
  // 新流程：先点击发送验证码（dev 模式自动回填）
  await page.click('[data-testid="register-send-code"]');
  await page.waitForSelector('[data-testid="register-email-code"]', { timeout: 5000 });
  await page.waitForFunction(
    () => {
      const input = document.querySelector('[data-testid="register-email-code"]');
      return input && input.value.length === 6;
    },
    { timeout: 5000 }
  );
  await page.click('#register-form button[type="submit"]');
  await page.waitForURL('**/dashboard', { timeout: 10000 });
  return username;
}

/**
 * 注册新用户并进入账户设置「个人资料」tab。
 * 该 tab 为默认激活 tab，包含隐藏的头像/横幅 file input
 * （data-testid="avatar-input" / "banner-input"）。
 */
async function registerAndOpenProfile(page, prefix) {
  const username = await registerUser(page, prefix);
  await page.goto('/account-settings');
  await page.waitForSelector('[data-testid="avatar-input"]', { state: 'attached', timeout: 8000 });
  return username;
}

/** 通过隐藏 file input 上传（React 用 ref 触发点击，setInputFiles 直接可用） */
async function uploadVia(page, testId, file) {
  await page.setInputFiles(`[data-testid="${testId}"]`, file);
}

/**
 * 直接调用上传 API（带 CSRF），用于验证服务端 multer 限制。
 * 前端在选择文件时已做同样的大小预检，超限文件不会发到服务端，
 * 因此服务端限制需要绕过 UI 直接断言。
 */
async function apiUpload(page, path, file) {
  const csrfRes = await page.request.get('/api/csrf-token');
  const { csrf_token: csrfToken } = await csrfRes.json();
  const res = await page.request.post(path, {
    headers: { 'X-CSRF-Token': csrfToken },
    multipart: { file }
  });
  return { status: res.status(), body: await res.json() };
}

test.beforeAll(async ({ request }) => {
  try {
    await request.post('/api/admin/test/clear-rate-limits', {
      data: { secret: ADMIN_SECRET }
    });
  } catch (err) {
    // Ignore if endpoint doesn't exist
  }
});

test.describe.serial('头像功能', () => {
  const avatarImg = (page) => page.locator('.settings-profile .account-avatar img');

  test.beforeEach(async ({ page, context }) => {
    await context.clearCookies();
    await registerAndOpenProfile(page, 'pw_avatar');
  });

  test('头像上传成功', async ({ page }) => {
    await uploadVia(page, 'avatar-input', {
      name: 'test-avatar.png',
      mimeType: 'image/png',
      buffer: PNG_MINIMAL
    });

    await expect(toastWith(page, '头像已更新')).toBeVisible({ timeout: 5000 });
    await expect(avatarImg(page)).toBeVisible();
  });

  test('头像大小超限', async ({ page }) => {
    const largeBuffer = generateLargeBuffer(2500);

    // 前端预检：选择超过 2MB 的文件时直接提示，不发请求
    await uploadVia(page, 'avatar-input', {
      name: 'large.png',
      mimeType: 'image/png',
      buffer: largeBuffer
    });
    await expect(toastWith(page, '图片大小不能超过 2MB')).toBeVisible({ timeout: 5000 });

    // 服务端 multer 限制：绕过前端直接上传，应返回 400
    const result = await apiUpload(page, '/api/account/avatar', {
      name: 'large.png',
      mimeType: 'image/png',
      buffer: largeBuffer
    });
    expect(result.status).toBe(400);
    expect(result.body.success).toBe(false);
    expect(result.body.message).toContain('图片大小不能超过 2MB');
  });

  test('头像格式错误', async ({ page }) => {
    // file input 的 accept 属性可被 setInputFiles 绕过，由服务端拒绝
    await uploadVia(page, 'avatar-input', {
      name: 'invalid.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('This is not an image')
    });

    await expect(toastWith(page, '只支持 JPEG、PNG、GIF、WebP 格式的图片')).toBeVisible({ timeout: 5000 });
  });

  test('头像删除成功', async ({ page }) => {
    await uploadVia(page, 'avatar-input', {
      name: 'test-avatar.png',
      mimeType: 'image/png',
      buffer: PNG_MINIMAL
    });
    await expect(toastWith(page, '头像已更新')).toBeVisible({ timeout: 5000 });
    await expect(avatarImg(page)).toBeVisible();

    // 上传成功后「删除头像」按钮出现在个人资料 tab
    await page.getByRole('button', { name: '删除头像' }).click();
    await expect(toastWith(page, '头像已删除')).toBeVisible({ timeout: 5000 });
    await expect(avatarImg(page)).toHaveCount(0);

    // 刷新后仍显示首字母占位而非图片
    await page.reload();
    await page.waitForSelector('.settings-profile .account-avatar', { timeout: 8000 });
    await expect(avatarImg(page)).toHaveCount(0);
  });

  test('头像更换成功', async ({ page }) => {
    await uploadVia(page, 'avatar-input', {
      name: 'avatar1.png',
      mimeType: 'image/png',
      buffer: PNG_MINIMAL
    });
    await expect(toastWith(page, '头像已更新')).toBeVisible({ timeout: 5000 });
    await expect(avatarImg(page)).toBeVisible();
    const firstSrc = await avatarImg(page).getAttribute('src');

    await uploadVia(page, 'avatar-input', {
      name: 'avatar2.png',
      mimeType: 'image/png',
      buffer: PNG_MINIMAL
    });
    // 服务端以时间戳命名文件，更换成功后 src 必然变化
    await expect(avatarImg(page)).not.toHaveAttribute('src', firstSrc, { timeout: 5000 });
    await expect(avatarImg(page)).toBeVisible();
  });
});

test.describe.serial('横幅功能', () => {
  const bannerImg = (page) => page.locator('.settings-banner img');

  test.beforeEach(async ({ page, context }) => {
    await context.clearCookies();
    await registerAndOpenProfile(page, 'pw_banner');
  });

  test('横幅上传成功', async ({ page }) => {
    await uploadVia(page, 'banner-input', {
      name: 'test-banner.png',
      mimeType: 'image/png',
      buffer: PNG_MINIMAL
    });

    await expect(toastWith(page, '横幅已更新')).toBeVisible({ timeout: 5000 });
    await expect(bannerImg(page)).toBeVisible();
  });

  test('横幅大小超限', async ({ page }) => {
    const largeBuffer = generateLargeBuffer(6000);

    // 前端预检：超过 5MB 直接提示
    await uploadVia(page, 'banner-input', {
      name: 'large.png',
      mimeType: 'image/png',
      buffer: largeBuffer
    });
    await expect(toastWith(page, '图片大小不能超过 5MB')).toBeVisible({ timeout: 5000 });

    // 服务端 multer 限制
    const result = await apiUpload(page, '/api/account/banner', {
      name: 'large.png',
      mimeType: 'image/png',
      buffer: largeBuffer
    });
    expect(result.status).toBe(400);
    expect(result.body.success).toBe(false);
    expect(result.body.message).toContain('图片大小不能超过 5MB');
  });

  test('横幅格式错误', async ({ page }) => {
    await uploadVia(page, 'banner-input', {
      name: 'invalid.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('This is not an image')
    });

    await expect(toastWith(page, '只支持 JPEG、PNG、GIF、WebP 格式的图片')).toBeVisible({ timeout: 5000 });
  });

  test('横幅删除成功', async ({ page }) => {
    await uploadVia(page, 'banner-input', {
      name: 'test-banner.png',
      mimeType: 'image/png',
      buffer: PNG_MINIMAL
    });
    await expect(toastWith(page, '横幅已更新')).toBeVisible({ timeout: 5000 });
    await expect(bannerImg(page)).toBeVisible();

    await page.getByRole('button', { name: '删除横幅' }).click();
    await expect(toastWith(page, '横幅已删除')).toBeVisible({ timeout: 5000 });
    await expect(bannerImg(page)).toHaveCount(0);

    await page.reload();
    await page.waitForSelector('.settings-banner', { timeout: 8000 });
    await expect(bannerImg(page)).toHaveCount(0);
  });

  test('横幅更换成功', async ({ page }) => {
    await uploadVia(page, 'banner-input', {
      name: 'banner1.png',
      mimeType: 'image/png',
      buffer: PNG_MINIMAL
    });
    await expect(toastWith(page, '横幅已更新')).toBeVisible({ timeout: 5000 });
    await expect(bannerImg(page)).toBeVisible();
    const firstSrc = await bannerImg(page).getAttribute('src');

    await uploadVia(page, 'banner-input', {
      name: 'banner2.png',
      mimeType: 'image/png',
      buffer: PNG_MINIMAL
    });
    await expect(bannerImg(page)).not.toHaveAttribute('src', firstSrc, { timeout: 5000 });
    await expect(bannerImg(page)).toBeVisible();
  });
});

test.describe('头像格式支持', () => {
  const avatarImg = (page) => page.locator('.settings-profile .account-avatar img');

  test.beforeEach(async ({ page, context }) => {
    await context.clearCookies();
    await registerAndOpenProfile(page, 'pw_format');
  });

  const formats = [
    { label: 'JPEG', name: 'test.jpeg', mimeType: 'image/jpeg', buffer: JPEG_MINIMAL },
    { label: 'PNG', name: 'test.png', mimeType: 'image/png', buffer: PNG_MINIMAL },
    { label: 'GIF', name: 'test.gif', mimeType: 'image/gif', buffer: GIF_MINIMAL },
    { label: 'WebP', name: 'test.webp', mimeType: 'image/webp', buffer: WEBP_MINIMAL },
  ];

  for (const format of formats) {
    test(`支持${format.label}格式头像`, async ({ page }) => {
      await uploadVia(page, 'avatar-input', {
        name: format.name,
        mimeType: format.mimeType,
        buffer: format.buffer
      });

      await expect(toastWith(page, '头像已更新')).toBeVisible({ timeout: 5000 });
      await expect(avatarImg(page)).toBeVisible();
    });
  }
});
