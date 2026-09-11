/**
 * Config - 统一配置常量
 */
export const CONFIG = {
  API_BASE: '',
  // 统一接口：原图（按 STORAGE_MODE 决定本地/远程）
  ORIGINAL_IMAGE_ENDPOINT: 'api.php?action=original',
  // 站点域名（用于生成原图绝对 URL，留空则自动检测）
  SITE_BASE_URL: '',
  ENDPOINTS: {
    TREE: 'api.php?action=getTree',
    IMAGES: 'api.php?action=getImages',
    SEARCH: 'api.php?action=search',
  },
  // 缓存过期时间：30 天（点击「清除缓存」可随时强制刷新）
  CACHE_TTL: {
    TREE: 30 * 24 * 60 * 60 * 1000,
    IMAGES: 30 * 24 * 60 * 60 * 1000,
  },
  STORAGE_KEY: 'img_browser_',
  PRELOAD_SCREENS: 2,
};

export const STORAGE_KEYS = {
  FOLDER_TREE: 'folder_tree',
  FOLDER_IMAGES_PREFIX: 'folder_images_',
  COLLAPSED_FOLDERS: 'collapsed_folders',
  THEME: 'theme',
  CACHE_UPDATED_AT: 'cache_updated_at',
};

export const CACHE_TTL = CONFIG.CACHE_TTL;

/** 缩略图 URL */
export function getThumbnailUrl(path) {
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  return `${CONFIG.API_BASE}api.php?action=thumb&path=${encoded}`;
}

/** 原图 URL（按 STORAGE_MODE 决定本地读取或远程代理），生成绝对 URL */
export function getOriginalUrl(webpPath) {
  let p = webpPath;
  if (p.toLowerCase().endsWith('.webp')) p = p.slice(0, -5);
  const encoded = p.split('/').map(encodeURIComponent).join('/');
  // 使用完整路径（包含当前页面所在目录）
  const base = CONFIG.SITE_BASE_URL || new URL('.', window.location.href).href;
  return `${base}${CONFIG.API_BASE}${CONFIG.ORIGINAL_IMAGE_ENDPOINT}&path=${encoded}`;
}