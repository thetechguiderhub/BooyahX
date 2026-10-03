/* ============================================
   BOOYAHX — PUBLIC CONTENT SYNC
   ----------------------------------------
   Renders owner-managed content from the API on the public site:
     - events / news / updates pages (lists + filters + search)
     - announcement banners (below navbar, every public page)
     - sponsor strip (above footer, every public page)
     - highlight cards (home page)
     - popup modals (every public page, frequency respected)

   Every value comes from the server. Nothing is fabricated: when
   the API returns nothing, the page's honest empty state stays.
   ============================================ */
(function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // Owner-entered URLs: only http(s), site-relative, anchors or root paths.
  function safeUrl(u) {
    const v = String(u || '').trim();
    if (/^https?:\/\//i.test(v)) return v;
    if (/^\/(?!\/)/.test(v) || v.startsWith('#')) return v;
    if (/^[a-z0-9._-]+\/[^ ]*$/i.test(v) && !/^[a-z]+:/i.test(v)) return v; // relative path
    return '#';
  }

  function applyI18n() {
    try { if (typeof I18n !== 'undefined') I18n.apply(); } catch (_) {}
  }

  function fmtDate(v) {
    if (!v) return '';
    const d = new Date(v);
    return isNaN(d.getTime()) ? String(v) : d.toLocaleDateString();
  }

  function debounce(fn, ms) {
    let t;
    return function () { clearTimeout(t); t = setTimeout(fn, ms); };
  }

  function retryButton(fnName) {
    return `<button class="btn btn-primary" data-i18n="btn.retry" onclick="${fnName}()">RETRY</button>`;
  }

  /* ---------- empty-state helpers (reuse the page's static block) ---------- */
  function setEmpty(emptyEl, opts) {
    if (!emptyEl) return;
    const h3 = emptyEl.querySelector('h3');
    const p = emptyEl.querySelector('p');
    let btn = emptyEl.querySelector('.empty-retry');
    if (h3 && opts.h3Key) h3.setAttribute('data-i18n', opts.h3Key);
    if (p && opts.pKey) p.setAttribute('data-i18n', opts.pKey);
    if (opts.retry) {
      if (!btn) {
        btn = document.createElement('span');
        btn.className = 'empty-retry';
        btn.innerHTML = retryButton(opts.retry);
        emptyEl.appendChild(btn);
      }
    } else if (btn) {
      btn.remove();
    }
    emptyEl.style.display = '';
    applyI18n();
  }
  function hideEmpty(emptyEl) {
    if (emptyEl) emptyEl.style.display = 'none';
  }

  /* ============================================================
     EVENTS PAGE
     ============================================================ */
  let eventRows = [];
  let eventTab = 'active';
  let eventSearch = '';

  function eventPhase(ev) {
    const now = Date.now();
    const s = Date.parse(ev.start_time);
    const e = Date.parse(ev.end_time);
    if (isFinite(s) && now < s) return 'upcoming';
    if (isFinite(e) && e > 0 && now > e) return 'completed';
    return 'active';
  }

  function eventCard(ev) {
    const phase = eventPhase(ev);
    const phaseLabel = { active: 'Active', upcoming: 'Upcoming', completed: 'Completed' }[phase];
    const phaseKey = { active: 'status.active', upcoming: 'status.upcoming', completed: 'status.completed' }[phase];
    const dates = [ev.start_time ? fmtDate(ev.start_time) : '', ev.end_time ? fmtDate(ev.end_time) : '']
      .filter(Boolean).join(' → ');
    const banner = ev.banner
      ? `<div class="event-banner"><img src="${safeUrl(ev.banner)}" alt="" style="width:100%;height:100%;object-fit:cover;"></div>`
      : `<div class="event-banner"></div>`;
    return `<div class="event-card">
      ${banner}
      <div class="event-content">
        <div class="event-dates"><span>📅</span><span>${esc(dates)}</span>
          <span class="status-badge" data-i18n="${phaseKey}">${phaseLabel}</span></div>
        <h3 class="event-title">${esc(ev.title)}</h3>
        <p class="event-desc">${esc(ev.description)}</p>
        <div class="event-meta">
          <span class="info-label"><span data-i18n="card.entry">Entry</span>: <img class="coin-ic" src="assets/branding/bx-coin-small.png" alt="BX Coin">${esc(ev.entry || '0')} BX Coins</span>
          <span class="info-label"><span data-i18n="event.reward">Reward</span>: ${esc(ev.reward || '—')}</span>
        </div>
        <div class="event-actions" style="display:flex;justify-content:flex-end;padding-top:var(--space-md);">
          <button class="btn btn-outline btn-sm" type="button" data-store-event="${esc(ev.id)}" data-i18n="store.open">STORE</button>
        </div>
      </div>
    </div>`;
  }

  function renderEvents() {
    const list = document.getElementById('events-list');
    const emptyEl = document.getElementById('events-empty');
    if (!list || !emptyEl) return;

    const visible = eventRows.filter(r => eventPhase(r) === eventTab);
    if (!eventRows.length) {
      list.innerHTML = '';
      list.style.display = 'none';
      setEmpty(emptyEl, { h3Key: 'empty.events', pKey: 'empty.events_sub' });
      return;
    }
    if (!visible.length) {
      list.innerHTML = '';
      list.style.display = 'none';
      setEmpty(emptyEl, { h3Key: 'empty.search', pKey: 'empty.filter_sub' });
      return;
    }
    list.innerHTML = visible.map(eventCard).join('');
    list.style.display = '';
    hideEmpty(emptyEl);
    applyI18n();
  }

  window.loadEventsPage = async function () {
    const list = document.getElementById('events-list');
    const emptyEl = document.getElementById('events-empty');
    if (!list) return;
    try {
      const data = await DataService.Content.events(eventSearch ? { search: eventSearch } : null);
      eventRows = data.events || [];
      renderEvents();
    } catch (err) {
      list.innerHTML = '';
      setEmpty(emptyEl, { h3Key: 'error.backend', pKey: 'error.retry_sub', retry: 'loadEventsPage' });
    }
  };

  function initEventsPage() {
    if (!document.getElementById('events-list')) return;
    const tabs = document.getElementById('events-tabs');
    if (tabs) {
      tabs.querySelectorAll('.filter-tab').forEach(btn => {
        btn.addEventListener('click', () => {
          tabs.querySelectorAll('.filter-tab').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          eventTab = btn.dataset.phase || btn.textContent.trim().toLowerCase();
          renderEvents();
        });
      });
    }
    const search = document.getElementById('events-search');
    if (search) {
      search.addEventListener('input', debounce(async () => {
        eventSearch = search.value.trim();
        window.loadEventsPage();
      }, 300));
    }
    window.loadEventsPage();
  }

  /* ============================================================
     EVENTS PAGE — EVENT STORE (real items, real purchases)
     Every value below comes from GET /api/events/:id/items and
     POST /api/events/:id/items/:id/purchase — nothing is faked.
     ============================================================ */
  let storeEventId = null;
  let storeBusy = false;

  function storeEl(id) { return document.getElementById(id); }

  // Server messages are surfaced verbatim (escaped for the toast's innerHTML).
  function storeNotice(message, type) {
    if (message === undefined || message === null || message === '') return;
    if (typeof showToast === 'function') { showToast(esc(message), type || 'info'); return; }
    const body = storeEl('event-store-body');
    if (!body) return;
    const p = document.createElement('p');
    p.className = 'table-note';
    p.style.textAlign = 'left';
    p.style.color = type === 'error' ? 'var(--danger)' : 'var(--success)';
    p.textContent = String(message);
    body.insertBefore(p, body.firstChild);
  }

  function storeItemRow(item) {
    const price = Number(item.price_coins) || 0;
    const left = (item.remaining === null || item.remaining === undefined) ? '∞' : item.remaining;
    let action;
    if (item.owned === true) {
      action = `<span class="status-badge status-completed" data-i18n="store.owned">OWNED</span>`;
    } else if (item.remaining === 0) {
      action = `<span class="status-badge status-full" data-i18n="store.sold_out">SOLD OUT</span>`;
    } else {
      action = `<button class="btn btn-primary btn-sm" type="button" data-buy-item="${esc(item.id)}" data-i18n="store.buy">BUY WITH BX COINS</button>`;
    }
    return `<tr>
      <td style="min-width:160px;">
        <strong>${esc(item.name)}</strong>
        ${item.description ? `<div class="table-note" style="text-align:left;margin-top:4px;">${esc(item.description)}</div>` : ''}
      </td>
      <td style="white-space:nowrap;"><span data-i18n="store.price">Price</span>: ${price} <span data-i18n="unit.coins">BX Coins</span></td>
      <td style="white-space:nowrap;">Left: ${esc(left)}</td>
      <td style="text-align:right;">${action}</td>
    </tr>`;
  }

  function storeMineHtml(purchases, signedIn) {
    if (purchases.length) {
      return `<div class="table-wrap"><table class="data-table"><tbody>${purchases.map(p => `
        <tr>
          <td>${esc(p.item_name)}</td>
          <td style="white-space:nowrap;">-${esc(p.price_coins)} <span data-i18n="unit.coins">BX Coins</span></td>
          <td style="white-space:nowrap;color:var(--text-muted);">${esc(fmtDate(p.created_at))}</td>
        </tr>`).join('')}</tbody></table></div>`;
    }
    // Signed out → invite a sign-in; signed in with no purchases yet → honest empty note.
    return signedIn
      ? `<p class="table-note" style="text-align:left;margin-top:0;" data-i18n="wallet.no_transactions">NO TRANSACTIONS YET</p>`
      : `<p class="table-note" style="text-align:left;margin-top:0;" data-i18n="store.signin">Sign in to buy items.</p>`;
  }

  function renderEventStore(data, signedIn) {
    const body = storeEl('event-store-body');
    if (!body) return;
    const items = Array.isArray(data.items) ? data.items : [];
    const purchases = Array.isArray(data.my_purchases) ? data.my_purchases : [];
    let html = '';
    if (!items.length) {
      html += `<div class="empty-state" style="padding:var(--space-xl) var(--space-sm);">
        <p data-i18n="store.empty" style="margin-bottom:0;">No items available yet.</p>
      </div>`;
    } else {
      html += `<div class="table-wrap"><table class="data-table"><tbody>${
        items.map(storeItemRow).join('')
      }</tbody></table></div>`;
    }
    html += `<div style="margin-top:var(--space-xl);">
      <h4 data-i18n="store.mine" style="margin-bottom:var(--space-sm);">My Purchases</h4>
      ${storeMineHtml(purchases, signedIn)}
    </div>`;
    body.innerHTML = html;
    applyI18n();
  }

  async function loadEventStore() {
    const body = storeEl('event-store-body');
    if (!body || !storeEventId) return;
    // Items are public (optionalAuth); Auth.me() only tells us whether the
    // "My Purchases" section should invite a sign-in or show an empty note.
    const results = await Promise.allSettled([
      DataService.Content.eventStore(storeEventId),
      DataService.Auth.me()
    ]);
    if (results[0].status !== 'fulfilled') {
      storeNotice(results[0].reason && results[0].reason.message, 'error');
      return;
    }
    const data = results[0].value;
    const subtitle = storeEl('event-store-event');
    if (subtitle && data.event && data.event.title) subtitle.textContent = data.event.title;
    renderEventStore(data, results[1].status === 'fulfilled');
  }

  async function buyStoreItem(itemId, btn) {
    if (storeBusy) return;
    storeBusy = true;
    if (btn) btn.disabled = true; // no double buys while the request is in flight
    try {
      const res = await DataService.Content.buyEventItem(storeEventId, itemId);
      storeNotice(res && res.message ? res.message : '', 'success');
    } catch (err) {
      const msg = err && err.message;
      // The API answers 401 as "ACCESS DENIED" — offer sign-in, never force it.
      storeNotice(msg === 'ACCESS DENIED'
        ? (typeof I18n !== 'undefined' ? I18n.t('store.signin') : 'Sign in to buy items.')
        : msg, 'error');
    }
    // Re-fetch so owned / stock / remaining always reflect the server.
    try { await loadEventStore(); } catch (_) {}
    storeBusy = false;
  }

  function openEventStore(eventId) {
    const overlay = storeEl('event-store-modal');
    if (!overlay || !eventId) return;
    storeEventId = eventId;
    const subtitle = storeEl('event-store-event');
    const known = eventRows.find(r => String(r.id) === String(eventId));
    if (subtitle) subtitle.textContent = known ? known.title : '';
    const body = storeEl('event-store-body');
    if (body) body.innerHTML = '';
    overlay.style.display = 'flex';
    requestAnimationFrame(() => overlay.classList.add('open'));
    loadEventStore();
  }

  function closeEventStore() {
    const overlay = storeEl('event-store-modal');
    if (!overlay || overlay.style.display === 'none') return;
    overlay.classList.remove('open');
    setTimeout(() => { overlay.style.display = 'none'; }, 250);
  }

  function initEventStore() {
    const overlay = storeEl('event-store-modal');
    if (!overlay) return;
    const closeBtn = storeEl('event-store-close');
    if (closeBtn) closeBtn.addEventListener('click', closeEventStore);
    overlay.addEventListener('click', e => { if (e.target === overlay) closeEventStore(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeEventStore(); });
    const body = storeEl('event-store-body');
    if (body) body.addEventListener('click', e => {
      const buy = e.target.closest && e.target.closest('[data-buy-item]');
      if (buy) buyStoreItem(buy.getAttribute('data-buy-item'), buy);
    });
    // STORE button on every rendered event card (cards are re-rendered freely,
    // so the listener lives here, not on the card itself).
    document.addEventListener('click', e => {
      const open = e.target.closest && e.target.closest('[data-store-event]');
      if (open) openEventStore(open.getAttribute('data-store-event'));
    });
  }

  /* ============================================================
     NEWS PAGE
     ============================================================ */
  let newsRows = [];
  let newsCategory = '';
  let newsSearch = '';

  function newsCard(n) {
    const thumb = n.thumbnail
      ? `<div class="news-thumbnail"><img src="${safeUrl(n.thumbnail)}" alt="" style="width:100%;height:100%;object-fit:cover;"></div>`
      : `<div class="news-thumbnail"></div>`;
    return `<div class="news-card">
      ${thumb}
      <div class="news-content">
        <div class="news-date">${esc(fmtDate(n.published_at || n.created_at))}</div>
        <h3 class="news-title">${esc(n.title)}</h3>
        <p class="news-excerpt">${esc(n.content)}</p>
        <button class="news-link" type="button" data-i18n="news.read_more" onclick="(function(b){var p=b.previousElementSibling;p.style.webkitLineClamp='unset';b.style.display='none';})(this)">Read more</button>
      </div>
    </div>`;
  }

  function renderNews() {
    const list = document.getElementById('news-list');
    const emptyEl = document.getElementById('news-empty');
    if (!list || !emptyEl) return;

    const visible = newsRows.filter(r => !newsCategory || r.category === newsCategory);
    if (!newsRows.length) {
      list.innerHTML = '';
      list.style.display = 'none';
      setEmpty(emptyEl, { h3Key: 'empty.news', pKey: 'empty.news_sub' });
      return;
    }
    if (!visible.length) {
      list.innerHTML = '';
      list.style.display = 'none';
      setEmpty(emptyEl, { h3Key: 'empty.search', pKey: 'empty.filter_sub' });
      return;
    }
    list.innerHTML = visible.map(newsCard).join('');
    list.style.display = '';
    hideEmpty(emptyEl);
    applyI18n();
  }

  window.loadNewsPage = async function () {
    const list = document.getElementById('news-list');
    const emptyEl = document.getElementById('news-empty');
    if (!list) return;
    try {
      const data = await DataService.Content.news(newsSearch ? { search: newsSearch } : null);
      newsRows = data.news || [];
      renderNews();
    } catch (err) {
      list.innerHTML = '';
      setEmpty(emptyEl, { h3Key: 'error.backend', pKey: 'error.retry_sub', retry: 'loadNewsPage' });
    }
  };

  function initNewsPage() {
    if (!document.getElementById('news-list')) return;
    const tabs = document.getElementById('news-tabs');
    if (tabs) {
      const allTabs = [...tabs.querySelectorAll('.filter-tab')];
      allTabs.forEach(btn => {
        btn.addEventListener('click', () => {
          allTabs.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          const label = btn.textContent.trim();
          newsCategory = (btn.dataset.category !== undefined)
            ? btn.dataset.category
            : (label === 'All' ? '' : label);
          renderNews();
        });
      });
    }
    const search = document.getElementById('news-search');
    if (search) {
      search.addEventListener('input', debounce(async () => {
        newsSearch = search.value.trim();
        window.loadNewsPage();
      }, 300));
    }
    window.loadNewsPage();
  }

  /* ============================================================
     UPDATES PAGE
     ============================================================ */
  function updateGroups(u) {
    const groups = [
      ['update.new', u.features],
      ['update.improvements', u.improvements],
      ['update.fixes', u.fixes]
    ];
    return groups.filter(([, arr]) => Array.isArray(arr) && arr.length).map(([key, arr]) =>
      `<div class="timeline-group">
        <strong data-i18n="${key}">${key === 'update.new' ? 'New' : key === 'update.improvements' ? 'Improvements' : 'Fixes'}</strong>
        <div class="timeline-features">${arr.map(x => `<span class="feature-tag">${esc(x)}</span>`).join('')}</div>
      </div>`).join('');
  }

  function renderUpdates() {
    const tl = document.getElementById('updates-timeline');
    const emptyEl = document.getElementById('updates-empty');
    if (!tl || !emptyEl) return;
    if (!updateRows.length) {
      tl.innerHTML = '';
      tl.style.display = 'none';
      setEmpty(emptyEl, { h3Key: 'empty.updates', pKey: 'empty.updates_sub' });
      return;
    }
    tl.innerHTML = updateRows.map(u => `<div class="timeline-item">
      <div class="timeline-version">
        ${u.version ? `<span class="version-badge">${esc(u.version)}</span>` : ''}
        <span class="version-date">${esc(fmtDate(u.published_at || u.created_at))}</span>
      </div>
      <h4>${esc(u.title)}</h4>
      ${u.description ? `<p>${esc(u.description)}</p>` : ''}
      ${updateGroups(u)}
    </div>`).join('');
    tl.style.display = '';
    hideEmpty(emptyEl);
    applyI18n();
  }

  let updateRows = [];

  window.loadUpdatesPage = async function () {
    const tl = document.getElementById('updates-timeline');
    const emptyEl = document.getElementById('updates-empty');
    if (!tl) return;
    try {
      const data = await DataService.Content.updates();
      updateRows = data.updates || [];
      renderUpdates();
    } catch (err) {
      tl.innerHTML = '';
      tl.style.display = 'none';
      setEmpty(emptyEl, { h3Key: 'error.backend', pKey: 'error.retry_sub', retry: 'loadUpdatesPage' });
    }
  };

  /* ============================================================
     GLOBAL: ANNOUNCEMENT BANNERS (below navbar)
     ============================================================ */
  async function mountBanners() {
    try {
      const data = await DataService.Content.activeBanners();
      const rows = data.banners || [];
      if (!rows.length) return;
      const nav = document.querySelector('.navbar');
      if (!nav) return;
      const wrap = document.createElement('div');
      wrap.className = 'site-banners';
      rows.forEach(b => {
        const el = document.createElement('div');
        el.className = 'site-banner';
        el.innerHTML = `
          <div class="site-banner-text">
            <strong>${esc(b.title)}</strong>
            ${b.description ? `<span>${esc(b.description)}</span>` : ''}
          </div>
          ${b.button_text ? `<a class="btn btn-outline btn-sm" href="${safeUrl(b.link)}">${esc(b.button_text)}</a>` : ''}
          <button class="site-banner-close" type="button" aria-label="Close">&times;</button>`;
        el.querySelector('.site-banner-close').addEventListener('click', () => el.remove());
        wrap.appendChild(el);
      });
      nav.insertAdjacentElement('afterend', wrap);
      applyI18n();
    } catch (_) { /* no banners or backend down — page stays as-is */ }
  }

  /* ============================================================
     GLOBAL: SPONSOR STRIP (above footer)
     ============================================================ */
  async function mountSponsors() {
    try {
      const data = await DataService.Content.activeSponsors();
      const rows = data.sponsors || [];
      if (!rows.length) return;
      const footer = document.querySelector('footer.footer');
      if (!footer) return;
      const sec = document.createElement('section');
      sec.className = 'site-sponsors';
      sec.innerHTML = `<div class="container"><div class="site-sponsors-track">${rows.map(s => `
        <a class="sponsor-item" ${s.website ? `href="${safeUrl(s.website)}" target="_blank" rel="noopener noreferrer"` : ''} title="${esc(s.description || s.name)}">
          ${s.logo ? `<img src="${safeUrl(s.logo)}" alt="${esc(s.name)}">` : ''}
          <span>${esc(s.name)}</span>
        </a>`).join('')}</div></div>`;
      footer.insertAdjacentElement('beforebegin', sec);
    } catch (_) {}
  }

  /* ============================================================
     GLOBAL: HIGHLIGHTS (home page only, above footer)
     ============================================================ */
  function isHome() {
    return /\/(index\.html)?$/.test(location.pathname);
  }

  function highlightMedia(h) {
    const url = safeUrl(h.media_url);
    if (url === '#') return '';
    if (/\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(url)) {
      return `<img src="${url}" alt="${esc(h.title)}">`;
    }
    if (/\.(mp4|webm|ogg)(\?|$)/i.test(url)) {
      return `<video src="${url}" controls preload="metadata"></video>`;
    }
    return `<a class="highlight-link" href="${url}" target="_blank" rel="noopener noreferrer">🔗</a>`;
  }

  async function mountHighlights() {
    if (!isHome()) return;
    try {
      const data = await DataService.Content.activeHighlights();
      const rows = data.highlights || [];
      if (!rows.length) return;
      const footer = document.querySelector('footer.footer');
      if (!footer) return;
      const sec = document.createElement('section');
      sec.className = 'site-highlights';
      sec.innerHTML = `<div class="container">
        <div class="section-header"><h2 data-i18n="highlights.title">HIGHLIGHTS</h2></div>
        <div class="grid grid-3">${rows.map(h => `<div class="highlight-card">
          <div class="highlight-media">${highlightMedia(h)}</div>
          <div class="highlight-body">
            <h4>${esc(h.title)}</h4>
            ${h.description ? `<p>${esc(h.description)}</p>` : ''}
            ${h.tournament_name ? `<span class="highlight-tournament">${esc(h.tournament_name)}</span>` : ''}
          </div>
        </div>`).join('')}</div>
      </div>`;
      footer.insertAdjacentElement('beforebegin', sec);
      applyI18n();
    } catch (_) {}
  }

  /* ============================================================
     GLOBAL: POPUP MODALS (queue, frequency respected)
     ============================================================ */
  const popupQueue = [];

  function popupSeen(id, frequency) {
    if (frequency === 'always' || frequency === 'every_visit') return false;
    try {
      const key = 'bx_popup_' + id;
      if (sessionStorage.getItem(key)) return true;
      sessionStorage.setItem(key, '1');
      return false;
    } catch (_) { return false; }
  }

  function showNextPopup() {
    const p = popupQueue.shift();
    if (!p) return;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `<div class="modal">
      <div class="modal-header">
        <h3>${esc(p.title)}</h3>
        <button class="modal-close" type="button" aria-label="Close">&times;</button>
      </div>
      <p class="popup-message">${esc(p.message)}</p>
      ${p.button_text ? `<div class="modal-footer"><a class="btn btn-primary" href="${safeUrl(p.link)}">${esc(p.button_text)}</a></div>` : ''}
    </div>`;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('open'));
    const close = () => {
      overlay.classList.remove('open');
      setTimeout(() => { overlay.remove(); showNextPopup(); }, 250);
    };
    overlay.querySelector('.modal-close').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  }

  async function mountPopups() {
    try {
      const data = await DataService.Content.activePopups();
      const rows = data.popups || [];
      rows.forEach(p => { if (!popupSeen(p.id, p.frequency)) popupQueue.push(p); });
      if (popupQueue.length) showNextPopup();
    } catch (_) {}
  }

  /* ============================================================
     INIT
     ============================================================ */
  document.addEventListener('DOMContentLoaded', () => {
    mountBanners();
    mountSponsors();
    mountHighlights();
    mountPopups();
    initEventsPage();
    initEventStore();
    initNewsPage();
    if (document.getElementById('updates-timeline')) window.loadUpdatesPage();
  });
})();
