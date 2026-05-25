/* ════════════════════════════════════════════════════════════════
   OPEN CRIT — GALLERY ENGINE
   Loads data from Google Sheets CSV, renders masonry cards,
   handles filter, sort, reactions.
   ════════════════════════════════════════════════════════════════ */

/* ─────────── CONFIG ─────────── */
const SHEET_ID  = '1TU-kxx73GV57gKBRThfYDXcfcafYejoa7WzJ20SEpFY';
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv`;
const WEBAPP_URL = 'https://script.google.com/macros/s/AKfycby32PWUE6WWM-4ED8JUuxMfRAL2rLdEk7kCFgTrlh2p6eGyXSCMQX3yx5Gt8kmUKbOJ/exec';

const REFRESH_MS = 60_000;
const STORAGE_KEY = 'opencrit_reactions_v1';

/* Column index map (0-based, from the form's sheet) */
const COL = { TIME: 0, CONTENT: 1, NAME: 2, LIKE: 3, HUG: 4, IDEA: 5 };

/* Reactions: internal name (matches sheet) -> display config */
const REACTIONS = [
  { type: 'like', label: 'Love',     icon: '♥', col: COL.LIKE },
  { type: 'hug',  label: 'Awe',      icon: '◎', col: COL.HUG },
  { type: 'idea', label: 'Inspired', icon: '✦', col: COL.IDEA },
];

/* Category detection from content hashtags */
const CATEGORIES = [
  { match: '#reply',      cls: 'cat-reply',  label: 'Reply' },
  { match: '#justlisten', cls: 'cat-listen', label: 'Just Listen' },
  { match: '#qna',        cls: 'cat-qna',    label: 'Q & A' },
];

/* ─────────── STATE ─────────── */
let allData = [];
let sortMode = 'top';      // 'top' | 'recent'
let activeFilter = null;   // e.g. '#PA2'

/* ─────────── DOM ─────────── */
const $ = sel => document.querySelector(sel);
const commentsEl  = $('#comments');
const liveCountEl = $('#liveCount');
const activeFilterEl = $('#activeFilter');
const activeFilterTagEl = $('#activeFilterTag');
const clearFilterBtn = $('#clearFilter');

/* ════════════════════════════════════════════════════════════════
   CSV PARSER
   ════════════════════════════════════════════════════════════════ */
function parseCSV(text) {
  const rows = [];
  let row = [], cell = '', inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (c === '"' && inQuotes && n === '"') { cell += '"'; i++; }
    else if (c === '"') { inQuotes = !inQuotes; }
    else if (c === ',' && !inQuotes) { row.push(cell); cell = ''; }
    else if (c === '\n' && !inQuotes) { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') { cell += c; }
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/* ════════════════════════════════════════════════════════════════
   MEDIA HANDLING — detect images, videos (YouTube/Vimeo/direct)
   ════════════════════════════════════════════════════════════════ */
const URL_RE = /(https?:\/\/[^\s<]+)/gi;

function detectMedia(url) {
  url = url.trim();
  // YouTube
  const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/)|youtu\.be\/)([\w-]{11})/);
  if (yt) return { kind: 'youtube', src: `https://www.youtube.com/embed/${yt[1]}` };

  // Vimeo
  const vm = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vm) return { kind: 'vimeo', src: `https://player.vimeo.com/video/${vm[1]}` };

  // Direct video
  if (/\.(mp4|webm|mov|m4v)(\?.*)?$/i.test(url)) {
    return { kind: 'video', src: url };
  }

  // Google Drive
  if (url.includes('drive.google.com')) {
    let id = '';
    const m1 = url.match(/\/d\/([^/]+)/);
    const m2 = url.match(/[?&]id=([^&]+)/);
    if (m1) id = m1[1]; else if (m2) id = m2[1];
    return { kind: 'image', src: `https://drive.google.com/thumbnail?id=${id}&sz=w1000` };
  }

  // Direct image
  if (/\.(jpe?g|png|gif|webp|avif|svg)(\?.*)?$/i.test(url)) {
    return { kind: 'image', src: url };
  }

  return null;
}

function renderMedia(media) {
  if (!media) return '';
  const src = encodeURI(decodeURI(media.src)); // normalize, prevent attr breakout
  switch (media.kind) {
    case 'image':
      return `<div class="card__media"><img src="${src}" loading="lazy" alt="" data-zoom="${src}"></div>`;
    case 'video':
      return `<div class="card__media"><video src="${src}" controls preload="metadata"></video></div>`;
    case 'youtube':
    case 'vimeo':
      return `<div class="card__media"><iframe src="${src}" frameborder="0" allow="encrypted-media; picture-in-picture" allowfullscreen></iframe></div>`;
  }
  return '';
}

/* ════════════════════════════════════════════════════════════════
   CATEGORY & TIME HELPERS
   ════════════════════════════════════════════════════════════════ */
function detectCategory(content) {
  const lower = content.toLowerCase();
  for (const c of CATEGORIES) {
    if (lower.includes(c.match)) return c;
  }
  return { cls: '', label: 'Confess' };
}

function formatRelative(dateStr) {
  const d = new Date(dateStr);
  if (isNaN(d)) return '';
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1)  return 'baru saja';
  if (diffMin < 60) return `${diffMin} menit lalu`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} jam lalu`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay} hari lalu`;
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

function escapeHTML(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

/* ════════════════════════════════════════════════════════════════
   REACTION GUARD (localStorage)
   ════════════════════════════════════════════════════════════════ */
function getReactionStore() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
  catch { return {}; }
}

function setReactionStore(store) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); } catch {}
}

function hasReacted(rowIndex, type) {
  const store = getReactionStore();
  return Boolean(store[rowIndex]?.[type]);
}

function markReacted(rowIndex, type) {
  const store = getReactionStore();
  store[rowIndex] = store[rowIndex] || {};
  store[rowIndex][type] = true;
  setReactionStore(store);
}

/* ════════════════════════════════════════════════════════════════
   SORTING
   ════════════════════════════════════════════════════════════════ */
function sortData(data, mode) {
  const arr = [...data];
  if (mode === 'top') {
    arr.sort((a, b) => {
      const sa = (+a.like || 0) + (+a.hug || 0) + (+a.idea || 0);
      const sb = (+b.like || 0) + (+b.hug || 0) + (+b.idea || 0);
      if (sb !== sa) return sb - sa;
      return new Date(b.time) - new Date(a.time); // tie-break by recency
    });
  } else {
    arr.sort((a, b) => new Date(b.time) - new Date(a.time));
  }
  return arr;
}

/* ════════════════════════════════════════════════════════════════
   CARD RENDERING
   ════════════════════════════════════════════════════════════════ */
function buildCard(item) {
  const cat = detectCategory(item.content);

  // Extract URLs and detect media
  let raw = item.content;
  const urls = raw.match(URL_RE) || [];
  const mediaItems = [];
  urls.forEach(u => {
    const m = detectMedia(u);
    if (m) {
      mediaItems.push(m);
      raw = raw.replace(u, '');
    }
  });

  // Tags
  const tagMatches = raw.match(/#\w+/g) || [];
  const tagsHTML = tagMatches.length
    ? `<div class="card__tags">${tagMatches.map(t =>
        `<span class="card__tag" data-tag="${escapeHTML(t)}">${escapeHTML(t)}</span>`
      ).join('')}</div>`
    : '';

  // Clean text
  let text = raw.replace(/#\w+/g, '').trim();
  text = escapeHTML(text);
  const needsMore = text.length > 280;

  // Media HTML
  const mediaHTML = mediaItems.map(renderMedia).join('');

  // Reactions
  const reactionsHTML = REACTIONS.map(r => {
    const count = +item[r.type] || 0;
    const isActive = hasReacted(item.row, r.type);
    return `<button class="reaction ${isActive ? 'is-active' : ''}"
                    data-type="${r.type}"
                    data-row="${item.row}"
                    aria-label="${r.label}">
              <span class="reaction__icon">${r.icon}</span>
              <span class="reaction__label">${r.label}</span>
              <span class="reaction__count">${count}</span>
            </button>`;
  }).join('');

  return `
    <article class="card ${cat.cls}" data-row="${item.row}">
      <div class="card__meta">
        <span class="card__cat-label">${cat.label}</span>
        <span class="card__time">${formatRelative(item.time)}</span>
      </div>
      ${tagsHTML}
      <div class="card__text ${needsMore ? 'card__text--fade' : ''}">${text}</div>
      ${needsMore ? `<span class="card__more">Lihat selengkapnya →</span>` : ''}
      ${mediaHTML}
      <div class="card__reactions">${reactionsHTML}</div>
    </article>
  `;
}

function renderGallery() {
  let data = activeFilter
    ? allData.filter(d => d.content.toLowerCase().includes(activeFilter.toLowerCase()))
    : allData;

  data = sortData(data, sortMode);

  if (data.length === 0) {
    commentsEl.innerHTML = `<div class="gallery__loading">Belum ada kiriman${activeFilter ? ` untuk ${activeFilter}` : ''}.</div>`;
    return;
  }

  commentsEl.innerHTML = data.map(buildCard).join('');
}

/* ════════════════════════════════════════════════════════════════
   DATA LOADING
   ════════════════════════════════════════════════════════════════ */
async function loadData() {
  try {
    const res = await fetch(`${SHEET_URL}&t=${Date.now()}`);
    const text = await res.text();
    const rows = parseCSV(text).slice(1); // drop header

    allData = rows
      .map((r, i) => ({
        row: i + 2,
        time: r[COL.TIME] || '',
        content: r[COL.CONTENT] || '',
        like: +r[COL.LIKE] || 0,
        hug:  +r[COL.HUG]  || 0,
        idea: +r[COL.IDEA] || 0,
      }))
      .filter(d => d.content.trim().length > 0);

    if (liveCountEl) {
      liveCountEl.textContent = String(allData.length).padStart(3, '0');
    }
    renderGallery();
  } catch (err) {
    console.error('Load error:', err);
    commentsEl.innerHTML = `<div class="gallery__loading">Gagal memuat data. Coba refresh halaman.</div>`;
  }
}

/* ════════════════════════════════════════════════════════════════
   EVENT BINDINGS — delegated
   ════════════════════════════════════════════════════════════════ */
document.addEventListener('click', (e) => {
  // Tag click (in card or legend chip)
  const tag = e.target.closest('[data-tag]');
  if (tag) {
    applyFilter(tag.dataset.tag);
    window.scrollTo({ top: $('.gallery').offsetTop - 80, behavior: 'smooth' });
    return;
  }

  // Sort toggle
  const sortBtn = e.target.closest('[data-sort]');
  if (sortBtn) {
    document.querySelectorAll('.sort-toggle__btn').forEach(b => {
      b.classList.remove('is-active');
      b.setAttribute('aria-selected', 'false');
    });
    sortBtn.classList.add('is-active');
    sortBtn.setAttribute('aria-selected', 'true');
    sortMode = sortBtn.dataset.sort;
    renderGallery();
    return;
  }

  // Read more
  const more = e.target.closest('.card__more');
  if (more) {
    const card = more.closest('.card');
    const expanded = card.classList.toggle('is-expanded');
    more.textContent = expanded ? '↑ Sembunyikan' : 'Lihat selengkapnya →';
    return;
  }

  // Reaction click
  const reaction = e.target.closest('.reaction');
  if (reaction) {
    handleReaction(reaction);
    return;
  }

  // Clear filter
  if (e.target.closest('#clearFilter')) {
    clearFilter();
    return;
  }

  // Modal close
  if (e.target.id === 'imageModal' || e.target.classList.contains('modal__close')) {
    closeModal();
    return;
  }

  // Image zoom — delegated
  const zoomImg = e.target.closest('img[data-zoom]');
  if (zoomImg) {
    openImage(zoomImg.dataset.zoom);
  }
});

/* ─── Filter logic ─── */
function applyFilter(tag) {
  activeFilter = tag;
  activeFilterEl.hidden = false;
  activeFilterTagEl.textContent = tag;
  renderGallery();
}

function clearFilter() {
  activeFilter = null;
  activeFilterEl.hidden = true;
  renderGallery();
}

/* ─── Reactions ─── */
function handleReaction(btn) {
  const row  = +btn.dataset.row;
  const type = btn.dataset.type;

  if (hasReacted(row, type)) return; // already reacted

  // Optimistic UI update
  const countEl = btn.querySelector('.reaction__count');
  countEl.textContent = (+countEl.textContent || 0) + 1;
  btn.classList.add('is-active');
  markReacted(row, type);

  // Fire & forget — Apps Script endpoint
  fetch(`${WEBAPP_URL}?action=addReaction&row=${row}&type=${type}`, { mode: 'no-cors' })
    .catch(err => console.warn('Reaction sync failed:', err));

  // Update local model so re-renders preserve count
  const item = allData.find(d => d.row === row);
  if (item) item[type] = (+item[type] || 0) + 1;
}

/* ─── Image modal ─── */
function openImage(src) {
  const modal = $('#imageModal');
  const img   = $('#fullImage');
  img.src = src;
  modal.hidden = false;
}
window.openImage = openImage; // expose for inline onclick

function closeModal() {
  $('#imageModal').hidden = true;
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeModal();
});

/* ════════════════════════════════════════════════════════════════
   BOOT
   ════════════════════════════════════════════════════════════════ */
loadData();
setInterval(loadData, REFRESH_MS);
