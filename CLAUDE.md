# Lagebild – tägliches News-Update als TikTok-Ersatz

## Ziel
Ich will TikTok deinstallieren und trotzdem jeden Tag auf dem neuesten Stand bleiben. Lagebild ist mein persönliches tägliches News-Update mit animiertem Globus, Sprecherstimme, Untertiteln und frei wählbaren Themen. Es läuft vor allem auf meinem iPad. Vorbild für den Stil sind zwei TikTok-Accounts (Conflictly und Netwatch Global), siehe `docs/stilanalyse.md`.

## Arbeitsweise
- Mit mir auf Deutsch kommunizieren, knapp und direkt. Fehler offen benennen.
- Meldungen dürfen nur Fakten aus der verlinkten Quelle enthalten. Nichts dazuerfinden und keine eigene Interpretation als Fakt ausgeben. Jede Meldung braucht Quelle, URL und Datum.
- Nur den Stil der Vorbilder übernehmen, nicht ihre Inhalte und nicht ihr Militär-Drama. Keine Videoclips aus unklarer Quelle.

## Stand
Aus dem Prototyp (`docs/prototyp.html`, eine Datei aus dem Claude-Chat) wird eine richtige App. Den Fortschritt halte ich hier fest.
- **App:** Vite + TypeScript ohne Framework, Module in `src/`: `globe.ts` (Canvas, Kamerafahrt, Pin), `player.ts` (Ablauf Intro → Meldungen → Outro), `card.ts`, `fx.ts` (Entschlüsseln, Hochzählen, Untertitel), `audio.ts` (Bass-Teppich, Stimme), `main.ts` (Oberfläche).
- **Weltkarte:** lokal aus `world-atlas` (110m für den Globus, 50m wird nachgeladen und bei engem Ausschnitt gezeichnet). `src/geo/countries.json` übersetzt ISO-3 in die Zahlencodes von world-atlas (erzeugt mit `npm run gen:countries`).
- **Flüssigkeit:** Der Globus wird in einen Zwischenspeicher gezeichnet und nur bei Kamerabewegung neu berechnet; unsichtbare Flächen werden übersprungen.
- **Stimme:** vorproduzierte MP3s pro Zeile (kommt mit der Pipeline), Systemstimme als Rückfallebene, sonst Timer-Modus. Untertitel laufen synchron zur Audioposition.
- **Daten:** `data/JJJJ-MM-TT.json` und `data/index.json` kommen beim Deploy aus dem Branch `daten`. Bis dahin zeigt die App `public/demo/2026-10-27.json` (die fünf Prototyp-Meldungen).
- **Befehle:** `npm run dev`, `npm run build`, `npm test`, `npm run typecheck`.

## Entscheidungen (27.10.2026)
- **Hosting:** Repo öffentlich, GitHub Pages, Deploy per GitHub Actions. Als PWA auf dem iPad-Homescreen.
- **Stimme:** Azure Speech (Gratis-Kontingent F0), zwei Stimmen: eine für BRIEFING, eine für LAGE und EINORDNUNG.
- **Claude-Modell:** Erst Opus 5.5, Sonnet 5.5 und Haiku 5.5 auf denselben Artikeln vergleichen, dann entscheide ich.
- **Uhrzeit:** Update um 8:00 Uhr fertig (Europe/Berlin).
- **Themen:** 5 Kategorien: Geopolitik & Sicherheit (USA-Politik, Nahost, Russland/Ukraine & NATO, China & Taiwan), Deutschland, Wirtschaft & Märkte (Wirtschaft, Marktanalyse), KI & Technologie (KI-Neuentwicklungen, KI & Arbeit, KI-Risiken & Regulierung, Cybersicherheit), Wissenschaft & Klima. Jede Meldung bekommt eine Relevanz 1–5. Eigene Themen kann ich im Interface hinzufügen; sie steuern die Recherche.
- **Quellen:** deutsche und internationale Medien gemischt, nur frei lesbare Artikel (der Faktencheck braucht den Volltext).
- **Weiter offen:** Budget-Grenze für die API, sobald der Modellvergleich vorliegt.

## Nächste Schritte
1. PWA und Deploy auf GitHub Pages.
2. Themen-Konfiguration (`config/themen.json`) und Themen-Editor im Interface.
3. Pipeline (GitHub Actions): Recherche aus RSS und GDELT → Auswahl mit Relevanz → Volltext → Schreiben nur aus dem Quelltext → Faktencheck → JSON.
4. Azure-Stimmen mit Wort-Zeitmarken.
5. Täglicher Lauf um 8:00, Archiv, Marktdaten.

## Bekannte Probleme
- Die Systemstimme klingt je nach Gerät blechern (wird durch Azure ersetzt).
- Die Meldungen sind noch statisch (Demo), bis die Pipeline läuft.

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
