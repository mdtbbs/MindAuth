const multer = require('multer');
const path = require('path');
const fs = require('fs');

// 确保上传目录存在
const avatarsDir = path.join(__dirname, '../../public/uploads/avatars');
const bannersDir = path.join(__dirname, '../../public/uploads/banners');

if (!fs.existsSync(avatarsDir)) {
  fs.mkdirSync(avatarsDir, { recursive: true });
}
if (!fs.existsSync(bannersDir)) {
  fs.mkdirSync(bannersDir, { recursive: true });
}

// 文件过滤器
const imageFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('只支持 JPEG、PNG、GIF、WebP 格式的图片'), false);
  }
};

// 头像上传配置
const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, avatarsDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
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
    const ext = path.extname(file.originalname);
    const uniqueName = `${req.user.id}_${Date.now()}${ext}`;
    cb(null, uniqueName);
  }
});

const bannerUpload = multer({
  storage: bannerStorage,
  fileFilter: imageFilter,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB
});

module.exports = {
  avatarUpload,
  bannerUpload
};