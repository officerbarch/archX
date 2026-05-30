/* ════════════════════════════════════════════════════════════════
   OPEN CRIT — MAIN ENGINE
   Panel gallery + Kuratorial + Google Auth + Search/Filter
   ════════════════════════════════════════════════════════════════ */

/* ─────────── CONFIG ─────────── */
const SHEET_ID    = '1TU-kxx73GV57gKBRThfYDXcfcafYejoa7WzJ20SEpFY';
const SHEET_URL   = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv`;
const WEBAPP_URL  = 'https://script.google.com/macros/s/AKfycby32PWUE6WWM-4ED8JUuxMfRAL2rLdEk7kCFgTrlh2p6eGyXSCMQX3yx5Gt8kmUKbOJ/exec';

/* Kuratorial sheet — second sheet tab (gid=1) — adjust if needed. */
const KUR_SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=1`;

/* Google OAuth Client ID — replace with your actual Client ID from Google Cloud Console */
const GOOGLE_CLIENT_ID = '739812277155-l5mcobl1utg5bfm24n3ptn5uh4vcqnjj.apps.googleusercontent.com';

/* Admin whitelist */
const ADMIN_EMAILS = [
  'fahmi.muchlis@gmail.com',
  'officerbarch@gmail.com',
];

const REFRESH_MS   = 60_000;
const STORAGE_KEY  = 'opencrit_reactions_v1';
const AUTH_KEY     = 'opencrit_user_v1';

/* Column indices for Panel sheet */
const COL = { TIME: 0, CONTENT: 1, NAME: 2, AVATAR: 3, EMAIL: 4, LIKE: 5, HUG: 6, IDEA: 7 };

/* Reactions config */
const REACTIONS = [
  { type: 'like', label: 'Love',      icon: '♥', col: COL.LIKE },
  { type: 'hug',  label: 'Awe',       icon: '◎', col: COL.HUG  },
  { type: 'idea', label: 'Insightful',icon: '✦', col: COL.IDEA },
];

/* Category detection */
const CATEGORIES = [
  { match: '#reply',      cls: 'cat-reply',  label: 'Reply' },
  { match: '#justlisten', cls: 'cat-listen', label: 'Just Listen' },
  { match: '#qna',        cls: 'cat-qna',    label: 'Q & A' },
];

/* ─────────── STATE ─────────── */
let allData      = [];
let kurData      = [];
let sortMode     = 'top';
let activeFilter = null;
let searchQuery  = '';
let currentPage  = 'panel';
let currentUser  = null;
let activeKurYear = null;

/* Slideshow state */
let slideImages    = [];
let slideIndex     = 0;
let slideTimer     = null;
const SLIDE_INTERVAL = 5000;

/* ─────────── DOM HELPERS ─────────── */
const $  = sel => document.querySelector(sel);
const $$ = sel => document.querySelectorAll(sel);

/* ════════════════════════════════════════════════════════════════
   NAVBAR — AUTOHIDE ON SCROLL
   ════════════════════════════════════════════════════════════════ */
(function initNavScroll() {
  let lastY = 0;
  const nav = $('#navbar');
  window.addEventListener('scroll', () => {
    const y = window.scrollY;
    if (y > lastY && y > 80) {
      nav.classList.add('is-hidden');
    } else {
      nav.classList.remove('is-hidden');
    }
    nav.classList.toggle('is-scrolled', y > 10);
    lastY = y;
  }, { passive: true });
})();

/* ════════════════════════════════════════════════════════════════
   PAGE ROUTING
   ════════════════════════════════════════════════════════════════ */
function showPage(name) {
  currentPage = name;

  $$('.page').forEach(p => p.classList.remove('is-active'));
  $$('.navbar__link').forEach(l => {
    l.classList.toggle('is-active', l.dataset.page === name);
  });

  const page = $(`#page-${name}`);
  if (page) page.classList.add('is-active');

  window.scrollTo({ top: 0, behavior: 'smooth' });

  if (name === 'kuratorial') loadKuratorial();
  if (name === 'admin') initAdminPage();
}
window.showPage = showPage;

/* ════════════════════════════════════════════════════════════════
   CSV PARSER
   ════════════════════════════════════════════════════════════════ */
function parseCSV(text) {
  const rows = [];
  let row = [], cell = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i+1];
    if (c === '"' && inQ && n === '"') { cell += '"'; i++; }
    else if (c === '"') { inQ = !inQ; }
    else if (c === ',' && !inQ) { row.push(cell); cell = ''; }
    else if (c === '\n' && !inQ) { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') { cell += c; }
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/* ════════════════════════════════════════════════════════════════
   MEDIA HELPERS
   ════════════════════════════════════════════════════════════════ */
const URL_RE = /(https?:\/\/[^\s<]+)/gi;

function detectMedia(url) {
  url = url.trim();
  const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/)|youtu\.be\/)([\w-]{11})/);
  if (yt) return { kind: 'youtube', src: `https://www.youtube.com/embed/${yt[1]}` };
  const vm = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vm) return { kind: 'vimeo', src: `https://player.vimeo.com/video/${vm[1]}` };
  if (/\.(mp4|webm|mov|m4v)(\?.*)?$/i.test(url)) return { kind: 'video', src: url };
  if (url.includes('drive.google.com')) {
    const m1 = url.match(/\/d\/([^/]+)/), m2 = url.match(/[?&]id=([^&]+)/);
    const id = m1 ? m1[1] : m2 ? m2[1] : '';
    return { kind: 'image', src: `https://drive.google.com/thumbnail?id=${id}&sz=w1000` };
  }
  if (/\.(jpe?g|png|gif|webp|avif|svg)(\?.*)?$/i.test(url)) return { kind: 'image', src: url };
  return null;
}

function renderMedia(media) {
  if (!media) return '';
  const src = encodeURI(decodeURI(media.src));
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
   HELPERS
   ════════════════════════════════════════════════════════════════ */
function escapeHTML(s) {
  return String(s)
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;');
}

function detectCategory(content) {
  const lower = content.toLowerCase();
  for (const c of CATEGORIES) if (lower.includes(c.match)) return c;
  return { cls: '', label: '' };
}

function parseTimestamp(str) {
  if (!str) return null;
  const d = new Date(str);
  if (!isNaN(d)) return d;
  const m = str.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})[\s,]+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/);
  if (m) return new Date(+m[3], +m[2]-1, +m[1], +m[4], +m[5], +m[6]||0);
  return null;
}

function formatDate(str) {
  const d = parseTimestamp(str);
  if (!d) return '';
  const months = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

function getYear(str) {
  const d = parseTimestamp(str);
  return d ? d.getFullYear() : null;
}

/* ════════════════════════════════════════════════════════════════
   REACTION STORE
   ════════════════════════════════════════════════════════════════ */
function getReactionStore() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; }
}
function setReactionStore(s) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch {}
}
function hasReacted(row, type) { return Boolean(getReactionStore()[row]?.[type]); }
function markReacted(row, type) {
  const s = getReactionStore();
  s[row] = s[row] || {};
  s[row][type] = true;
  setReactionStore(s);
}

/* ════════════════════════════════════════════════════════════════
   GOOGLE AUTH
   ════════════════════════════════════════════════════════════════ */
function initGoogleAuth() {
  /* Try restore session */
  try {
    const saved = localStorage.getItem(AUTH_KEY);
    if (saved) {
      currentUser = JSON.parse(saved);
      renderAuthUI();
    }
  } catch {}

  /* Init Google Identity Services */
  if (typeof google !== 'undefined' && google.accounts) {
    google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: handleCredential,
      auto_select: false,
    });
  }

  /* Sign-in button */
  const btn = $('#googleSignInBtn');
  if (btn) btn.addEventListener('click', triggerGoogleSignIn);
}

function triggerGoogleSignIn() {
  if (typeof google !== 'undefined' && google.accounts) {
    google.accounts.id.prompt();
  } else {
    /* Fallback: show manual input if GIS not loaded (dev mode) */
    promptFallbackLogin();
  }
}

function promptFallbackLogin() {
  /* Simple fallback for when OAuth not configured yet */
  const name  = prompt('Nama Anda:');
  const email = prompt('Email Google Anda:');
  if (name && email) {
    currentUser = { name, email, picture: '' };
    localStorage.setItem(AUTH_KEY, JSON.stringify(currentUser));
    renderAuthUI();
  }
}

function handleCredential(response) {
  /* Decode JWT payload (no verification needed client-side for display) */
  try {
    const payload = JSON.parse(atob(response.credential.split('.')[1]));
    currentUser = {
      name:    payload.name    || '',
      email:   payload.email   || '',
      picture: payload.picture || '',
    };
    localStorage.setItem(AUTH_KEY, JSON.stringify(currentUser));
    renderAuthUI();
  } catch (e) {
    console.error('Auth error:', e);
  }
}

function signOut() {
  currentUser = null;
  localStorage.removeItem(AUTH_KEY);
  renderAuthUI();
  if (typeof google !== 'undefined' && google.accounts) {
    google.accounts.id.disableAutoSelect();
  }
}

function isAdmin(user) {
  if (!user) return false;
  return ADMIN_EMAILS.includes((user.email || '').toLowerCase());
}

function renderAuthUI() {
  const loginGate   = $('#loginGate');
  const commentForm = $('#commentForm');
  const userInfo    = $('#userInfo');
  if (!loginGate || !commentForm) return;

  if (currentUser) {
    loginGate.hidden = true;
    commentForm.hidden = false;

    /* Show admin nav link if admin */
    const adminLink = $('#adminNavLink');
    if (adminLink) adminLink.hidden = !isAdmin(currentUser);
    const avatarHTML = currentUser.picture
      ? `<img src="${escapeHTML(currentUser.picture)}" class="comment-form__user-avatar" alt="">`
      : `<div class="comment-form__user-avatar" style="width:34px;height:34px;border-radius:50%;background:var(--blue-light);display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:var(--blue);">${escapeHTML(currentUser.name.charAt(0).toUpperCase())}</div>`;
    userInfo.innerHTML = `
      ${avatarHTML}
      <div>
        <div class="comment-form__user-name">${escapeHTML(currentUser.name)}</div>
        <div class="comment-form__user-email">${escapeHTML(currentUser.email)}</div>
      </div>
      <button class="comment-form__logout" id="logoutBtn">Keluar</button>
    `;
    $('#logoutBtn')?.addEventListener('click', signOut);
  } else {
    loginGate.hidden = false;
    commentForm.hidden = true;
    const adminLink = $('#adminNavLink');
    if (adminLink) adminLink.hidden = true;
  }
}

/* ════════════════════════════════════════════════════════════════
   SUBMIT COMMENT
   ════════════════════════════════════════════════════════════════ */
function initCommentForm() {
  const sendBtn  = $('#sendBtn');
  const textarea = $('#commentText');
  const status   = $('#sendStatus');
  if (!sendBtn || !textarea) return;

  sendBtn.addEventListener('click', async () => {
    if (!currentUser) return;
    const text = textarea.value.trim();
    if (!text) return;

    sendBtn.disabled = true;
    sendBtn.textContent = 'Mengirim…';
    status.hidden = true;

    try {
      const params = new URLSearchParams({
        action:  'addComment',
        content: text,
        name:    currentUser.name,
        email:   currentUser.email,
        avatar:  currentUser.picture || '',
      });

      await fetch(`${WEBAPP_URL}?${params}`, { mode: 'no-cors' });

      textarea.value = '';
      status.className = 'send-status is-success';
      status.textContent = '✓ Kiriman terkirim! Akan muncul dalam beberapa saat.';
      status.hidden = false;

      /* Reload data after short delay */
      setTimeout(loadData, 2500);
    } catch (err) {
      status.className = 'send-status is-error';
      status.textContent = 'Gagal mengirim. Coba lagi.';
      status.hidden = false;
    } finally {
      sendBtn.disabled = false;
      sendBtn.textContent = 'Kirim →';
      setTimeout(() => { status.hidden = true; }, 5000);
    }
  });
}

/* ════════════════════════════════════════════════════════════════
   SORT
   ════════════════════════════════════════════════════════════════ */
function sortData(data, mode) {
  const arr = [...data];
  const ts  = d => (parseTimestamp(d.time) || new Date(0)).getTime();
  if (mode === 'top') {
    arr.sort((a,b) => {
      const sa = (+a.like||0)+(+a.hug||0)+(+a.idea||0);
      const sb = (+b.like||0)+(+b.hug||0)+(+b.idea||0);
      return sb !== sa ? sb - sa : ts(b) - ts(a);
    });
  } else {
    arr.sort((a,b) => ts(b) - ts(a));
  }
  return arr;
}

/* ════════════════════════════════════════════════════════════════
   CARD BUILDER
   ════════════════════════════════════════════════════════════════ */
function buildCard(item) {
  const cat = detectCategory(item.content);
  let raw = item.content;

  /* Extract media URLs */
  const urls = raw.match(URL_RE) || [];
  const mediaItems = [];
  urls.forEach(u => {
    const m = detectMedia(u);
    if (m) { mediaItems.push(m); raw = raw.replace(u, ''); }
  });

  /* Tags */
  const tagMatches = raw.match(/#\w+/g) || [];
  const tagsHTML = tagMatches.length
    ? `<div class="card__tags">${tagMatches.map(t =>
        `<span class="card__tag" data-tag="${escapeHTML(t)}">${escapeHTML(t)}</span>`
      ).join('')}</div>` : '';

  /* Clean text */
  let text = raw.replace(/#\w+/g, '').trim();
  text = escapeHTML(text);
  const needsMore = text.length > 280;

  /* Author (if available) */
  const authorHTML = item.name
    ? `<div class="card__author">
        ${item.avatar
          ? `<img src="${escapeHTML(item.avatar)}" class="card__author-avatar" alt="">`
          : `<div class="card__author-avatar" style="width:26px;height:26px;border-radius:50%;background:var(--blue-light);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:var(--blue);">${escapeHTML(item.name.charAt(0).toUpperCase())}</div>`
        }
        <span class="card__author-name">${escapeHTML(item.name)}</span>
       </div>` : '';

  /* Reactions */
  const reactionsHTML = REACTIONS.map(r => {
    const count = +item[r.type] || 0;
    const active = hasReacted(item.row, r.type);
    return `<button class="reaction ${active ? 'is-active' : ''}"
                    data-type="${r.type}" data-row="${item.row}"
                    aria-label="${r.label}">
              <span class="reaction__icon">${r.icon}</span>
              <span class="reaction__label">${r.label}</span>
              <span class="reaction__count">${count}</span>
            </button>`;
  }).join('');

  return `
    <article class="card ${cat.cls}" data-row="${item.row}">
      <div class="card__meta">
        ${cat.label ? `<span class="card__cat-label">${cat.label}</span>` : ''}
        <span class="card__time">${formatDate(item.time)}</span>
      </div>
      ${authorHTML}
      ${tagsHTML}
      <div class="card__text ${needsMore ? 'card__text--fade' : ''}">${text}</div>
      ${needsMore ? `<span class="card__more">Lihat selengkapnya →</span>` : ''}
      ${mediaItems.map(renderMedia).join('')}
      <div class="card__reactions">${reactionsHTML}</div>
    </article>`;
}

/* ════════════════════════════════════════════════════════════════
   RENDER GALLERY
   ════════════════════════════════════════════════════════════════ */
function renderGallery() {
  const commentsEl = $('#comments');
  if (!commentsEl) return;

  let data = allData;

  /* Filter by tag */
  if (activeFilter) {
    data = data.filter(d => d.content.toLowerCase().includes(activeFilter.toLowerCase()));
  }

  /* Filter by search */
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    data = data.filter(d => {
      return d.content.toLowerCase().includes(q) ||
             (d.name  || '').toLowerCase().includes(q) ||
             (d.email || '').toLowerCase().includes(q);
    });
  }

  data = sortData(data, sortMode);

  if (data.length === 0) {
    commentsEl.innerHTML = `<div class="gallery__loading">Belum ada kiriman${activeFilter ? ` untuk ${activeFilter}` : ''}${searchQuery ? ` dengan kata "${searchQuery}"` : ''}.</div>`;
    return;
  }

  commentsEl.innerHTML = data.map(buildCard).join('');
}

/* ════════════════════════════════════════════════════════════════
   LOAD PANEL DATA
   ════════════════════════════════════════════════════════════════ */
async function loadData() {
  try {
    const res  = await fetch(`${SHEET_URL}&t=${Date.now()}`);
    const text = await res.text();
    const rows = parseCSV(text).slice(1);

    allData = rows
      .map((r, i) => ({
        row:     i + 2,
        time:    r[COL.TIME]    || '',
        content: r[COL.CONTENT] || '',
        name:    r[COL.NAME]    || '',
        avatar:  r[COL.AVATAR]  || '',
        email:   r[COL.EMAIL]   || '',
        like:    +r[COL.LIKE]   || 0,
        hug:     +r[COL.HUG]   || 0,
        idea:    +r[COL.IDEA]   || 0,
      }))
      .filter(d => d.content.trim().length > 0);

    const countEl = $('#liveCount');
    if (countEl) countEl.textContent = String(allData.length).padStart(3, '0');

    /* Build slideshow from top images (only on first load) */
    if (slideImages.length === 0) buildSlideshow(allData);

    renderGallery();
  } catch (err) {
    console.error('Load error:', err);
    const commentsEl = $('#comments');
    if (commentsEl) commentsEl.innerHTML = `<div class="gallery__loading">Gagal memuat data. Coba refresh halaman.</div>`;
  }
}

/* ════════════════════════════════════════════════════════════════
   LOAD KURATORIAL DATA
   ════════════════════════════════════════════════════════════════ */
async function loadKuratorial() {
  const contentEl = $('#kurContent');
  const yearListEl = $('#kurYearList');
  if (!contentEl) return;

  contentEl.innerHTML = `<div class="gallery__loading">Memuat kuratorial…</div>`;

  try {
    const res  = await fetch(`${KUR_SHEET_URL}&t=${Date.now()}`);
    const text = await res.text();
    const rows = parseCSV(text).slice(1);

    /* Expected columns: 0=TIME, 1=TITLE, 2=CONTENT(HTML), 3=IMAGE_URL */
    kurData = rows
      .filter(r => r[2] && r[2].trim())
      .map((r, i) => ({
        index:   i + 1,
        time:    r[0] || '',
        title:   r[1] || `Kuratorial ${String(i+1).padStart(2,'0')}`,
        content: r[2] || '',
        image:   r[3] || '',
        year:    getYear(r[0]),
      }))
      .reverse(); /* newest first */

    /* Build year list */
    const years = [...new Set(kurData.map(d => d.year).filter(Boolean))].sort((a,b) => b-a);
    if (yearListEl) {
      yearListEl.innerHTML = years.map(y =>
        `<button class="kur-year-btn ${activeKurYear === y ? 'is-active' : ''}"
                 data-year="${y}">${y}</button>`
      ).join('');
    }

    if (!activeKurYear && years.length) activeKurYear = years[0];
    renderKuratorial();

  } catch (err) {
    console.error('Kuratorial load error:', err);
    contentEl.innerHTML = `<div class="gallery__loading">Gagal memuat kuratorial.</div>`;
  }
}

function renderKuratorial() {
  const contentEl = $('#kurContent');
  if (!contentEl) return;

  let data = activeKurYear
    ? kurData.filter(d => d.year === activeKurYear)
    : kurData;

  if (data.length === 0) {
    contentEl.innerHTML = `<div class="gallery__loading">Belum ada kuratorial untuk tahun ini.</div>`;
    return;
  }

  /* Number from high to low within filtered set */
  contentEl.innerHTML = data.map((item, idx) => {
    const num = String(data.length - idx).padStart(2, '0');
    const mediaHTML = item.image
      ? `<img src="${escapeHTML(item.image)}" alt="${escapeHTML(item.title)}" style="max-width:100%;margin-top:1.5rem;border-radius:3px;">`
      : '';

    return `
      <div class="kur-entry">
        <div class="kur-entry__left">
          <span class="kur-entry__number">${escapeHTML(item.title)}</span>
          <span class="kur-entry__date">${formatDate(item.time)}</span>
        </div>
        <div class="kur-entry__right">
          <div class="kur-entry__rule"></div>
          <div class="kur-entry__body">${item.content}${mediaHTML}</div>
        </div>
      </div>`;
  }).join('');
}

/* ════════════════════════════════════════════════════════════════
   FILTER & SEARCH
   ════════════════════════════════════════════════════════════════ */
function applyFilter(tag) {
  activeFilter = tag;
  const el = $('#activeFilter');
  const tagEl = $('#activeFilterTag');
  if (el) el.hidden = false;
  if (tagEl) tagEl.textContent = tag;

  /* Highlight matching chip */
  $$('.chip').forEach(c => c.classList.toggle('is-active', c.dataset.tag === tag));

  renderGallery();
}

function clearFilter() {
  activeFilter = null;
  const el = $('#activeFilter');
  if (el) el.hidden = true;
  $$('.chip').forEach(c => c.classList.remove('is-active'));
  renderGallery();
}

function initSearch() {
  const input = $('#searchInput');
  const clearBtn = $('#searchClear');
  if (!input) return;

  input.addEventListener('input', () => {
    searchQuery = input.value.trim();
    if (clearBtn) clearBtn.hidden = !searchQuery;
    renderGallery();
  });

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      input.value = '';
      searchQuery = '';
      clearBtn.hidden = true;
      renderGallery();
    });
  }
}

/* ════════════════════════════════════════════════════════════════
   REACTIONS
   ════════════════════════════════════════════════════════════════ */
function handleReaction(btn) {
  const row  = +btn.dataset.row;
  const type = btn.dataset.type;
  if (hasReacted(row, type)) return;

  const countEl = btn.querySelector('.reaction__count');
  countEl.textContent = (+countEl.textContent || 0) + 1;
  btn.classList.add('is-active');
  markReacted(row, type);

  fetch(`${WEBAPP_URL}?action=addReaction&row=${row}&type=${type}`, { mode: 'no-cors' })
    .catch(err => console.warn('Reaction sync failed:', err));

  const item = allData.find(d => d.row === row);
  if (item) item[type] = (+item[type] || 0) + 1;
}

/* ════════════════════════════════════════════════════════════════
   IMAGE MODAL
   ════════════════════════════════════════════════════════════════ */
function openImage(src) {
  const modal = $('#imageModal');
  const img   = $('#fullImage');
  img.src = src;
  modal.hidden = false;
}
window.openImage = openImage;

function closeModal() { $('#imageModal').hidden = true; }

/* ════════════════════════════════════════════════════════════════
   DELEGATED EVENTS
   ════════════════════════════════════════════════════════════════ */
document.addEventListener('click', e => {
  /* Slide indicator click */
  const indicator = e.target.closest('.hero-indicator');
  if (indicator) {
    goToSlide(+indicator.dataset.slide);
    startSlideshow(); /* reset timer */
    return;
  }

  /* Tag chip or card tag */
  const tag = e.target.closest('[data-tag]');
  if (tag) {
    if (currentPage !== 'panel') showPage('panel');
    applyFilter(tag.dataset.tag);
    const galleryEl = $('.gallery');
    if (galleryEl) window.scrollTo({ top: galleryEl.offsetTop - 80, behavior: 'smooth' });
    return;
  }

  /* Sort button */
  const sortBtn = e.target.closest('[data-sort]');
  if (sortBtn) {
    $$('.sort-toggle__btn').forEach(b => {
      b.classList.remove('is-active');
      b.setAttribute('aria-selected','false');
    });
    sortBtn.classList.add('is-active');
    sortBtn.setAttribute('aria-selected','true');
    sortMode = sortBtn.dataset.sort;
    renderGallery();
    return;
  }

  /* Read more */
  const more = e.target.closest('.card__more');
  if (more) {
    const card = more.closest('.card');
    const exp  = card.classList.toggle('is-expanded');
    more.textContent = exp ? '↑ Sembunyikan' : 'Lihat selengkapnya →';
    return;
  }

  /* Reaction */
  const reaction = e.target.closest('.reaction');
  if (reaction) { handleReaction(reaction); return; }

  /* Clear filter */
  if (e.target.closest('#clearFilter')) { clearFilter(); return; }

  /* Modal close */
  if (e.target.id === 'imageModal' || e.target.classList.contains('modal__close')) {
    closeModal(); return;
  }

  /* Image zoom */
  const zoomImg = e.target.closest('img[data-zoom]');
  if (zoomImg) { openImage(zoomImg.dataset.zoom); return; }

  /* Kuratorial year button */
  const yearBtn = e.target.closest('.kur-year-btn');
  if (yearBtn) {
    activeKurYear = +yearBtn.dataset.year;
    $$('.kur-year-btn').forEach(b => b.classList.toggle('is-active', +b.dataset.year === activeKurYear));
    renderKuratorial();
    return;
  }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeModal();
});

/* ════════════════════════════════════════════════════════════════
   ADMIN PANEL
   ════════════════════════════════════════════════════════════════ */
function initAdminPage() {
  const gate  = $('#adminGate');
  const panel = $('#adminPanel');
  if (!gate || !panel) return;

  if (!currentUser || !isAdmin(currentUser)) {
    gate.hidden  = false;
    panel.hidden = true;
    return;
  }

  gate.hidden  = true;
  panel.hidden = false;

  loadAdminKurList();
  initAdminEditor();
}

function initAdminEditor() {
  /* New post button */
  $('#btnNewPost')?.addEventListener('click', () => {
    openEditor(null);
  });

  /* Close / cancel */
  ['#btnCloseEditor','#btnCancelEdit'].forEach(sel => {
    $(sel)?.addEventListener('click', closeEditor);
  });

  /* Toolbar buttons */
  $$('.editor-tool').forEach(btn => {
    btn.addEventListener('click', () => {
      const cmd = btn.dataset.cmd;
      const editor = $('#kurIsi');
      if (!editor) return;
      editor.focus();

      if (cmd === 'h2' || cmd === 'h3') {
        document.execCommand('formatBlock', false, cmd);
      } else if (cmd === 'link') {
        const url = prompt('Masukkan URL:');
        if (url) document.execCommand('createLink', false, url);
      } else {
        document.execCommand(cmd, false, null);
      }
      updatePreview();
    });
  });

  /* Live preview */
  $('#kurIsi')?.addEventListener('input', updatePreview);

  /* Submit */
  $('#btnSubmitKur')?.addEventListener('click', submitKuratorial);

  /* Refresh list */
  $('#btnRefreshKur')?.addEventListener('click', loadAdminKurList);
}

function openEditor(item) {
  const editor = $('#adminEditor');
  if (!editor) return;

  /* Reset fields */
  const today = new Date().toISOString().split('T')[0];
  $('#kurJudul').value    = item ? item.title   : '';
  $('#kurTanggal').value  = item ? (item.time ? parseTimestamp(item.time)?.toISOString().split('T')[0] : today) : today;
  $('#kurGambar').value   = item ? item.image   : '';
  $('#kurIsi').innerHTML  = item ? item.content : '';
  $('#editorTitle').textContent = item ? 'Edit Tulisan' : 'Tulisan Baru';

  /* Store row for editing */
  editor.dataset.editRow = item ? item.row : '';

  updatePreview();
  editor.hidden = false;
  editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeEditor() {
  const editor = $('#adminEditor');
  if (editor) editor.hidden = true;
}

function updatePreview() {
  const preview = $('#kurPreview');
  const isi     = $('#kurIsi');
  const gambar  = $('#kurGambar');
  if (!preview || !isi) return;

  const imgHTML = gambar?.value
    ? `<img src="${escapeHTML(gambar.value)}" style="max-width:100%;margin-top:1rem;border-radius:4px;" alt="">`
    : '';
  preview.innerHTML = isi.innerHTML + imgHTML;
}

async function submitKuratorial() {
  const judul   = $('#kurJudul')?.value.trim();
  const tanggal = $('#kurTanggal')?.value;
  const gambar  = $('#kurGambar')?.value.trim();
  const isi     = $('#kurIsi')?.innerHTML.trim();
  const status  = $('#adminSaveStatus');
  const btn     = $('#btnSubmitKur');
  const editRow = $('#adminEditor')?.dataset.editRow;

  if (!judul || !isi) {
    if (status) {
      status.className = 'send-status is-error';
      status.textContent = 'Judul dan isi tulisan tidak boleh kosong.';
      status.hidden = false;
    }
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Menyimpan…';
  if (status) status.hidden = true;

  try {
    const params = new URLSearchParams({
      action:  editRow ? 'editKuratorial' : 'addKuratorial',
      judul,
      tanggal,
      isi,
      gambar,
      email: currentUser.email,
      ...(editRow ? { row: editRow } : {}),
    });

    await fetch(`${WEBAPP_URL}?${params}`, { mode: 'no-cors' });

    if (status) {
      status.className = 'send-status is-success';
      status.textContent = '✓ Berhasil disimpan! Akan muncul dalam beberapa detik.';
      status.hidden = false;
    }

    closeEditor();
    setTimeout(() => {
      loadAdminKurList();
      loadKuratorial();
    }, 2500);

  } catch (err) {
    if (status) {
      status.className = 'send-status is-error';
      status.textContent = 'Gagal menyimpan. Coba lagi.';
      status.hidden = false;
    }
  } finally {
    btn.disabled = false;
    btn.textContent = 'Simpan & Publish →';
    setTimeout(() => { if (status) status.hidden = true; }, 6000);
  }
}

async function loadAdminKurList() {
  const listEl = $('#adminKurList');
  if (!listEl) return;
  listEl.innerHTML = `<div class="gallery__loading">Memuat…</div>`;

  try {
    const res  = await fetch(`${KUR_SHEET_URL}&t=${Date.now()}`);
    const text = await res.text();
    const rows = parseCSV(text).slice(1);

    const items = rows
      .map((r, i) => ({
        row:     i + 2,
        time:    r[0] || '',
        title:   r[1] || '(tanpa judul)',
        content: r[2] || '',
        image:   r[3] || '',
        year:    getYear(r[0]),
      }))
      .filter(d => d.title || d.content)
      .reverse();

    if (items.length === 0) {
      listEl.innerHTML = `<div class="gallery__loading">Belum ada tulisan kuratorial.</div>`;
      return;
    }

    listEl.innerHTML = items.map(item => `
      <div class="admin-list-item" data-row="${item.row}">
        <div class="admin-list-item__info">
          <div class="admin-list-item__title">${escapeHTML(item.title)}</div>
          <div class="admin-list-item__date">${formatDate(item.time) || '—'}</div>
        </div>
        <span class="admin-list-item__row">Baris ${item.row}</span>
        <button class="btn-admin-delete" data-row="${item.row}" data-title="${escapeHTML(item.title)}">Hapus</button>
      </div>`
    ).join('');

    /* Edit on row click */
    listEl.querySelectorAll('.admin-list-item').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('.btn-admin-delete')) return;
        const row = +el.dataset.row;
        const item = items.find(d => d.row === row);
        if (item) openEditor(item);
      });
    });

    /* Delete buttons */
    listEl.querySelectorAll('.btn-admin-delete').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const row   = btn.dataset.row;
        const title = btn.dataset.title;
        if (!confirm(`Hapus "${title}"? Tindakan ini tidak bisa dibatalkan.`)) return;
        btn.textContent = 'Menghapus…';
        btn.disabled = true;
        await fetch(`${WEBAPP_URL}?action=deleteKuratorial&row=${row}&email=${currentUser.email}`, { mode: 'no-cors' });
        setTimeout(loadAdminKurList, 1500);
      });
    });

  } catch (err) {
    listEl.innerHTML = `<div class="gallery__loading">Gagal memuat daftar. Coba refresh.</div>`;
  }
}

/* ════════════════════════════════════════════════════════════════
   HERO SLIDESHOW — top images by reaction count
   ════════════════════════════════════════════════════════════════ */
function buildSlideshow(data) {
  const slidesEl = $('#heroSlides');
  if (!slidesEl) return;

  /* Pick items that have images, sorted by total reactions */
  const withImages = data
    .filter(d => {
      const urls = d.content.match(URL_RE) || [];
      return urls.some(u => detectMedia(u)?.kind === 'image');
    })
    .sort((a,b) => {
      const sa = (+a.like||0)+(+a.hug||0)+(+a.idea||0);
      const sb = (+b.like||0)+(+b.hug||0)+(+b.idea||0);
      return sb - sa;
    })
    .slice(0, 8); /* max 8 slides */

  if (withImages.length === 0) {
    /* Fallback: solid blue, no slides */
    slidesEl.style.background = 'var(--blue)';
    return;
  }

  /* Extract image URLs */
  slideImages = withImages.map(d => {
    const urls = d.content.match(URL_RE) || [];
    for (const u of urls) {
      const m = detectMedia(u);
      if (m?.kind === 'image') return m.src;
    }
    return null;
  }).filter(Boolean);

  /* Build slide divs */
  slidesEl.innerHTML = slideImages.map((src, i) =>
    `<div class="hero-slide ${i === 0 ? 'is-active' : ''}"
          style="background-image:url('${encodeURI(decodeURI(src))}')"></div>`
  ).join('');

  /* Build indicators */
  const existingIndicators = $('.hero-indicators');
  if (existingIndicators) existingIndicators.remove();

  if (slideImages.length > 1) {
    const indicators = document.createElement('div');
    indicators.className = 'hero-indicators';
    indicators.innerHTML = slideImages.map((_,i) =>
      `<div class="hero-indicator ${i===0?'is-active':''}" data-slide="${i}"></div>`
    ).join('');
    $('.panel-hero')?.appendChild(indicators);
  }

  slideIndex = 0;
  startSlideshow();
}

function goToSlide(idx) {
  const slides = $$('.hero-slide');
  const indicators = $$('.hero-indicator');
  if (!slides.length) return;

  slides[slideIndex]?.classList.remove('is-active');
  indicators[slideIndex]?.classList.remove('is-active');

  slideIndex = (idx + slideImages.length) % slideImages.length;

  slides[slideIndex]?.classList.add('is-active');
  indicators[slideIndex]?.classList.add('is-active');
}

function startSlideshow() {
  if (slideTimer) clearInterval(slideTimer);
  if (slideImages.length <= 1) return;
  slideTimer = setInterval(() => goToSlide(slideIndex + 1), SLIDE_INTERVAL);
}

/* ════════════════════════════════════════════════════════════════
   BOOT
   ════════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  initGoogleAuth();
  initCommentForm();
  initSearch();
  loadData();
  setInterval(loadData, REFRESH_MS);
});
