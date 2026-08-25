# Interactive Gallery Window

**PUBLIC SCREEN. PRIVATE CONTROL.**

A gallery window becomes an interface: a large screen shows art around the clock, passers-by scan a QR code and their phone becomes the remote control of the window — live, no app, no sign-up. *Scan → Connect → Control.*

The full UX & technical concept (German) lives in **[CONCEPT.md](CONCEPT.md)**.

> Ein Produkt by **Urban Artist Club** · artworks © Buko

---

## Quick start

```bash
npm install
npm start
```

The hub prints its LAN URLs on boot:

```
Window 01 · Hamburg
  window   http://<lan-ip>:4680/screen/gallery-hamburg-window-01
  control  http://<lan-ip>:4680/control/gallery-hamburg-window-01

backstage  http://<lan-ip>:4680/
```

**Demo:** open the *window* URL fullscreen on the big display (kiosk mode), then scan the QR code on the screen with a phone — or open the *control* URL on any second device in the same network. Navigating on the phone mirrors live on the window (target latency < 300 ms); the phone shows the same work plus details and actions.

| Env var | Default | Purpose |
|---|---|---|
| `PORT` | `4680` | HTTP + WebSocket port |
| `BASE_URL` | *(auto)* | Optional override for the QR target — by default the QR derives its public URL from the request host (works behind Render/tunnels unchanged) |
| `SESSION_TIMEOUT_MS` | `75000` | Controller inactivity timeout |
| `SESSION_WARNING_MS` | `30000` | "Still exploring?" lead time before timeout |

Per-window settings (dwell times, CTA rhythm, playlist) live in [content/screens.json](content/screens.json).

## How it works

One Node process (`server/index.js`) owns the truth: it assigns the **control lock** (first come, first control), runs **session timers** (warning → timeout → back to idle), drives the **idle rotation** including the *DON'T JUST LOOK. TAKE CONTROL.* interstitial, generates the **QR code** per window and appends **leads** and an **analytics event stream** as JSONL under `data/`.

Screens and phones are dependency-free vanilla-JS pages connected over WebSocket — thin renderers of server state, with auto-reconnect; the window falls back to a local loop if the hub disappears, so the glass is never black.

```
public/screen/…    the stage      — fullscreen art, caption, QR wall label, CONNECTED flash, LIVE tag
public/control/…   the remote     — swipe/prev/next, about/artist, Instagram, save, share,
                                    price-request sheet, KEEP CONTROL, session-ended state, viewer mode
server/index.js    the truth      — lock, sessions, rotation, content API, QR, leads, events
content/*.json     the exhibition — artists, artworks, windows, playlists
```

Roles are deliberately split: **the window creates desire, the phone creates interaction.** Personal actions (price requests, contact, saved works) never appear on the public screen.

## Content

- [content/artworks.json](content/artworks.json) — artists + artworks (title, year, medium, dimensions, description, price/priceOnRequest, Instagram…). Titles, years and dimensions of the five Buko works are **editable placeholders**; the artist's Instagram URL is a placeholder too — replace with the real handle.
- [content/screens.json](content/screens.json) — windows with curated playlists and timing.
- `public/artworks/*.jpg` — image files (LAN-served; add `srcset` variants for WAN deployments).
- `public/uac-badge.svg` — Urban Artist Club badge, currently a **vector recreation**; drop the original artwork file in under the same name for 1:1 fidelity.

## Leads & analytics

- `POST /api/requests` → `data/requests.jsonl` — price requests, automatically tied to artwork, artist, window and session.
- Event stream → `data/events.jsonl`; live aggregates at `GET /api/stats`.
- Taxonomy: `screen_view` · `qr_scan` · `session_started` · `control_claimed` · `artwork_viewed` · `artwork_changed` · `about_opened` · `artist_opened` · `instagram_clicked` · `price_requested` · `artwork_saved` · `artwork_shared` · `contact_started` · `control_released` · `session_ended {durationMs}`.

No accounts, no cookies, no third-party trackers.

## MVP status

All twelve MVP functions from the brief are implemented and tested end-to-end: fullscreen window, idle loop with CTA interstitial, QR connect, controller with swipe/prev/next, realtime mirroring, artwork/artist info, Instagram, price request, session timeout with warning, return to idle, and first-come-first-control multi-user behaviour (*Someone is currently exploring the window.* → *TAKE CONTROL* when free).

Roadmap and extension paths (queue, CMS, video/sound art, voting, AI guide …): see [CONCEPT.md](CONCEPT.md), sections 12–13.
