<?php
/**
 * api.php - 统一接口
 * =====================================================
 * 一个入口负责：目录树 / 图片列表 / 搜索 / README / 缩略图 / 原图。
 *
 * 动作（?action=...）：
 *   getTree   目录树（JSON，可选 &refresh=true 强制重建）
 *   getImages 文件夹图片列表（JSON，&path=相对路径）
 *   search    文件名搜索（JSON，&keyword=）
 *   readme    文件夹 README 内容（JSON，&path=）
 *   thumb     缩略图（图片二进制，&path=）—— 读取本地 webp_cache
 *   original  原图（图片二进制，&path=）—— 按 STORAGE_MODE 决定来源
 *
 * 存储模式（.env 的 STORAGE_MODE）：
 *   local  本地原图：thumb / original 都直接读 webp_cache
 *   webdav 远程拉取：thumb 读本地 webp_cache 缓存，original 代理远程 WebDAV
 */

require_once __DIR__ . '/env.php';

$env = loadEnv();
$storageMode = strtolower(trim((string)($env['STORAGE_MODE'] ?? 'webdav')));
$isLocal = ($storageMode === 'local');

$cacheDir      = __DIR__ . '/webp_cache';
$treeCacheFile = __DIR__ . '/.folder_tree_cache.json';
$metaCacheFile = __DIR__ . '/.images_meta_cache.json';
$nameIndexFile = __DIR__ . '/.name_index_cache.json';

// 缓存过期时间：30 天（前端「清除缓存」/admin 可强制重建）
$treeCacheTtl = 30 * 24 * 3600;
$metaCacheTtl = 30 * 24 * 3600;

$action = isset($_GET['action']) ? (string)$_GET['action'] : '';

// ============================================================
// 公共工具
// ============================================================
function api_format_file_size($bytes) {
    if ($bytes >= 1073741824) return number_format($bytes / 1073741824, 2) . ' GB';
    if ($bytes >= 1048576)    return number_format($bytes / 1048576, 2) . ' MB';
    if ($bytes >= 1024)       return number_format($bytes / 1024, 2) . ' KB';
    return $bytes . ' B';
}

/** 读取带时间戳的缓存文件（过期返回 null） */
function api_read_cache($cacheFile, $ttl) {
    if (!file_exists($cacheFile)) return null;
    $data = json_decode(file_get_contents($cacheFile), true);
    if (!$data || !isset($data['timestamp'])) return null;
    if (time() - $data['timestamp'] > $ttl) return null;
    return $data;
}

/** 写入带时间戳的缓存文件 */
function api_write_cache($cacheFile, $payload) {
    @file_put_contents($cacheFile, json_encode(['timestamp' => time(), 'data' => $payload]));
}

/** 图片元数据缓存（key -> ['timestamp'=>.., 'images'=>..]） */
function api_read_meta_cache($file) {
    if (!file_exists($file)) return [];
    $data = json_decode(file_get_contents($file), true);
    return is_array($data) ? $data : [];
}
function api_write_meta_cache($file, $data) {
    @file_put_contents($file, json_encode($data));
}

// ============================================================
// 目录树 / 列表 / 索引构建
// ============================================================
/** 单次遍历构建文件夹树（只含文件夹节点），同时累加图片数 */
function api_build_folder_tree($dir, $baseDir) {
    $children = [];
    $imageCount = 0;
    $items = @scandir($dir);
    if ($items === false) return ['children' => [], 'imageCount' => 0];

    foreach ($items as $item) {
        if ($item === '.' || $item === '..') continue;
        $fullPath = $dir . '/' . $item;
        if (is_dir($fullPath)) {
            $sub = api_build_folder_tree($fullPath, $baseDir);
            $imageCount += $sub['imageCount'];
            $children[] = [
                'name' => $item,
                'path' => str_replace($baseDir . '/', '', $fullPath),
                'type' => 'folder',
                'children' => $sub['children'],
                'imageCount' => $sub['imageCount'],
            ];
        } elseif (preg_match('/\.(webp|jpg|jpeg|png|gif)$/i', $item)) {
            $imageCount++;
        }
    }
    return ['children' => $children, 'imageCount' => $imageCount];
}

/** 递归检查树里是否还残留文件节点（识别旧版缓存，触发重建） */
function api_tree_has_files($nodes) {
    foreach ($nodes as $n) {
        if (isset($n['type']) && $n['type'] === 'file') return true;
        if (!empty($n['children']) && api_tree_has_files($n['children'])) return true;
    }
    return false;
}

/** 文件夹内图片完整元数据（含尺寸） */
function api_get_all_images($dir, $baseDir) {
    $images = [];
    $items = scandir($dir);
    foreach ($items as $item) {
        if ($item === '.' || $item === '..') continue;
        $fullPath = $dir . '/' . $item;
        $relativePath = str_replace($baseDir . '/', '', $fullPath);
        if (is_dir($fullPath)) {
            $images = array_merge($images, api_get_all_images($fullPath, $baseDir));
        } elseif (preg_match('/\.(webp|jpg|jpeg|png|gif)$/i', $item)) {
            list($width, $height) = @getimagesize($fullPath);
            $size = filesize($fullPath);
            $images[] = [
                'name' => $item,
                'path' => $relativePath,
                'width' => $width ?: 800,
                'height' => $height ?: 600,
                'size' => $size,
                'sizeFormatted' => api_format_file_size($size),
                'format' => strtoupper(pathinfo($item, PATHINFO_EXTENSION)),
                'modified' => filemtime($fullPath),
            ];
        }
    }
    return $images;
}

/** 轻量文件名索引（搜索专用，不做 getimagesize） */
function api_build_name_index($dir, $baseDir) {
    $images = [];
    $items = @scandir($dir);
    if ($items === false) return $images;
    foreach ($items as $item) {
        if ($item === '.' || $item === '..') continue;
        $fullPath = $dir . '/' . $item;
        if (is_dir($fullPath)) {
            $images = array_merge($images, api_build_name_index($fullPath, $baseDir));
        } elseif (preg_match('/\.(webp|jpg|jpeg|png|gif)$/i', $item)) {
            $images[] = [
                'name' => $item,
                'path' => str_replace($baseDir . '/', '', $fullPath),
                'size' => @filesize($fullPath),
                'format' => strtoupper(pathinfo($item, PATHINFO_EXTENSION)),
            ];
        }
    }
    return $images;
}

/**
 * 搜索关键词匹配：支持通配符 *（任意多个字符）和 ?（单个字符）
 * 反斜杠可转义：\* 匹配星号本身，\? 匹配问号本身
 */
function api_match_search_keyword($name, $keyword) {
    if (strpbrk($keyword, '*?') === false) {
        return stripos($name, $keyword) !== false;
    }
    $pattern = '';
    $len = strlen($keyword);
    for ($i = 0; $i < $len; $i++) {
        $ch = $keyword[$i];
        if ($ch === '\\' && $i + 1 < $len && ($keyword[$i + 1] === '*' || $keyword[$i + 1] === '?')) {
            $pattern .= preg_quote($keyword[++$i], '/');
        } elseif ($ch === '*') {
            $pattern .= '.*';
        } elseif ($ch === '?') {
            $pattern .= '.';
        } else {
            $pattern .= preg_quote($ch, '/');
        }
    }
    return preg_match('/^' . $pattern . '$/iu', $name) === 1;
}

// ============================================================
// 图片输出：本地文件 / 远程 WebDAV 代理
// ============================================================
/** 直接读取 webp_cache 内的本地文件 */
function api_serve_local_image($cacheDir, $path, $allowWebpFallback = false) {
    if ($path === '') { http_response_code(400); echo 'Missing path parameter'; exit; }

    $decoded = ltrim(rawurldecode($path), '/');
    if (strpos($decoded, '..') !== false) { http_response_code(403); exit; }

    $cacheReal = realpath($cacheDir);
    if ($cacheReal === false) { http_response_code(404); exit; }

    // 原图接口路径可能被前端去掉末尾 .webp，本地原图本身可能是 .webp → 补 .webp 兜底
    $candidates = [$decoded];
    if ($allowWebpFallback && substr($decoded, -5) !== '.webp') $candidates[] = $decoded . '.webp';

    $realPath = false;
    foreach ($candidates as $c) {
        $rp = realpath($cacheReal . '/' . $c);
        if ($rp !== false && strpos($rp, $cacheReal) === 0 && is_file($rp)) { $realPath = $rp; break; }
    }
    if ($realPath === false) { http_response_code(404); exit; }

    $mimeTypes = [
        'webp' => 'image/webp', 'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg',
        'png' => 'image/png', 'gif' => 'image/gif',
    ];
    $ext = strtolower(pathinfo($realPath, PATHINFO_EXTENSION));
    header('Content-Type: ' . ($mimeTypes[$ext] ?? 'application/octet-stream'));
    header('Content-Length: ' . filesize($realPath));
    header('Cache-Control: public, max-age=86400');
    readfile($realPath);
    exit;
}

/** URL 分段编码（已含合法 %xx 的段原样保留，避免二次编码） */
function api_ensure_url_encoded($seg) {
    return preg_match('/%(?:[0-9A-Fa-f]{2})/', $seg) ? $seg : rawurlencode($seg);
}
/** 编码完整 WebDAV URL（仅编码路径部分，保留 scheme/host/port） */
function api_encode_webdav_url($base, $extraPath = '') {
    $parts = parse_url($base);
    if ($parts === false || !isset($parts['scheme'], $parts['host'])) {
        return rtrim($base, '/') . ($extraPath !== '' ? '/' . ltrim($extraPath, '/') : '');
    }
    $path = $parts['path'] ?? '';
    if ($extraPath !== '') $path = rtrim($path, '/') . '/' . ltrim($extraPath, '/');
    $segs = [];
    foreach (explode('/', $path) as $seg) $segs[] = api_ensure_url_encoded($seg);
    $enc = $parts['scheme'] . '://' . $parts['host'];
    if (isset($parts['port'])) $enc .= ':' . $parts['port'];
    $enc .= implode('/', $segs);
    if (isset($parts['query']))    $enc .= '?' . $parts['query'];
    if (isset($parts['fragment'])) $enc .= '#' . $parts['fragment'];
    return $enc;
}

/** webdav 模式：代理远程原图 */
function api_proxy_remote_original($path, $env) {
    $remoteBase = $env['WEBDAV_BASE_URL'] ?? '';
    $user = $env['WEBDAV_USERNAME'] ?? '';
    $pass = $env['WEBDAV_PASSWORD'] ?? '';
    if ($remoteBase === '' || $user === '' || $pass === '') {
        http_response_code(500);
        header('Content-Type: text/plain; charset=utf-8');
        echo 'api.php: 缺少 WebDAV 配置，请在 .env 设置 WEBDAV_BASE_URL / WEBDAV_USERNAME / WEBDAV_PASSWORD';
        exit;
    }
    if ($path === '') { http_response_code(400); echo 'Missing path parameter'; exit; }

    $decodedPath = ltrim(rawurldecode($path), '/');
    if (strpos($decodedPath, '..') !== false) { http_response_code(403); exit; }

    $targetUrl = api_encode_webdav_url($remoteBase, $decodedPath);

    $headers = [];
    if (isset($_SERVER['HTTP_RANGE'])) $headers[] = 'Range: ' . $_SERVER['HTTP_RANGE'];
    $headers[] = 'Authorization: Basic ' . base64_encode($user . ':' . $pass);

    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL => $targetUrl,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS => 5,
        CURLOPT_TIMEOUT => 30,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_HEADER => true,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => false,
        CURLOPT_HTTPAUTH => CURLAUTH_BASIC,
        CURLOPT_USERPWD => $user . ':' . $pass,
    ]);
    $response = curl_exec($ch);
    $errno = curl_errno($ch);
    $error = curl_error($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $headerSize = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
    curl_close($ch);

    if ($errno) {
        http_response_code(502);
        echo "Proxy error: $error";
        exit;
    }

    $headerStr = substr($response, 0, $headerSize);
    $body = substr($response, $headerSize);
    foreach (explode("\r\n", $headerStr) as $h) {
        if (stripos($h, 'Content-Type:') === 0 ||
            stripos($h, 'Content-Length:') === 0 ||
            stripos($h, 'Accept-Ranges:') === 0 ||
            stripos($h, 'Content-Range:') === 0 ||
            stripos($h, 'Cache-Control:') === 0 ||
            stripos($h, 'ETag:') === 0 ||
            stripos($h, 'Last-Modified:') === 0) {
            header($h);
        }
    }
    http_response_code($httpCode === 206 ? 206 : $httpCode);
    echo $body;
    exit;
}

// ============================================================
// 图片动作分发（二进制输出）
// ============================================================
if ($action === 'thumb' || $action === 'original') {
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Methods: GET, HEAD, OPTIONS');
    header('Access-Control-Allow-Headers: Range');
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') { http_response_code(200); exit; }

    $path = isset($_GET['path']) ? (string)$_GET['path'] : '';

    if ($action === 'thumb') {
        // 缩略图始终来自本地 webp_cache（webdav 模式是同步生成的压缩图，local 模式是原图本身）
        api_serve_local_image($cacheDir, $path, false);
    }

    // original
    if ($isLocal) {
        api_serve_local_image($cacheDir, $path, true);
    } else {
        api_proxy_remote_original($path, $env);
    }
}

// ============================================================
// JSON 动作分发
// ============================================================
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
@ini_set('display_errors', '0');
@ini_set('log_errors', '1');
@ini_set('memory_limit', '512M');

if (!is_dir($cacheDir)) {
    echo json_encode(['error' => 'webp_cache directory not found']);
    exit;
}

// ---------- 目录树 ----------
if ($action === 'getTree') {
    $forceRefresh = isset($_GET['refresh']) && $_GET['refresh'] === 'true';
    if (!$forceRefresh) {
        $cached = api_read_cache($treeCacheFile, $treeCacheTtl);
        if ($cached !== null && isset($cached['data']) && !api_tree_has_files($cached['data'])) {
            echo json_encode([
                'success' => true,
                'tree' => $cached['data'],
                'cached' => true,
                'timestamp' => $cached['timestamp'],
            ]);
            exit;
        }
    }
    $built = api_build_folder_tree($cacheDir, $cacheDir);
    api_write_cache($treeCacheFile, $built['children']);
    echo json_encode([
        'success' => true,
        'tree' => $built['children'],
        'cached' => false,
        'timestamp' => time(),
    ]);
    exit;
}

// ---------- 图片列表 ----------
if ($action === 'getImages') {
    $folderPath = isset($_GET['path']) ? (string)$_GET['path'] : '';
    $targetDir = $cacheDir . ($folderPath ? '/' . $folderPath : '');
    if (!is_dir($targetDir)) { echo json_encode(['error' => 'Directory not found']); exit; }

    $cache = api_read_meta_cache($metaCacheFile);
    $key = 'imgs:' . md5($folderPath);
    if (isset($cache[$key]) && time() - $cache[$key]['timestamp'] <= $metaCacheTtl) {
        echo json_encode([
            'success' => true,
            'images' => $cache[$key]['images'],
            'path' => $folderPath,
            'cached' => true,
            'timestamp' => $cache[$key]['timestamp'],
        ]);
        exit;
    }
    $images = api_get_all_images($targetDir, $cacheDir);
    $cache[$key] = ['timestamp' => time(), 'images' => $images];
    api_write_meta_cache($metaCacheFile, $cache);
    echo json_encode([
        'success' => true,
        'images' => $images,
        'path' => $folderPath,
        'cached' => false,
        'timestamp' => time(),
    ]);
    exit;
}

// ---------- 文件名搜索 ----------
if ($action === 'search') {
    $keyword = isset($_GET['keyword']) ? (string)$_GET['keyword'] : '';
    $cached = api_read_cache($nameIndexFile, $metaCacheTtl);
    if ($cached === null || !isset($cached['data'])) {
        $allImages = api_build_name_index($cacheDir, $cacheDir);
        api_write_cache($nameIndexFile, $allImages);
    } else {
        $allImages = $cached['data'];
    }
    if ($keyword !== '') {
        $allImages = array_values(array_filter($allImages, function ($img) use ($keyword) {
            return api_match_search_keyword($img['name'], $keyword);
        }));
    }
    echo json_encode(['success' => true, 'images' => $allImages]);
    exit;
}

// ---------- README ----------
if ($action === 'readme') {
    $requestPath = isset($_GET['path']) ? (string)$_GET['path'] : '';
    if ($requestPath === '') { http_response_code(400); echo json_encode(['error' => 'Missing path parameter']); exit; }

    $requestPath = urldecode($requestPath);
    $requestPath = preg_replace('#/+#', '/', $requestPath);
    $requestPath = trim($requestPath, '/');
    if (strpos($requestPath, '..') !== false || strpos($requestPath, '\\') !== false) {
        http_response_code(403);
        echo json_encode(['error' => 'Path traversal not allowed']);
        exit;
    }

    $fullPath = realpath($cacheDir);
    if ($fullPath === false) { http_response_code(404); echo json_encode(['error' => 'Cache root not found']); exit; }
    $targetDir = realpath($fullPath . '/' . $requestPath);
    if ($targetDir === false || strpos($targetDir, $fullPath) !== 0) {
        http_response_code(404);
        echo json_encode(['error' => 'Folder not found']);
        exit;
    }

    $readmeFiles = ['README.md', 'readme.md', 'README.txt', 'readme.txt', 'README', 'readme'];
    foreach ($readmeFiles as $file) {
        $filePath = $targetDir . '/' . $file;
        if (file_exists($filePath) && is_file($filePath)) {
            $type = strtolower(pathinfo($file, PATHINFO_EXTENSION));
            if ($type === '') $type = 'txt';
            echo json_encode([
                'hasReadme' => true,
                'type' => $type,
                'content' => file_get_contents($filePath),
                'file' => $file,
            ], JSON_UNESCAPED_UNICODE);
            exit;
        }
    }
    echo json_encode(['hasReadme' => false]);
    exit;
}

echo json_encode(['error' => 'Invalid action']);
