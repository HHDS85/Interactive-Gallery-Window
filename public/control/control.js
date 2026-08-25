/* SMARTPHONE CONTROLLER
   The phone is the private side of the window: it moves the big screen,
   carries the information and keeps every personal action off the glass. */

(() => {
  const screenId = location.pathname.split('/').filter(Boolean)[1];
  const params = new URLSearchParams(location.search);

  const sessionId =
    sessionStorage.getItem('igw-session') ||
    (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));
  sessionStorage.setItem('igw-session', sessionId);

  const $ = (id) => document.getElementById(id);
  const el = {
    splash: $('splash'),
    splashEyebrow: $('splashEyebrow'),
    splashHead: $('splashHead'),
    brand: $('brand'),
    statusDot: $('statusDot'),
    statusText: $('statusText'),
    viewerBanner: $('viewerBanner'),
    vbNote: $('vbNote'),
    vbClaim: $('vbClaim'),
    stage: $('stage'),
    swiper: $('swiper'),
    artImg: $('artImg'),
    prevBtn: $('prevBtn'),
    nextBtn: $('nextBtn'),
    pagerIndex: $('pagerIndex'),
    capArtist: $('capArtist'),
    capTitle: $('capTitle'),
    capMeta: $('capMeta'),
    capPrice: $('capPrice'),
    rowAbout: $('rowAbout'),
    bodyAbout: $('bodyAbout'),
    aboutText: $('aboutText'),
    rowArtist: $('rowArtist'),
    bodyArtist: $('bodyArtist'),
    artistText: $('artistText'),
    artistLink: $('artistLink'),
    rowInstagram: $('rowInstagram'),
    rowPrice: $('rowPrice'),
    rowSave: $('rowSave'),
    saveMark: $('saveMark'),
    rowShare: $('rowShare'),
    backdrop: $('backdrop'),
    sheet: $('sheet'),
    sheetClose: $('sheetClose'),
    sheetForm: $('sheetForm'),
    sheetRef: $('sheetRef'),
    sheetSuccess: $('sheetSuccess'),
    requestForm: $('requestForm'),
    fName: $('fName'),
    fEmail: $('fEmail'),
    fMessage: $('fMessage'),
    formError: $('formError'),
    submitBtn: $('submitBtn'),
    successClose: $('successClose'),
    timeout: $('timeout'),
    keepBtn: $('keepBtn'),
    ended: $('ended'),
    reclaimBtn: $('reclaimBtn'),
    continueBtn: $('continueBtn'),
    toast: $('toast'),
  };

  let config = null;
  let artworks = [];
  let index = 0;
  let role = 'connecting'; // connecting | controller | viewer
  let hasController = false;
  let autoClaim = true; // never steal control silently after a session ended
  let ws = null;
  let retryMs = 1000;
  let lastHeartbeat = 0;
  let viewedTimer = null;
  let toastTimer = null;
  let splashShown = false;

  const pad = (n) => String(n).padStart(2, '0');
  const artwork = () => artworks[index];
  const artistName = (a) => (a && a.artist ? a.artist.name : '');

  /* ------------------------------------------------------------- track */

  function track(event, props = {}) {
    const payload = { type: 'track', event, props };
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    } else if (navigator.sendBeacon) {
      navigator.sendBeacon(
        '/api/track',
        JSON.stringify({ screenId, sessionId, role, event, props })
      );
    }
  }

  /* ------------------------------------------------------------- toast */

  function toast(text) {
    el.toast.textContent = text;
    el.toast.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove('visible'), 2200);
  }

  /* ------------------------------------------------------------ render */

  function closeAccordions() {
    for (const [row, body] of [
      [el.rowAbout, el.bodyAbout],
      [el.rowArtist, el.bodyArtist],
    ]) {
      row.setAttribute('aria-expanded', 'false');
      body.style.maxHeight = '0px';
    }
  }

  const preloaded = new Set();

  function preloadAround(i) {
    const n = artworks.length;
    for (const k of [i, i + 1, i - 1]) {
      const a = artworks[((k % n) + n) % n];
      if (a && !preloaded.has(a.id)) {
        preloaded.add(a.id);
        const im = new Image();
        im.src = a.image;
      }
    }
  }

  function renderArtwork(i, { silent } = {}) {
    if (!artworks.length) return;
    index = ((i % artworks.length) + artworks.length) % artworks.length;
    const a = artwork();
    preloadAround(index);

    el.artImg.classList.add('fading');
    const pre = new Image();
    pre.src = a.image;
    const show = () => {
      el.artImg.src = a.image;
      el.artImg.alt = `${a.title} — ${artistName(a)}`;
      el.artImg.classList.remove('fading');
    };
    (pre.decode ? pre.decode().catch(() => {}) : Promise.resolve()).then(show);

    el.pagerIndex.textContent = `${pad(index + 1)} / ${pad(artworks.length)}`;
    el.capArtist.textContent = artistName(a);
    el.capTitle.textContent = a.title;
    el.capMeta.textContent = `${a.year} · ${a.medium} · ${a.dimensions}`;
    el.capPrice.classList.toggle('hidden', !a.priceOnRequest);
    el.aboutText.textContent = a.description;
    el.artistText.textContent = a.artist ? a.artist.bio : '';
    if (a.artist && a.artist.url) {
      el.artistLink.href = a.artist.url;
      el.artistLink.classList.remove('hidden');
    } else {
      el.artistLink.classList.add('hidden');
    }
    el.rowInstagram.href = (a.artist && a.artist.instagram) || '#';
    el.sheetRef.textContent = `${a.title} — ${artistName(a)}`;
    renderSaveState();
    closeAccordions();

    clearTimeout(viewedTimer);
    if (!silent) {
      viewedTimer = setTimeout(() => {
        track('artwork_viewed', { artworkId: a.id, local: role !== 'controller' });
      }, 1500);
    }
  }

  /* ------------------------------------------------------------ status */

  function setStatus(kind) {
    el.statusDot.className = 'dot';
    el.statusText.textContent = kind;
    if (kind === 'live') {
      el.statusDot.classList.add('is-live');
      el.statusText.textContent = 'Live';
    } else if (kind === 'viewing') {
      el.statusText.textContent = 'Viewing';
    } else if (kind === 'offline') {
      el.statusDot.classList.add('is-warn', 'pulsing');
      el.statusText.textContent = 'Offline';
    } else {
      el.statusText.textContent = 'Connecting';
    }
  }

  function updateViewerBanner() {
    const isViewer = role === 'viewer';
    el.viewerBanner.classList.toggle('hidden', !isViewer);
    if (!isViewer) return;
    if (hasController) {
      el.vbNote.classList.remove('hidden');
      el.vbClaim.classList.add('hidden');
    } else {
      el.vbNote.classList.add('hidden');
      el.vbClaim.classList.remove('hidden');
    }
  }

  function setRole(next) {
    role = next;
    setStatus(role === 'controller' ? 'live' : 'viewing');
    updateViewerBanner();
  }

  function showSplash() {
    if (splashShown) return;
    splashShown = true;
    el.splashEyebrow.textContent = `Connected to ${config ? config.label : 'the window'}`;
    el.splashHead.innerHTML =
      role === 'controller' ? 'You&rsquo;re in&nbsp;control.' : 'Someone is exploring.';
    setTimeout(() => el.splash.classList.add('leaving'), role === 'controller' ? 2100 : 2400);
  }

  /* ---------------------------------------------------------- realtime */

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const src = params.get('src') || 'direct';
    ws = new WebSocket(
      `${proto}//${location.host}/ws?role=phone&screen=${encodeURIComponent(screenId)}&session=${encodeURIComponent(sessionId)}&src=${encodeURIComponent(src)}`
    );

    ws.onopen = () => {
      retryMs = 1000;
    };

    ws.onmessage = (evt) => {
      let msg;
      try {
        msg = JSON.parse(evt.data);
      } catch {
        return;
      }
      handle(msg);
    };

    ws.onclose = () => {
      setStatus('offline');
      setTimeout(connect, retryMs);
      retryMs = Math.min(retryMs * 2, 8000);
    };
  }

  function handle(msg) {
    switch (msg.type) {
      case 'init': {
        hasController = msg.hasController;
        if (msg.slide && msg.slide.kind === 'artwork') renderArtwork(msg.slide.index, { silent: true });
        if (params.get('src') === 'qr' && !sessionStorage.getItem('igw-qr-tracked')) {
          sessionStorage.setItem('igw-qr-tracked', '1');
          track('qr_scan');
        }
        if (autoClaim) ws.send(JSON.stringify({ type: 'claim' }));
        else setRole('viewer');
        break;
      }
      case 'role': {
        setRole(msg.role);
        showSplash();
        if (msg.role === 'controller') {
          el.ended.classList.add('hidden');
        }
        break;
      }
      case 'state': {
        hasController = msg.hasController;
        updateViewerBanner();
        if (role === 'controller' && msg.slide.kind === 'artwork' && msg.slide.index !== index) {
          renderArtwork(msg.slide.index);
        }
        break;
      }
      case 'warning': {
        if (role === 'controller') el.timeout.classList.remove('hidden');
        break;
      }
      case 'session': {
        if (msg.status === 'ended') {
          el.timeout.classList.add('hidden');
          autoClaim = false;
          setRole('viewer');
          el.ended.classList.remove('hidden');
        }
        break;
      }
      case 'control-available': {
        hasController = false;
        updateViewerBanner();
        break;
      }
    }
  }

  function claim() {
    autoClaim = true;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'claim' }));
  }

  function heartbeat(force) {
    if (role !== 'controller' || !ws || ws.readyState !== WebSocket.OPEN) return;
    const now = Date.now();
    if (!force && now - lastHeartbeat < 5000) return;
    lastHeartbeat = now;
    ws.send(JSON.stringify({ type: 'heartbeat' }));
  }

  /* -------------------------------------------------------- navigation */

  function nav(dir) {
    renderArtwork(index + (dir === 'next' ? 1 : -1));
    if (role === 'controller' && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'navigate', dir }));
    }
    el.timeout.classList.add('hidden');
  }

  el.prevBtn.addEventListener('click', () => nav('prev'));
  el.nextBtn.addEventListener('click', () => nav('next'));

  /* swipe — follows the finger, snaps, then commits */

  let drag = null;

  el.stage.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, dx: 0 };
    el.swiper.classList.add('dragging');
  });

  el.stage.addEventListener('pointermove', (e) => {
    if (!drag) return;
    drag.dx = e.clientX - drag.x;
    el.swiper.style.transform = `translateX(${drag.dx * 0.85}px)`;
    el.swiper.style.opacity = String(1 - Math.min(Math.abs(drag.dx) / 480, 0.35));
  });

  const endDrag = () => {
    if (!drag) return;
    const { dx } = drag;
    drag = null;
    el.swiper.classList.remove('dragging');
    el.swiper.style.transform = '';
    el.swiper.style.opacity = '';
    if (Math.abs(dx) > 56) nav(dx < 0 ? 'next' : 'prev');
  };

  el.stage.addEventListener('pointerup', endDrag);
  el.stage.addEventListener('pointercancel', endDrag);

  /* --------------------------------------------------------- accordions */

  function toggleAccordion(row, body, onOpen) {
    const open = row.getAttribute('aria-expanded') === 'true';
    closeAccordions();
    if (!open) {
      row.setAttribute('aria-expanded', 'true');
      body.style.maxHeight = `${body.scrollHeight}px`;
      if (onOpen) onOpen();
    }
  }

  el.rowAbout.addEventListener('click', () =>
    toggleAccordion(el.rowAbout, el.bodyAbout, () =>
      track('about_opened', { artworkId: artwork().id })
    )
  );

  el.rowArtist.addEventListener('click', () =>
    toggleAccordion(el.rowArtist, el.bodyArtist, () =>
      track('artist_opened', { artworkId: artwork().id })
    )
  );

  el.rowInstagram.addEventListener('click', () =>
    track('instagram_clicked', { artworkId: artwork().id })
  );

  /* -------------------------------------------------------------- save */

  const savedKey = 'igw-saved';
  const savedList = () => JSON.parse(localStorage.getItem(savedKey) || '[]');
  const isSaved = (id) => savedList().some((s) => s.artworkId === id);

  function renderSaveState() {
    const saved = isSaved(artwork().id);
    el.saveMark.textContent = saved ? '✓' : '+';
    el.saveMark.classList.toggle('is-saved', saved);
  }

  el.rowSave.addEventListener('click', () => {
    const a = artwork();
    if (!isSaved(a.id)) {
      localStorage.setItem(
        savedKey,
        JSON.stringify([...savedList(), { screenId, artworkId: a.id, ts: Date.now() }])
      );
      track('artwork_saved', { artworkId: a.id });
      toast('Saved on this phone');
    } else {
      toast('Already saved');
    }
    renderSaveState();
  });

  /* ------------------------------------------------------------- share */

  el.rowShare.addEventListener('click', async () => {
    const a = artwork();
    const url = `${location.origin}/control/${screenId}?art=${encodeURIComponent(a.id)}`;
    track('artwork_shared', { artworkId: a.id });
    if (navigator.share) {
      navigator.share({ title: `${a.title} — ${artistName(a)}`, url }).catch(() => {});
    } else if (navigator.clipboard) {
      await navigator.clipboard.writeText(url).catch(() => {});
      toast('Link copied');
    }
  });

  /* ------------------------------------------------------------- sheet */

  function openSheet() {
    el.sheetForm.classList.remove('hidden');
    el.sheetSuccess.classList.add('hidden');
    el.formError.classList.add('hidden');
    el.sheet.classList.add('open');
    el.sheet.setAttribute('aria-hidden', 'false');
    el.backdrop.classList.add('visible');
    track('contact_started', { artworkId: artwork().id });
  }

  function closeSheet() {
    el.sheet.classList.remove('open');
    el.sheet.setAttribute('aria-hidden', 'true');
    el.backdrop.classList.remove('visible');
  }

  el.rowPrice.addEventListener('click', openSheet);
  el.sheetClose.addEventListener('click', closeSheet);
  el.backdrop.addEventListener('click', closeSheet);
  el.successClose.addEventListener('click', closeSheet);

  el.requestForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = el.fName.value.trim();
    const email = el.fEmail.value.trim();
    if (!name || !/.+@.+\..+/.test(email)) {
      el.formError.classList.remove('hidden');
      return;
    }
    el.formError.classList.add('hidden');
    el.submitBtn.disabled = true;
    try {
      const res = await fetch('/api/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          screenId,
          sessionId,
          artworkId: artwork().id,
          name,
          email,
          message: el.fMessage.value.trim(),
        }),
      });
      if (!res.ok) throw new Error('request failed');
      el.sheetForm.classList.add('hidden');
      el.sheetSuccess.classList.remove('hidden');
      el.requestForm.reset();
    } catch {
      el.formError.textContent = 'Something went wrong. Please try again.';
      el.formError.classList.remove('hidden');
    } finally {
      el.submitBtn.disabled = false;
    }
  });

  /* ----------------------------------------------------- session ends */

  el.keepBtn.addEventListener('click', () => {
    heartbeat(true);
    el.timeout.classList.add('hidden');
  });

  el.reclaimBtn.addEventListener('click', () => {
    el.ended.classList.add('hidden');
    claim();
  });

  el.continueBtn.addEventListener('click', () => {
    el.ended.classList.add('hidden');
    updateViewerBanner();
  });

  el.vbClaim.addEventListener('click', claim);

  /* every touch is life — keep the session warm */

  ['pointerdown', 'keydown'].forEach((evt) =>
    document.addEventListener(evt, () => heartbeat(!el.timeout.classList.contains('hidden')))
  );

  /* --------------------------------------------------------------- boot */

  async function boot() {
    setStatus('connecting');
    const res = await fetch(`/api/screens/${encodeURIComponent(screenId)}`);
    if (!res.ok) {
      el.splashEyebrow.textContent = 'Unknown window';
      el.splashHead.textContent = 'This QR code is not active.';
      return;
    }
    const data = await res.json();
    config = data.screen;
    artworks = data.artworks;

    document.title = `${config.gallery} — You're in control`;
    el.brand.textContent = config.gallery;

    const requested = params.get('art');
    const startIndex = Math.max(
      0,
      artworks.findIndex((a) => a.id === requested)
    );
    renderArtwork(requested ? startIndex : 0, { silent: true });

    connect();
  }

  boot();
})();
