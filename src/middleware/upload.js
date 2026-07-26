const multer = require('multer');
const path = require('path');
const fs = require('fs');

// 确保上传目录存在
const avatarsDir = path.join(__dirname, '../../public/uploads/avatars');
const bannersDir = path.join(__dirname, '../../public/uploads/banners');
const backgroundsDir = path.join(__dirname, '../../public/uploads/backgrounds');

if (!fs.existsSync(avatarsDir)) {
  fs.mkdirSync(avatarsDir, { recursive: true });
}
if (!fs.existsSync(bannersDir)) {
  fs.mkdirSync(bannersDir, { recursive: true });
}
if (!fs.existsSync(backgroundsDir)) {
  fs.mkdirSync(backgroundsDir, { recursive: true });
}

const ALLOWED_IMAGE_TYPES = new Map([
  ['image/jpeg', new Set(['.jpg', '.jpeg'])],
  ['image/png', new Set(['.png'])],
  ['image/gif', new Set(['.gif'])],
  ['image/webp', new Set(['.webp'])],
]);

// 文件过滤器
const imageFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const allowedExtensions = ALLOWED_IMAGE_TYPES.get(file.mimetype);
  if (!allowedExtensions || !allowedExtensions.has(ext)) {
    cb(new Error('只支持 JPEG、PNG、GIF、WebP 格式的图片'), false);
    return;
  }

  cb(null, true);
};

// 头像上传配置
const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, avatarsDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const uniqueName = `${req.user.id}_${Date.now()}${ext}`;
    cb(null, uniqueName);
  }
});

const avatarUpload = multer({
  storage: avatarStorage,
  fileFilter: imageFilter,
  limits: { fileSize: 2 * 1024 * 1024 } // 2MB
});

// 背景图上传配置
const bannerStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, bannersDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const uniqueName = `${req.user.id}_${Date.now()}${ext}`;
    cb(null, uniqueName);
  }
});

const bannerUpload = multer({
  storage: bannerStorage,
  fileFilter: imageFilter,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB
});

// 登录页背景图（管理端上传）：不含 GIF，避免动图背景
const backgroundFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const allowedExtensions = ALLOWED_IMAGE_TYPES.get(file.mimetype);
  if (file.mimetype === 'image/gif' || !allowedExtensions || !allowedExtensions.has(ext)) {
    cb(new Error('只支持 JPEG、PNG、WebP 格式的图片'), false);
    return;
  }

  cb(null, true);
};

const backgroundStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, backgroundsDir);
  },
  filename: (req, file, cb) => {
    // 管理端上传，无 req.user；用时间戳保证唯一
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `auth_bg_${Date.now()}${ext}`);
  }
});

const backgroundUpload = multer({
  storage: backgroundStorage,
  fileFilter: backgroundFilter,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB
});

module.exports = {
  avatarUpload,
  bannerUpload,
  backgroundUpload
};
