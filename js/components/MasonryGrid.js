/**
 * MasonryGrid - 瀑布流图片网格
 */
import { eventBus, EVENTS } from '../core/EventBus.js';
import { appStore } from '../core/Store.js';
import { api } from '../services/ApiService.js';
import { debounce, getColumns, formatSize, getOriginalName, escapeHtml } from '../utils/helpers.js';
import { icon } from '../utils/icons.js';
import { ReadmeDisplay } from './ReadmeDisplay.js';

export class MasonryGrid {
  #vpPadding = 12;

  constructor() {
    this.$scroll = document.getElementById('masonryScroll');
    this.$spacer = document.getElementById('masonrySpacer');
    this.$viewport = document.getElementById('masonryViewport');
    this.$count = document.getElementById('imageCount');

    this.layout = [];
    this.rendered = new Map();
    this.actualHeights = new Map();
    this.pendingUpdates = new Set();
    this.pathToItem = new Map(); // path -> layout item 索引，避免 O(n) 查找
    this.updateTimer = null;
    this.raf = false;

    this.readmeDisplay = new ReadmeDisplay();
    this.readmeEl = null;
    this.searchMode = false;
    this.viewMode = 'masonry'; // 'masonry' 瀑布流 | 'grid' 正方形
    this.bindEvents();
  }

  /** 切换视图模式：masonry 瀑布流 / grid 正方形（cover 裁剪） */
  setViewMode(mode) {
    this.viewMode = mode === 'grid' ? 'grid' : 'masonry';
    this.$viewport.classList.toggle('view-grid', this.viewMode === 'grid');
    this.$viewport.classList.toggle('view-masonry', this.viewMode !== 'grid');
    this.recalc();
  }

  bindEvents() {
    appStore.subscribe('filteredImages', (imgs) => {
      this.actualHeights.clear();
      this.reload(imgs);
    });

    appStore.subscribe('zoom', () => this.recalc());

    this.$scroll.addEventListener('scroll', () => this.scheduleRender());

    window.addEventListener('resize', debounce(() => this.recalc(), 200));
  }

  /** 加载文件夹对应的 README */
  async loadReadmeForFolder(folderPath) {
    // 同步清理旧 README：立即把它从布局中移除，避免滞留到新文件夹
    if (this.readmeEl) {
      this.readmeEl = null;
      if (this.layout.some(it => it.isReadme)) this.recalc();
    }
    if (!folderPath) return;

    const el = await this.readmeDisplay.loadReadme(folderPath);
    // 竞态保护：等待期间可能已切换到别的文件夹，丢弃过期结果
    if (this.readmeDisplay.currentPath !== folderPath) return;
    this.readmeEl = el;
    if (this.readmeEl) this.recalc();
  }

  reload(images) {
    // 图片集合变化（刷新 / 切换文件夹）：整体重建，保留进入动画
    this.$count.textContent = `${images.length} 张`;
    this.resetRendered();
    this.$viewport.innerHTML = '';
    this.actualHeights.clear();
    this.recalc();
  }

  /** 兼容旧调用 */
  setImages(images) { this.reload(images); }

  /** 设置搜索模式：搜索时隐藏 README 卡片，退出时恢复 */
  setSearchMode(on) {
    if (this.searchMode === on) return;
    this.searchMode = on;
    this.recalc();
  }

  /** 移除所有已渲染卡片 */
  resetRendered() {
    this.rendered.forEach(el => el.remove());
    this.rendered.clear();
  }

  /** 显示/隐藏加载状态 */
  setLoading(loading) {
    if (loading) {
      this.resetRendered();
      this.$viewport.innerHTML = '<div class="loading-overlay"><div class="spinner"></div><div>加载中...</div></div>';
    }
  }

  recalc() {
    const images = appStore.get('filteredImages');
    const hasReadme = !!this.readmeEl && !this.searchMode;

    // 既无图片也无 README：显示空状态
    if (!images.length && !hasReadme) {
      this.layout = [];
      this.pathToItem.clear();
      this.resetRendered();
      appStore.set('layout', []);
      this.$spacer.style.height = '0px';
      this.$viewport.innerHTML = `<div class="empty-state">${icon('inbox', 28)}<div>空文件夹</div></div>`;
      return;
    }

    const cols = getColumns(this.$scroll.clientWidth, appStore.get('zoom'));
    const cw = this.$scroll.clientWidth;
    const gap = 8;
    const contentTopPadding = 10; // 内容顶部间距
    const cardW = (cw - this.#vpPadding * 2 - gap * (cols - 1)) / cols;

    const colHeights = new Array(cols).fill(contentTopPadding);
    const newLayout = [];

    // README 固定放在首位（跨列），固定高度 200px；搜索模式下不显示。
    // 即使没有任何图片也照常布局，保证「仅 README」的文件夹也能正确显示。
    if (hasReadme) {
      const README_HEIGHT = 200;
      newLayout.push({
        key: '__readme__',
        index: -1,
        col: 0,
        top: contentTopPadding,
        left: this.#vpPadding,
        w: cw - this.#vpPadding * 2,
        h: README_HEIGHT,
        img: null,
        isReadme: true
      });
      for (let c = 0; c < cols; c++) colHeights[c] = README_HEIGHT + gap + contentTopPadding;
    }

    const isGrid = this.viewMode === 'grid';

    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      // 正方形模式：每个格子固定为宽高相等（图片用 object-fit: cover 等比裁剪填满）
      const cardH = isGrid ? cardW :
        (this.actualHeights.get(img.path) ||
          (img.width && img.height ? cardW / (img.width / img.height) : cardW * 0.75));

      let minCol = 0;
      for (let c = 1; c < cols; c++) if (colHeights[c] < colHeights[minCol]) minCol = c;

      newLayout.push({
        key: img.path,
        index: i,
        col: minCol,
        top: colHeights[minCol],
        left: this.#vpPadding + minCol * (cardW + gap),
        w: cardW,
        h: cardH,
        img
      });

      colHeights[minCol] += cardH + gap;
    }

    this.layout = newLayout;
    // 重建 path -> item 索引
    this.pathToItem.clear();
    for (const it of newLayout) {
      if (it.img) this.pathToItem.set(it.img.path, it);
    }
    appStore.set('layout', newLayout);
    this.$spacer.style.height = Math.max(...colHeights, 0) + 'px';
    // 不重建卡片：renderVisible 会按 key 复用现有卡片，仅更新位置，避免缩放时重放进入动画
    this.renderVisible();
  }

  renderVisible() {
    if (!this.layout.length) return;

    const st = this.$scroll.scrollTop;
    const vh = this.$scroll.clientHeight;
    const buf = vh * 2;
    const vStart = st - buf, vEnd = st + vh + buf;

    // key -> item（当前布局）
    const itemByKey = new Map();
    for (const it of this.layout) itemByKey.set(it.key, it);

    // 可见（含缓冲）需要展示的
    const need = new Map();
    for (const it of this.layout) {
      if (it.top + it.h >= vStart && it.top <= vEnd) need.set(it.key, it);
    }

    // 回收移出较大缓冲区的卡片
    const relBuf = vh * 3;
    const rStart = st - relBuf, rEnd = st + vh + relBuf;
    for (const [key, el] of [...this.rendered]) {
      const it = itemByKey.get(key);
      if (!it || it.top + it.h < rStart || it.top > rEnd) {
        el.remove();
        this.rendered.delete(key);
      }
    }

    // 新增或复用卡片（复用只更新几何，不重放动画）
    const frag = document.createDocumentFragment();
    for (const [key, item] of need) {
      const existing = this.rendered.get(key);
      if (existing) {
        this.positionCard(existing, item);
      } else {
        const card = this.createCard(item);
        this.positionCard(card, item);
        frag.appendChild(card);
        this.rendered.set(key, card);
      }
    }
    if (frag.children.length) this.$viewport.appendChild(frag);
  }

  /** 设置卡片几何（复用卡片时避免重建） */
  positionCard(el, item) {
    el.style.left = item.left + 'px';
    el.style.top = item.top + 'px';
    el.style.width = item.w + 'px';
    el.style.height = item.h + 'px';
  }

  createCard(item) {
    const { img, isReadme } = item;

    // README 卡片
    if (isReadme) {
      const card = this.readmeEl;
      card.className = 'readme-card';
      return card;
    }

    // 普通图片卡片
    const card = document.createElement('div');
    card.className = 'pic-card';
    card.dataset.key = item.key;

    card.onclick = () => {
      // 按 key 查当前布局索引（README 会改变索引，不能缓存在闭包里）
      const idx = appStore.get('layout').findIndex(it => it.key === item.key);
      if (idx >= 0) eventBus.emit(EVENTS.LIGHTBOX_OPEN, idx);
    };

    const skel = document.createElement('div');
    skel.className = 'pic-skeleton';
    card.appendChild(skel);

    const imgEl = document.createElement('img');
    imgEl.loading = 'lazy';
    imgEl.src = api.getThumbnailUrl(img.path);
    imgEl.onload = () => {
      skel.style.display = 'none';
      imgEl.classList.add('loaded');
      const nw = imgEl.naturalWidth, nh = imgEl.naturalHeight;
      if (nw && nh && this.viewMode !== 'grid') {
        // 用当前布局宽度计算，兼容加载完成前已缩放的情况（正方形模式高度固定，无需修正）
        const cur = this.pathToItem.get(img.path);
        const curW = cur ? cur.w : item.w;
        const curH = cur ? cur.h : item.h;
        const dh = (nh / nw) * curW;
        if (dh > 0 && Math.abs(dh - curH) > 5) this.scheduleHeightUpdate(img.path, dh);
      }
    };
    imgEl.onerror = () => { skel.style.display = 'none'; imgEl.classList.add('loaded'); };
    card.appendChild(imgEl);

    const ov = document.createElement('div');
    ov.className = 'pic-overlay';
    ov.innerHTML = `<div class="pic-name">${escapeHtml(img.name)}</div><div class="pic-meta">${img.format || ''} ${img.sizeFormatted || ''}</div>`;
    card.appendChild(ov);

    return card;
  }

  scheduleHeightUpdate(path, h) {
    if (this.actualHeights.get(path) === h) return;
    this.actualHeights.set(path, h);
    this.pendingUpdates.add(path);
    if (this.updateTimer) clearTimeout(this.updateTimer);
    if (this.pendingUpdates.size >= 10) this.flushHeightUpdates();
    else this.updateTimer = setTimeout(() => this.flushHeightUpdates(), 100);
  }

  flushHeightUpdates() {
    if (this.updateTimer) clearTimeout(this.updateTimer);
    if (!this.pendingUpdates.size) return;
    let changed = false;
    for (const p of this.pendingUpdates) {
      const item = this.pathToItem.get(p);
      if (item && Math.abs(this.actualHeights.get(p) - item.h) > 5) { changed = true; break; }
    }
    if (changed) {
      const st = this.$scroll.scrollTop;
      this.recalc();
      requestAnimationFrame(() => this.$scroll.scrollTop = st);
    }
    this.pendingUpdates.clear();
  }

  scheduleRender() {
    if (!this.raf) {
      this.raf = true;
      requestAnimationFrame(() => { this.raf = false; this.renderVisible(); });
    }
  }
}