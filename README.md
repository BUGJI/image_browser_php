> 此项目同样有同类型桌面端软件，针对本地体验进行全面优化：[image_browser](https://github.com/BUGJI/image_browser)

# PHP 快速图片浏览器

一个基于 **PHP + 原生 JavaScript** 的高性能 Web 图片浏览器,面向**数万张图片**的大型素材库。

瀑布流/正方形虚拟滚动、递归目录树、全局搜索、灯箱预览

<img width="750" height="400" alt="image" src="https://github.com/user-attachments/assets/ac71437f-a161-4585-b2a2-7ddac47d6da6" />

---

## ✨ 核心功能

### 🖼️ 高性能图片浏览
- **虚拟化瀑布流布局** —— 仅渲染可视区域图片,轻松应对数万张图片
- **懒加载 + 骨架屏** —— 缩略图按需加载,加载中显示占位动画
- **自动高度修正** —— 图片加载完成后自动校正卡片高度,防止布局跳动
- **双视图模式** —— **瀑布流**(按原始比例) / **正方形**(固定方格,图片 `object-fit: cover` 等比裁剪填满),工具栏一键切换并记忆
- **可调缩放 (0.5x ~ 7x)** —— 滑块实时调整缩略图大小,布局自动重排
- **文件夹 README 预览** —— 自动识别并渲染**子文件夹**下的 `README.md/txt`,支持 Markdown 渲染

### 📁 智能目录树
- **递归文件夹树** —— 递归扫描 `webp_cache` 目录,显示层级结构
- **图片计数** —— 每个文件夹显示包含图片数量(含子文件夹)
- **折叠/展开持久化** —— 折叠状态保存到 `localStorage`,刷新保持
- **文件夹筛选** —— 实时搜索过滤文件夹名称
- **一键刷新/清除缓存** —— 强制重新扫描目录,清理本地缓存

### 🔍 图片搜索
- **全局模糊搜索** —— 按文件名搜索所有文件夹图片
- **实时防抖** —— 300ms 防抖,输入即搜
- **结果计数** —— 显示搜索结果数量

### 🔍 灯箱预览
- **全屏查看** —— ESC/关闭按钮关闭;未缩放时点击图片外的空白区域也可返回主界面
- **键盘导航** ←/→ 切换(自动跳过 README 等非图片项),双击重置缩放
- **鼠标滚轮缩放** —— 以鼠标为中心缩放 (0.25x ~ 10x)
- **拖拽平移** —— 缩放后按住鼠标拖动查看大图
- **原图加载** —— 点击「原图模式」加载高清原图(webdav 模式经 `api.php` 代理远程,local 模式直接读本地)
- **图片信息** —— 显示文件名、尺寸、格式、大小、修改时间

### 🎨 交互体验
- **亮/暗主题切换** —— 一键切换,状态持久化
- **响应式布局** —— 侧边栏移动端抽屉式打开,桌面端固定
- **Toast 提示** —— 操作反馈(成功/错误/信息),自动消失
- **键盘快捷键** —— ESC 关灯箱,←/→ 切图

---

## 💾 存储模式

由 `.env` 的 `STORAGE_MODE` 控制,两种模式共用同一个 `webp_cache/` 目录:

| 模式 | 值 | 行为 |
|------|----|------|
| **WebDAV 模式**(默认) | `webdav` | 从远程 WebDAV 拉取原图 → 压缩进 `webp_cache`,`api.php?action=original` 代理远程原图 |
| **本地原图模式** | `local` | 网站直接展示 `webp_cache/` 内的原图,不远程拉取、不启用同步;`api.php?action=original` 直接读本地文件 |

```bash
# .env
STORAGE_MODE=webdav   # 或 local
```

- **local**:先在 `webp_cache/` 下**新建一个子文件夹**,再把原图(png / jpg / jpeg / webp / gif)和可选的 `README.md` 放进去;改完在 admin 面板点「强制重建目录树」生效。admin 面板会隐藏 WebDAV 同步相关界面。
- **webdav**:保持原有行为,使用下方同步任务把远程素材压缩到 `webp_cache`。

> ⚠️ 无论哪种模式,**图片和 README 都必须位于 `webp_cache/` 的子文件夹中**;放在根目录的文件不会被目录树列出、也不会显示。需要多个分类时,建立多个子文件夹即可(支持嵌套)。

---

## 🔄 WebDAV 同步

> 仅在 `STORAGE_MODE=webdav` 时可用。

将远程 WebDAV 原图同步压缩到本地 `webp_cache`(命名 `xxx.原扩展.webp`,与浏览器读取一致)。

### 同步配置(admin 面板)
白名单扩展名、黑名单、压缩质量、最大宽度均在 `admin.php` 的「WebDAV 同步任务」卡片中设置,保存到 `.sync_config.json`(优先级高于内置默认,无需改 `.env`)。
- **黑名单**:按目录/文件名匹配(任意层级同名,如 `.seekMeta`、`Thumbs.db`),逗号分隔。

### 增量 / 全量
| 模式 | 行为 | 使用场景 |
|------|------|----------|
| **增量** | 只拉取新增/变化文件(manifest 比对 mtime) | 日常增量更新 |
| **全量** | 忽略 manifest,重新下载压缩全部 | 首次部署 / 想重压全部 |

> 受服务器禁用后台进程限制,Web 面板同步采用前端分批轮询,**转换期间请勿关闭页面**;中途关闭可重开页面点「增量同步」断点续传。

### 压缩策略
- 图片(png/jpg/jpeg/webp):下载 → 等比缩放(宽 > max_width 时)→ 压缩 webp → 命名 `xxx.原扩展.webp`
- gif:直接复制保留动画(转 webp 会丢动画)
- md/txt 等:原样复制

---

## 🏗️ 技术架构

### 后端
| 文件 | 功能 |
|------|------|
| `api.php` | **统一接口**:目录树 / 图片列表 / 搜索 / README / 缩略图 / 原图 |
| `admin.php` | Admin 管理面板(缓存状态与管理 + WebDAV 同步任务) |
| `sync_webdav.php` | WebDAV 同步引擎(远程原图 → 本地 webp_cache,增量/全量) |
| `env.php` | 轻量 .env 加载器 |
| `.env` / `.env.example` | 环境配置(WebDAV 凭据、ADMIN_TOKEN、STORAGE_MODE),复制 example 为 .env 填写 |
| `.htaccess` | 拦截 .env、缓存文件的直接访问(Apache 环境) |
| `.gitignore` | 忽略 .env、运行时缓存等,防止误提交 |

`api.php` 动作一览:

| 请求 | 返回 | 说明 |
|------|------|------|
| `api.php?action=getTree` | JSON | 目录树(可加 `&refresh=true` 强制重建) |
| `api.php?action=getImages&path=目录` | JSON | 文件夹图片列表 |
| `api.php?action=search&keyword=词` | JSON | 文件名搜索(支持 `*` `?`) |
| `api.php?action=readme&path=目录` | JSON | 文件夹 README(md/txt) |
| `api.php?action=thumb&path=文件` | 图片 | 缩略图,读取本地 `webp_cache` |
| `api.php?action=original&path=文件` | 图片 | 原图,按 `STORAGE_MODE` 本地读取或远程代理 |

### 前端
```
js/
├── main.js                 # 入口
├── app.js                  # App 主控制器
├── core/
│   ├── Config.js           # 配置常量
│   ├── EventBus.js         # 事件总线
│   ├── Store.js            # 状态管理
│   └── Storage.js          # localStorage 封装(TTL/LRU)
├── services/
│   ├── ApiService.js       # 统一 API 调用
│   └── ImageService.js     # 原图预加载
├── components/
│   ├── Sidebar.js          # 侧边栏目录树
│   ├── MasonryGrid.js      # 瀑布流网格
│   ├── Lightbox.js         # 灯箱预览
│   └── ReadmeDisplay.js    # README 渲染
└── utils/helpers.js        # 工具函数
```

---

## 🚀 快速开始

### 环境要求
- **PHP 7.4+**(需开启 `curl`、`gd` 扩展;WebDAV 同步需 `simplexml`)
- 现代浏览器(支持 ES Modules、IntersectionObserver、AbortController)

### 部署
```bash
# 1. 复制环境配置并填写
cp .env.example .env
# 2. 编辑 .env:填入 WebDAV 凭据、ADMIN_TOKEN(强随机口令)
# 3. 将项目放入 PHP 服务器目录(如 Apache/Nginx/PHP 内置服务器)
# 4. 在 webp_cache 下新建子文件夹,并放入图片 / README(结构见下;根目录文件不显示)
# 5. 启动 PHP 服务
php -S localhost:8080 -t .
# 6. 浏览器打开 http://localhost:8080
# 7.(可选)管理面板 http://localhost:8080/admin.php(需 .env 中 ADMIN_TOKEN)
```

### 目录结构要求

```
image_browser/
├── webp_cache/                    # 图片根目录(缺失会自动创建)
│   ├── 分类A/                     # ← 必须新建子文件夹,图片/README 放这里
│   │   ├── image1.webp
│   │   ├── image2.png
│   │   └── README.md              # 可选:该文件夹的说明(md/txt)
│   └── 分类B/
│       └── 子分类/                # 支持多层嵌套
│           └── image3.jpg
├── api.php
├── index.html
├── js/
└── css/
```

> ❌ 错误:`webp_cache/封面.png`、`webp_cache/README.md` —— 根目录文件不会被目录树列出,也不会显示
> ✅ 正确:先建一个子文件夹(如 `webp_cache/我的素材/`),再把图片与 README 放进去

## ⌨️ 快捷键

| 按键 | 功能 |
|------|------|
| `ESC` | 关闭灯箱 / 关闭移动端侧边栏 |
| `←` / `→` | 灯箱切换上/下一张 |
| `滚轮` | 灯箱缩放(以鼠标为中心) |
| `双击图片` | 重置灯箱缩放/位置 |

---

## ⚙️ 配置说明

`js/core/Config.js` 中可调整:
```js
export const CONFIG = {
  API_BASE: '',                    // API 基础路径(同源留空)
  ORIGINAL_IMAGE_ENDPOINT: 'api.php?action=original',
  ENDPOINTS: {
    TREE: 'api.php?action=getTree',
    IMAGES: 'api.php?action=getImages',
    SEARCH: 'api.php?action=search',
  },
  CACHE_TTL: {
    TREE: 30 * 24 * 60 * 60 * 1000,  // 目录树缓存 30 天
    IMAGES: 30 * 24 * 60 * 60 * 1000, // 图片列表缓存 30 天
  },
};
```

`.env` 关键项:

| 变量 | 说明 |
|------|------|
| `STORAGE_MODE` | 存储模式:`webdav`(默认,远程拉取同步) / `local`(网站本地原图,直接展示) |
| `WEBDAV_BASE_URL` | 原图代理的远程 WebDAV 根目录(含空格/中文会自动编码,仅 webdav 模式) |
| `WEBDAV_USERNAME` / `WEBDAV_PASSWORD` | WebDAV 凭据 |
| `ADMIN_TOKEN` | Admin 面板管理口令 |
| `SYNC_BATCH_SIZE` | 同步每批处理文件数(白名单/黑名单/质量/最大宽度请在 admin 面板设置) |

---

## 📦 缓存机制

| 缓存项 | Key 前缀 | TTL | 存储位置 | 备注 |
|--------|----------|-----|----------|------|
| 目录树 | `folder_tree` | 30 天 | localStorage | 超 500KB 不缓存 |
| 文件夹图片 | `folder_images_{path}` | 30 天 | localStorage | 超 500KB 不缓存 |
| 后端目录树缓存 | `.folder_tree_cache.json` | 30 天 | 服务器文件 | 单次遍历、仅文件夹节点 |
| 后端图片元数据缓存 | `.images_meta_cache.json` | 30 天 | 服务器文件 | 避免重复 getimagesize |
| 折叠状态 | `collapsed_folders` | 永久 | localStorage | Set 序列化(首次默认全折叠) |
| 主题 | `theme` | 永久 | localStorage | 'light'/'dark' |
| 视图模式 | `view_mode` | 永久 | localStorage | 'masonry'(瀑布流)/'grid'(正方形) |
| 缓存更新时间 | `cache_updated_at` | 30 天 | localStorage | 底部「清除缓存」旁显示 |
| 原图预加载 | - | 会话期 | Memory (Map) | LRU 最大 50 张 |

> 存储配额接近时自动清理过期项(`Storage.cleanExpired()`),不做 LRU 淘汰以保护折叠状态。

---

## 🐛 常见问题

**Q: 放进 `webp_cache` 的图片 / README 不显示?**  
A: 大概率是放在了**根目录**。请先在 `webp_cache/` 下新建一个**子文件夹**,把图片和 `README.md` 放进去,再到 admin 面板点「强制重建目录树」。根目录下的文件不会被目录树列出。

**Q: 图片不显示/404?**  
A: 检查 `webp_cache` 目录权限、`api.php?action=thumb` 路径解析、`open_basedir` 限制。

**Q: 缩略图模糊?**  
A: 缩略图由 `api.php?action=thumb` 直接读取本地 `webp_cache` 文件,非临时压缩。如需压缩可先跑 WebDAV 同步(admin 面板)生成 webp 缩略图。

**Q: 原图加载失败?**  
A: 确认 `.env` 的 WebDAV 凭据正确;路径含空格/中文时脚本会自动百分号编码,无需手动转义。

**Q: WebDAV 同步偶发失败?**  
A: 同步采用前端分批轮询,单请求需在 300s 内完成;请只保留一个 admin 页面,转换期间勿关闭页面。

**Q: 想换端口/域名?**  
A: 修改 `Config.js` 中 `API_BASE`;跨域需配置 PHP `Access-Control-Allow-Origin`。

---

## 📄 许可证
MIT License — 仅供学习交流。
