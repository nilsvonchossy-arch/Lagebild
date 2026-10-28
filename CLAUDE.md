# Lagebild – tägliches News-Update als TikTok-Ersatz

## Ziel
Ich will TikTok deinstallieren und trotzdem jeden Tag auf dem neuesten Stand bleiben. Lagebild ist mein persönliches tägliches News-Update mit animiertem Globus, Sprecherstimme, Untertiteln und frei wählbaren Themen. Es läuft vor allem auf meinem iPad. Vorbild für den Stil sind zwei TikTok-Accounts (Conflictly und Netwatch Global), siehe `docs/stilanalyse.md`.

## Arbeitsweise
- Mit mir auf Deutsch kommunizieren, knapp und direkt. Fehler offen benennen.
- Meldungen dürfen nur Fakten aus der verlinkten Quelle enthalten. Nichts dazuerfinden und keine eigene Interpretation als Fakt ausgeben. Jede Meldung braucht Quelle, URL und Datum.
- Nur den Stil der Vorbilder übernehmen, nicht ihre Inhalte und nicht ihr Militär-Drama. Keine Videoclips aus unklarer Quelle.

## Stand
Aus dem Prototyp (`docs/prototyp.html`, eine Datei aus dem Claude-Chat) ist eine richtige App geworden. Den Fortschritt halte ich hier fest.
- **App:** Vite + TypeScript ohne Framework, Module in `src/`: `globe.ts` (Canvas, Kamerafahrt, Pin), `player.ts` (Ablauf Intro → Meldungen → Outro), `card.ts`, `fx.ts` (Entschlüsseln, Hochzählen, Untertitel), `audio.ts` (Bass-Teppich, Stimme), `topics.ts` (Themen-Editor), `github.ts` (Speichern ins Repo), `main.ts` (Oberfläche).
- **PWA:** Manifest, Icon, Service Worker; offline nutzbar. Deploy über `.github/workflows/deploy.yml` auf GitHub Pages.
- **Weltkarte:** lokal aus `world-atlas` (110m für den Globus, 50m wird nachgeladen und bei engem Ausschnitt gezeichnet). `src/geo/countries.json` übersetzt ISO-3 in die Zahlencodes von world-atlas (erzeugt mit `npm run gen:countries`).
- **Flüssigkeit:** Der Globus wird in einen Zwischenspeicher gezeichnet und nur bei Kamerabewegung neu berechnet; unsichtbare Flächen werden übersprungen.
- **Themen:** `config/themen.json`, bearbeitbar in der App (Einstellungen). Gespeichert wird per GitHub-API mit einem Fine-grained Token, der nur auf dem iPad liegt.
- **Pipeline:** `pipeline/run.ts`, gestartet von `.github/workflows/update.yml` (ab 6:45 Uhr Berlin, Wiederholungen bis 8:45). Schritte: `sources.ts` (RSS + GDELT) → `editorial.ts` (Auswahl, Schreiben, Faktencheck mit Claude) → `extract.ts` (Volltext) → `geo.ts` (Ort, Zoom) → `assemble.ts` → `tts.ts` (Azure) → `store.ts`. Einstellungen in `config/pipeline.json`.
- **Querformat:** Ab 900 px Breite (iPad quer) steht der Globus links, Untertitel, Karte und Steuerung rechts (`#app.wide`, Ziele des Globus rechnet `measure()` in `main.ts`).
- **Recherche:** 59 RSS-Feeds (`config/quellen.json`). Die Suchbegriffe aller Themen werden zusätzlich auf alle Feed-Artikel angewendet, damit wirken auch eigene Themen ohne eigene Feeds. GDELT nur für Themen mit zu wenig Treffern (drosselt geteilte GitHub-Server).
- **Marktdaten:** `pipeline/markets.ts` holt Kurse (Yahoo Finance) und baut die gesprochenen Sätze ohne KI aus den Zahlen. In der App ein eigener Abschnitt nach den Meldungen.
- **Daten:** Branch `daten` mit `JJJJ-MM-TT.json`, `index.json`, `audio/` (14 Tage) und `logs/` (Kosten, verworfene Meldungen und Prüfprotokoll). Der Branch wird bei jedem Lauf als einzelner Commit neu geschrieben, damit das Repo nicht wächst. Ohne Daten zeigt die App `public/demo/2026-10-27.json`.
- **Vorschau ohne Konten:** private claude.ai-Seite https://claude.ai/artifact/1f8cZC4BGbMBqFDg1Lq8XG mit den Demo-Meldungen (ohne Service Worker, Themen-Editor speichert nicht). Neu bauen mit `npm run vorschau`, dann `vorschau/lagebild.html` mit den Dateien aus `vorschau/files.json` an dieselbe Adresse veröffentlichen.
- **Befehle:** `npm run dev`, `npm run build`, `npm test`, `npm run typecheck`, `npm run update`, `npm run check-feeds`, `npm run vorschau`.

## Entscheidungen (27.10.2026)
- **Hosting:** Repo öffentlich, GitHub Pages, Deploy per GitHub Actions. Als PWA auf dem iPad-Homescreen.
- **Stimme:** Azure Speech (Gratis-Kontingent F0), zwei Stimmen: eine für BRIEFING, eine für LAGE und EINORDNUNG.
- **Claude-Modell:** Erst Opus 5.5, Sonnet 5.5 und Haiku 5.5 auf denselben Artikeln vergleichen, dann entscheide ich.
- **Uhrzeit:** Update um 8:00 Uhr fertig (Europe/Berlin).
- **Themen:** 5 Kategorien: Geopolitik & Sicherheit (USA-Politik, Nahost, Russland/Ukraine & NATO, China & Taiwan), Deutschland, Wirtschaft & Märkte (Wirtschaft, Marktanalyse), KI & Technologie (KI-Neuentwicklungen, KI & Arbeit, KI-Risiken & Regulierung, Cybersicherheit), Wissenschaft & Klima. Jede Meldung bekommt eine Relevanz 1–5. Eigene Themen kann ich im Interface hinzufügen; sie steuern die Recherche.
- **Quellen:** deutsche und internationale Medien gemischt, nur frei lesbare Artikel (der Faktencheck braucht den Volltext).
- **Weiter offen:** Budget-Grenze für die API, sobald der Modellvergleich vorliegt.

## Nächste Schritte
1. Konten einrichten (`docs/einrichtung.md`), erster echter Lauf, Modellvergleich auswerten.
2. Stimmen-Auswahl anhand von Hörproben.
3. Marktdaten-Kachel (DAX, S&P 500, Nasdaq, EUR/USD, Gold, Öl, Bitcoin).
4. Feinschliff: Querformat am iPad, flüssigere Übergänge, Steuerung über den Sperrbildschirm.

## Bekannte Probleme
- Claude- und Azure-Teil der Pipeline sind erst live getestet, wenn die Schlüssel eingetragen sind (`docs/einrichtung.md`). Bis dahin überspringt der tägliche Lauf das Update mit einer Warnung, und der Deploy überspringt sich, solange GitHub Pages aus ist.
- Times of Israel und AP sperren GitHub-Server (403), dafür Jerusalem Post. Feeds prüfen: Workflow „Tages-Update“ mit `check-feeds`, neue Adressen testen mit `probe`.
- Das Claude-SDK reicht Auswahlwerte (enum) nur als Beschreibung an das Modell weiter; Rollen und Prüfergebnisse werden deshalb im Code normalisiert.
- Ohne Audiodatei (Archiv älter als 14 Tage, Azure-Kontingent leer) spricht die Systemstimme des Geräts.

## Datenschema (`src/shared/types.ts`, Version 1)
Ein Tag ist ein `Briefing`; Kategorien bringen ihre Farben mit, damit ältere Tage im Archiv gleich aussehen.
```js
{
  schema: 1, date: '2026-10-27', generated: '2026-10-27T07:12:00+01:00',
  categories: [{ id: 'geopolitik', name: 'Geopolitik & Sicherheit', color: '#ff7a3d' }],
  intro: { morning: Line, day: Line, evening: Line },   // Begrüßung je nach Tageszeit
  outro: [Line, …],                                       // Zusammenfassung, „Bis morgen.“
  stories: [Story, …]
}
// Line
{ role: 'BRIEFING' | 'LAGE' | 'EINORDNUNG', text: 'Untertitel', say: 'optional: abweichender Sprechtext',
  audio: { src: 'audio/2026-10-28/israel-1.mp3', dur: 4.2, words: [[0.31, 0.12], …] } }  // [Sekunde, Anteil] am Wortende
// Story
{
  id: 'israel',
  category: 'geopolitik',        // Kategorie-ID, bestimmt die Farbe
  topic: 'Nahost-Konflikt',      // Anzeigename des Themas
  relevance: 4,                  // 1–5, Einschätzung, kein Fakt
  country: 'ISR',                // ISO-3-Code für die Hervorhebung
  label: 'ISRAEL', flag: '🇮🇱',
  lon: 35.21, lat: 31.77, zoom: 10,
  headline: '[Israel] wählt mit [Rekord]beteiligung',   // [..] = Akzentfarbe
  brief: 'Kurz gesagt-Absatz, 2–4 Sätze',
  figure: { value: 55.7, dec: 1, prefix: '', suffix: ' %', label: 'Wahlbeteiligung um 16 Uhr' },  // optional
  source: { name: 'Times of Israel', url: 'https://…', date: '2026-10-27' },
  short: 'Rekordbeteiligung in Israel',                 // für die Zusammenfassung im Outro
  opener: Line,                                         // BRIEFING-Überleitung vor der Meldung
  lines: [Line, …]                                      // LAGE und EINORDNUNG
}
```
