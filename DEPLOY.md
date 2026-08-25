# Deployment

Der Prototyp ist **ein dauerhaft laufender Node-Prozess mit WebSockets** (Control-Lock, Session-Timer, Idle-Rotation laufen serverseitig). Das bestimmt die Host-Wahl.

## Warum nicht Netlify?

Netlify hostet statische Seiten und kurzlebige Serverless Functions. Es bietet **keine dauerhaften WebSocket-Server, keinen Dauerprozess und kein beschreibbares Dateisystem** — genau die drei Dinge, die der Realtime-Hub braucht. Ein Git-Deploy auf Netlify würde „grün" durchlaufen, aber Screen und Phone könnten sich nie verbinden.

*Netlify-Pfad, falls irgendwann gewünscht:* Frontends statisch auf Netlify + Realtime über einen Managed-Dienst (z. B. Supabase Realtime) + Functions für Leads. Das ist der im [CONCEPT.md](CONCEPT.md) beschriebene Skalierungspfad — ein bewusster Umbau, kein Ein-Klick-Deploy.

## Empfohlen: Git-Connect-Host mit WebSocket-Support

Gleicher Komfort wie Netlify (GitHub verbinden → Auto-Deploy bei jedem Push), aber mit Dauerprozess. Das Repo bringt ein `Dockerfile` mit — damit funktioniert jeder der folgenden Anbieter ohne weitere Konfiguration:

| Anbieter | Setup | Hinweis |
|---|---|---|
| **Render** ⭐ | *New → Blueprint → Repo wählen → Apply* (nutzt [render.yaml](render.yaml)) | Free-Tier schläft nach Inaktivität (erster Scan dann ~30–60 s langsam) — für ein echtes Schaufenster den kleinsten Paid-Tier nehmen |
| **Railway** | *New Project → Deploy from GitHub repo* | sehr schnelles Setup, usage-based |
| **Fly.io** | `fly launch` (nutzt das Dockerfile) | am flexibelsten, CLI-basiert |

**Render, Schritt für Schritt (einmalig, ~2 Minuten):**

1. [dashboard.render.com](https://dashboard.render.com) → *Sign in with GitHub* (Account mit Zugriff auf `HHDS85/Interactive-Gallery-Window`).
2. *New → Blueprint* → Repo `Interactive-Gallery-Window` wählen → *Apply*.
3. Warten bis der Build grün ist → die `https://….onrender.com`-URL ist Screen + Controller + API in einem.

Ab dann deployt **jeder Push auf `main` automatisch**. Environment-Variablen sind nicht nötig: `PORT` setzt Render selbst, und die **QR-Codes leiten ihre öffentliche URL automatisch aus dem Request ab** (`BASE_URL` bleibt als optionaler Override, z. B. für eine eigene Domain).

Wichtig zu wissen:

- **`data/` ist auf diesen Plattformen flüchtig** — Leads (`requests.jsonl`) und Events überleben kein Redeploy. Für den Testbetrieb okay; für den echten Betrieb ein Volume mounten oder auf Postgres/CRM umstellen (siehe CONCEPT, Kapitel 08).
- HTTPS kommt vom Host automatisch — nötig für Kamera-Scan-Komfort, `navigator.share` und PWA-Fähigkeit.
- Die öffentliche URL ist ungeschützt: Wer sie kennt, kann den Screen steuern und Anfragen senden. Für den Produktivbetrieb ggf. Screen-URL mit Token versehen.

## Schneller Live-Test ohne Account (Tunnel)

Für spontane Tests lässt sich der lokale Server öffentlich machen:

```bash
npm start
```

```bash
ssh -R 80:localhost:4680 nokey@localhost.run
```

Der Tunnel druckt eine `https://….lhr.life`-URL — Screen und Controller darüber öffnen, fertig: Der QR-Code zeigt automatisch auf die Tunnel-URL (Host-Ableitung). Die URL lebt, solange der SSH-Prozess läuft, und wechselt bei jedem Neustart.
