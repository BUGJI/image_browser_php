/**
 * App - 主应用入口
 * 初始化所有服务、组件、事件绑定
 */
import { eventBus, EVENTS } from './core/EventBus.js';
import { appStore } from './core/Store.js';
import { Storage } from './core/Storage.js';
import { STORAGE_KEYS, CACHE_TTL } from './core/Config.js';
import { api } from './services/ApiService.js';
import { Sidebar } from './components/Sidebar.js';
import { MasonryGrid } from './components/MasonryGrid.js';
import { Lightbox } from './components/Lightbox.js';
import { debounce, formatSize, getColumns, getOriginalName, formatDateTime } from './utils/helpers.js';
import { icon, hydrateIcons } from './utils/icons.js';

export class App {
  constructor() {
    this.sidebar = null;
    this.grid = null;
    this.lightbox = null;
    this.currentFetchController = null;
    this.init();
  }

  async init() {
    // 0. 填充静态图标 + 清理过期缓存（防止配额超限），不做 LRU 淘汰以免误删折叠状态
    hydrateIcons();
    Storage.cleanExpired();

    // 1. 恢复主题
    const theme = Storage.get(STORAGE_KEYS.THEME) || 'dark';
    document.body.classList.toggle('light-theme', theme === 'light');
    document.getElementById('themeToggle').innerHTML = icon(theme === 'light' ? 'sun' : 'moon', 16);

    // 2. 恢复折叠状态（区分「从未保存」与「保存为空」，首次使用默认全折叠）
    const rawCollapsed = Storage.get(STORAGE_KEYS.COLLAPSED_FOLDERS);
    this.hasCollapsedPref = rawCollapsed !== null;
    appStore.set('collapsedFolders', new Set(rawCollapsed || []));

    // 3. 初始化组件
    this.sidebar = new Sidebar();
    this.grid = new MasonryGrid();
    this.lightbox = new Lightbox();

    // 4. 绑定全局事件
    this.bindGlobalEvents();

    // 5. 显示上次缓存更新时间
    this.updateCacheTime();

    // 6. 加载目录树
    await this.loadFolderTree();
  }

  /** 全局事件绑定 */
  bindGlobalEvents() {
    // 主题切换
    document.getElementById('themeToggle').onclick = () => this.toggleTheme();

    // 侧边栏
    document.getElementById('folderFilter').addEventListener('input', () => this.sidebar.filter());
    window.toggleSidebar = () => document.getElementById('sidebar').classList.toggle('open');
    window.filterFolders = () => this.sidebar.filter();

    // 搜索
    const $search = document.getElementById('imageSearch');
    const $clear = document.getElementById('searchClear');
    const syncClear = () => { $clear.hidden = !$search.value; };
    $search.addEventListener('input', debounce(() => {
      syncClear();
      if (!$search.value.trim()) {
        // 清空搜索框：取消未完成的搜索请求，回到当前文件夹
        this.cancelSearch();
        this.selectFolder(appStore.get('currentFolderPath'), appStore.get('currentFolderName'));
      } else {
        this.search($search.value);
      }
    }, 300));
    $clear.addEventListener('click', () => {
      $search.value = '';
      syncClear();
      this.cancelSearch();
      this.selectFolder(appStore.get('currentFolderPath'), appStore.get('currentFolderName'));
      $search.focus();
    });
    window.debouncedSearch = () => this.search($search.value);

    // 缩放
    document.getElementById('zoomSlider').addEventListener('input', (e) => {
      const z = parseFloat(e.target.value);
      appStore.set('zoom', z);
      eventBus.emit(EVENTS.ZOOM_CHANGED, z);
    });
    window.updateZoom = () => eventBus.emit(EVENTS.ZOOM_CHANGED, appStore.get('zoom'));

    // 刷新
    document.getElementById('refreshBtn').onclick = () => this.refresh();
    window.clearCacheAndReload = () => this.clearCacheAndReload();
    window.refreshImages = () => this.refreshImages();

    // 灯箱
    window.closeLightbox = () => this.lightbox?.close?.();
    window.closeLightboxOnBg = (e) => { if (e.target === e.currentTarget) this.lightbox?.close?.(); };
    window.navLightbox = (dir) => this.lightbox?.nav?.(dir);

    // 事件总线订阅
    this.bindStoreEvents();
  }

  /** Store 事件订阅 */
  bindStoreEvents() {
    // 文件夹选择
    eventBus.on(EVENTS.FOLDER_SELECTED, ({ path, name }) => {
      this.selectFolder(path, name);
    });

    // 缩放变化
    eventBus.on(EVENTS.ZOOM_CHANGED, (zoom) => this.grid?.recalc());

    // 折叠状态
    appStore.subscribe('collapsedFolders', (val) => {
      this.sidebar?.updateCollapsed(val);
      Storage.set(STORAGE_KEYS.COLLAPSED_FOLDERS, [...val]);
    });

    // Toast
    eventBus.on(EVENTS.TOAST_SHOW, ({ message, type }) => this.showToast(message, type));
  }

  /** 加载目录树 */
  async loadFolderTree(force = false) {
    try {
      const tree = await api.getTree(force);
      appStore.set('folderTree', tree);
      // 首次使用（无折叠偏好记录）：默认全部折叠
      if (!this.hasCollapsedPref && tree.length) {
        const all = [];
        (function collect(nodes) {
          nodes.forEach(n => {
            if (n.type === 'folder') {
              all.push(n.path);
              collect(n.children || []);
            }
          });
        })(tree);
        appStore.set('collapsedFolders', new Set(all));
      }
      this.sidebar?.render(tree);
      eventBus.emit(EVENTS.FOLDER_TREE_LOADED, tree);
      this.updateCacheTime();
      if (tree.length && !appStore.get('currentFolderPath')) {
        // 自动选中第一个文件夹
        const first = tree[0];
        this.selectFolder(first.path, first.name);
      }
    } catch (e) {
      this.showToast('目录加载失败', 'error');
    }
  }

  /** 刷新缓存更新时间显示 */
  updateCacheTime() {
    const $el = document.getElementById('cacheUpdatedAt');
    if (!$el) return;
    const ts = Storage.get(STORAGE_KEYS.CACHE_UPDATED_AT);
    $el.innerHTML = icon('package', 12) + ' 上次更新: ' + formatDateTime(ts);
  }

  /** 选择文件夹 */
  async selectFolder(path, name) {
    // 取消上一个进行中的请求
    if (this.currentFetchController) {
      this.currentFetchController.abort();
    }
    this.currentFetchController = new AbortController();

    appStore.setMultiple({ currentFolderPath: path, currentFolderName: name });
    document.getElementById('currentPath').textContent = name || path;
    document.getElementById('imageSearch').value = '';
    const $clear = document.getElementById('searchClear');
    if ($clear) $clear.hidden = true;
    this.sidebar?.updateActive(path);
    if (window.innerWidth <= 768) document.getElementById('sidebar').classList.remove('open');

    // 退出搜索模式，恢复 README 显示
    this.grid?.setSearchMode(false);

    // 加载对应的 README（不阻塞）
    this.grid?.loadReadmeForFolder(path);

    try {
      // 先尝试缓存 - 立即显示，不等待
      const cacheKey = STORAGE_KEYS.FOLDER_IMAGES_PREFIX + path;
      let images = Storage.get(cacheKey);

      if (images) {
        // 缓存数据可能缺少 originalName，补充一下
        images = images.map(img => ({
          ...img,
          originalName: img.originalName || getOriginalName(img.name),
          sizeFormatted: img.sizeFormatted || formatSize(img.size)
        }));
        appStore.setMultiple({ images, filteredImages: images });
        this.grid?.setImages(images);
        this.showToast(`${images.length} 张 (缓存)`, 'info');
        // 后台静默刷新
        this.fetchFresh(path, this.currentFetchController.signal);
      } else {
        // 显示加载状态
        this.grid?.setLoading(true);
        await this.fetchImages(path, this.currentFetchController.signal);
        this.grid?.setLoading(false);
      }
    } catch (e) {
      if (e.name !== 'AbortError') {
        this.showToast('加载失败: ' + e.message, 'error');
      }
      this.grid?.setLoading(false);
    }
  }

/** 获取图片 */
  async fetchImages(path, signal) {
    try {
      const images = await api.getImages(path, signal);
      // 添加 originalName 字段（去除 .webp 后缀）
      const processed = images.map(img => ({
        ...img,
        originalName: getOriginalName(img.name),
        sizeFormatted: formatSize(img.size)
      }));
      const cacheKey = STORAGE_KEYS.FOLDER_IMAGES_PREFIX + path;
      Storage.set(cacheKey, processed, CACHE_TTL.IMAGES);
      appStore.setMultiple({ images: processed, filteredImages: processed });
      this.grid?.setImages(processed);
    } catch (e) {
      if (e.name !== 'AbortError') {
        console.error('[App] fetchImages error:', e);
        this.showToast('图片加载失败: ' + e.message, 'error');
      }
      throw e;
    }
  }
  /** 后台刷新 */
  async fetchFresh(path, signal) {
    try {
      const images = await api.getImages(path, signal);
      const processed = images.map(img => ({
        ...img,
        originalName: getOriginalName(img.name),
        sizeFormatted: formatSize(img.size)
      }));
      if (appStore.get('currentFolderPath') === path && !document.getElementById('imageSearch').value.trim()) {
        const cacheKey = STORAGE_KEYS.FOLDER_IMAGES_PREFIX + path;
        Storage.set(cacheKey, processed, CACHE_TTL.IMAGES);
        if (processed.length !== appStore.get('images').length) {
          appStore.setMultiple({ images: processed, filteredImages: processed });
          this.grid?.setImages(processed);
        }
      }
    } catch (e) {
      if (e.name !== 'AbortError') console.warn('[App] fetchFresh error:', e);
    }
  }

  /** 搜索 */
  async search(keyword) {
    if (!keyword.trim()) {
      const path = appStore.get('currentFolderPath');
      if (path) await this.selectFolder(path, appStore.get('currentFolderName'));
      return;
    }
    // 取消上一个搜索请求，避免旧任务残留（竞态）
    if (this.searchController) this.searchController.abort();
    this.searchController = new AbortController();
    try {
      this.grid?.setSearchMode(true); // 搜索时隐藏 README
      const images = await api.search(keyword, this.searchController.signal);
      const processed = images.map(img => ({
        ...img,
        originalName: getOriginalName(img.name),
        sizeFormatted: formatSize(img.size)
      }));
      appStore.set('filteredImages', processed);
      this.grid?.setImages(processed);
      this.showToast(`${processed.length} 张 (搜索)`, 'info');
    } catch (e) {
      if (e.name !== 'AbortError') this.showToast(e.message || '搜索失败', 'error');
    }
  }

  /** 取消未完成的搜索请求 */
  cancelSearch() {
    if (this.searchController) {
      this.searchController.abort();
      this.searchController = null;
    }
  }

  /** 主题切换 */
  toggleTheme() {
    const isLight = document.body.classList.toggle('light-theme');
    Storage.set(STORAGE_KEYS.THEME, isLight ? 'light' : 'dark');
    document.getElementById('themeToggle').innerHTML = icon(isLight ? 'sun' : 'moon', 16);
    this.showToast(isLight ? '亮色主题' : '暗色主题', 'info');
  }

  /** 刷新当前文件夹 */
  refreshImages() {
    const path = appStore.get('currentFolderPath');
    if (path) this.fetchImages(path);
    else this.loadFolderTree(true);
  }

  /** 清除缓存并重载 */
  clearCacheAndReload() {
    Storage.clearAll();
    this.updateCacheTime();
    this.showToast('缓存已清除，重新加载', 'success');
    this.loadFolderTree(true);
  }

  /** Toast 提示 */
  showToast(msg, type = 'success') {
    const $toast = document.getElementById('toast');
    const iconName = type === 'error' ? 'alert' : type === 'info' ? 'info' : 'check';
    $toast.innerHTML = `<span class="toast-icon">${icon(iconName, 16)}</span><span class="toast-text"></span>`;
    $toast.querySelector('.toast-text').textContent = msg;
    $toast.className = `toast toast-${type} show`;
    setTimeout(() => $toast.classList.remove('show'), 2500);
  }

  /** 刷新 */
  refresh() { 
    this.refreshImages();
    this.loadFolderTree(true); // 同时强制刷新目录树
  }
}