# Deployment

Der Prototyp ist **ein dauerhaft laufender Node-Prozess mit WebSockets** (Control-Lock, Session-Timer, Idle-Rotation laufen serverseitig). Das bestimmt die Host-Wahl.

## Warum nicht Netlify?

Netlify hostet statische Seiten und kurzlebige Serverless Functions. Es bietet **keine dauerhaften WebSocket-Server, keinen Dauerprozess und kein beschreibbares Dateisystem** — genau die drei Dinge, die der Realtime-Hub braucht. Ein Git-Deploy auf Netlify würde „grün" durchlaufen, aber Screen und Phone könnten sich nie verbinden.

*Netlify-Pfad, falls irgendwann gewünscht:* Frontends statisch auf Netlify + Realtime über einen Managed-Dienst (z. B. Supabase Realtime) + Functions für Leads. Das ist der im [CONCEPT.md](CONCEPT.md) beschriebene Skalierungspfad — ein bewusster Umbau, kein Ein-Klick-Deploy.

## Empfohlen: Git-Connect-Host mit WebSocket-Support

Gleicher Komfort wie Netlify (GitHub verbinden → Auto-Deploy bei jedem Push), aber mit Dauerprozess. Das Repo bringt ein `Dockerfile` mit — damit funktioniert jeder der folgenden Anbieter ohne weitere Konfiguration:

| Anbieter | Setup | Hinweis |
|---|---|---|
| **Render** | *New → Web Service → GitHub-Repo wählen* (erkennt das Dockerfile) | Free-Tier schläft nach Inaktivität (erster Scan dann ~30–60 s langsam) — für ein echtes Schaufenster den kleinsten Paid-Tier nehmen |
| **Railway** | *New Project → Deploy from GitHub repo* | sehr schnelles Setup, usage-based |
| **Fly.io** | `fly launch` (nutzt das Dockerfile) | am flexibelsten, CLI-basiert |

**Nach dem ersten Deploy zwei Environment-Variablen setzen:**

```
BASE_URL=https://<deine-app-url>        # damit die QR-Codes öffentlich auflösen
PORT=4680                                # bzw. den vom Host vorgegebenen Port übernehmen
```

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

Der Tunnel druckt eine `https://….lhr.life`-URL. Server mit `BASE_URL=<tunnel-url> npm start` neu starten, damit der QR-Code auf die öffentliche URL zeigt. Die URL lebt, solange der SSH-Prozess läuft, und wechselt bei jedem Neustart.
