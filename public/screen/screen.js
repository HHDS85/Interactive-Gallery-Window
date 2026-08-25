/* GALLERY WINDOW SCREEN — thin renderer.
   The hub owns the truth; this file only stages it beautifully.
   If the hub disappears, a local loop keeps the window alive. */

(() => {
  const screenId = location.pathname.split('/').filter(Boolean)[1];

  const $ = (id) => document.getElementById(id);
  const layers = [$('layerA'), $('layerB')];
  const el = {
    brandName: $('brandName'),
    brandSub: $('brandSub'),
    index: $('index'),
    caption: $('caption'),
    capArtist: $('capArtist'),
    capTitle: $('capTitle'),
    capMeta: $('capMeta'),
    capPrice: $('capPrice'),
    qrLabel: $('qrLabel'),
    qrImg: $('qrImg'),
    qrImgLarge: $('qrImgLarge'),
    liveTag: $('liveTag'),
    progress: $('progress'),
    progressBar: $('progressBar'),
    cta: $('cta'),
    flash: $('flash'),
    offlineDot: $('offlineDot'),
  };

  let artworks = [];
  let config = null;
  let front = 0; // visible layer index
  let currentArtId = null;
  let kbFlip = false;
  let mode = 'idle';
  let localTimer = null;
  let localIndex = 0;
  let ws = null;
  let retryMs = 1000;

  /* ---------------------------------------------------------- rendering */

  const pad = (n) => String(n).padStart(2, '0');

  function setChrome(artwork, index) {
    el.index.textContent = `${pad(index + 1)} — ${pad(artworks.length)}`;
    el.capArtist.textContent = artwork.artist ? artwork.artist.name : '';
    el.capTitle.textContent = artwork.title;
    el.capMeta.textContent = `${artwork.year} · ${artwork.medium}`;
    el.capPrice.classList.toggle('hidden', !artwork.priceOnRequest);
    el.caption.classList.remove('refresh');
    void el.caption.offsetWidth; // restart the rise animation
    el.caption.classList.add('refresh');
  }

  function setArtwork(artwork, index) {
    if (!artwork) return;
    if (currentArtId === artwork.id) {
      setModeChrome();
      return;
    }
    currentArtId = artwork.id;
    const back = layers[1 - front];
    const img = back.querySelector('img');
    img.className = '';
    img.src = artwork.image;

    const swap = () => {
      if (currentArtId !== artwork.id) return; // superseded meanwhile
      back.classList.add('visible');
      layers[front].classList.remove('visible');
      front = 1 - front;
      if (mode === 'idle') {
        kbFlip = !kbFlip;
        img.classList.add('kb');
        img.classList.toggle('kb-alt', kbFlip);
      }
      setChrome(artwork, index);
    };

    (img.decode ? img.decode().catch(() => {}) : Promise.resolve()).then(swap);
  }

  function runProgress(dwellMs) {
    el.progressBar.classList.remove('run');
    if (!dwellMs) return;
    void el.progressBar.offsetWidth;
    el.progressBar.style.animationDuration = `${dwellMs}ms`;
    el.progressBar.classList.add('run');
  }

  function setModeChrome() {
    const idle = mode === 'idle';
    el.qrLabel.classList.toggle('hidden', !idle);
    el.liveTag.classList.toggle('visible', !idle);
    el.progress.classList.toggle('hidden', !idle);
  }

  function apply(payload) {
    mode = payload.mode;
    setModeChrome();
    if (payload.slide.kind === 'cta') {
      el.cta.classList.add('visible');
      el.cta.setAttribute('aria-hidden', 'false');
      runProgress(0);
      return;
    }
    el.cta.classList.remove('visible');
    el.cta.setAttribute('aria-hidden', 'true');
    const index = payload.slide.index;
    localIndex = index;
    setArtwork(artworks[index], index);
    runProgress(mode === 'idle' ? payload.dwellMs : 0);
  }

  function flash() {
    el.flash.classList.add('visible');
    setTimeout(() => el.flash.classList.remove('visible'), 2000);
  }

  /* --------------------------------------------------- offline fallback */

  function startLocalLoop() {
    if (localTimer || !artworks.length) return;
    const dwell = (config && config.idleDwellMs) || 12000;
    localTimer = setInterval(() => {
      localIndex = (localIndex + 1) % artworks.length;
      mode = 'idle';
      setModeChrome();
      el.cta.classList.remove('visible');
      setArtwork(artworks[localIndex], localIndex);
      runProgress(dwell);
    }, dwell);
  }

  function stopLocalLoop() {
    clearInterval(localTimer);
    localTimer = null;
  }

  /* ----------------------------------------------------------- realtime */

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${proto}//${location.host}/ws?role=screen&screen=${encodeURIComponent(screenId)}`);

    ws.onopen = () => {
      retryMs = 1000;
      el.offlineDot.classList.remove('visible');
      stopLocalLoop();
    };

    ws.onmessage = (evt) => {
      let msg;
      try {
        msg = JSON.parse(evt.data);
      } catch {
        return;
      }
      if (msg.type === 'init' || msg.type === 'state') apply(msg);
      if (msg.type === 'connected-flash') flash();
    };

    ws.onclose = () => {
      el.offlineDot.classList.add('visible');
      startLocalLoop();
      setTimeout(connect, retryMs);
      retryMs = Math.min(retryMs * 2, 8000);
    };
  }

  /* --------------------------------------------------------------- boot */

  async function boot() {
    const res = await fetch(`/api/screens/${encodeURIComponent(screenId)}`);
    if (!res.ok) {
      el.brandName.textContent = 'Unknown window';
      return;
    }
    const data = await res.json();
    config = data.screen;
    artworks = data.artworks;

    document.title = `${config.gallery} — Gallery Window`;
    el.brandName.textContent = config.gallery;
    el.brandSub.textContent = config.galleryClaim || config.label;
    el.qrImg.src = `/qr/${encodeURIComponent(screenId)}.svg`;
    el.qrImgLarge.src = `/qr/${encodeURIComponent(screenId)}.svg`;

    // warm the full playlist only after the first work is on stage
    setTimeout(() => {
      artworks.forEach((a) => {
        const pre = new Image();
        pre.src = a.image;
      });
    }, 1500);

    setArtwork(artworks[0], 0);
    connect();

    // keep the panel awake in kiosk situations (best effort)
    if (navigator.wakeLock && navigator.wakeLock.request) {
      const grab = () => navigator.wakeLock.request('screen').catch(() => {});
      grab();
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') grab();
      });
    }
  }

  boot();
})();
