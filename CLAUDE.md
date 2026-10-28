# Lagebild – tägliches News-Update als TikTok-Ersatz

## Ziel
Ich will TikTok deinstallieren und trotzdem jeden Tag auf dem neuesten Stand bleiben. Lagebild ist mein persönliches tägliches News-Update mit animiertem Globus, Sprecherstimme, Untertiteln und frei wählbaren Themen. Es läuft vor allem auf meinem iPad. Vorbild für den Stil sind zwei TikTok-Accounts (Conflictly und Netwatch Global), siehe `docs/stilanalyse.md`.

## Arbeitsweise
- Mit mir auf Deutsch kommunizieren, knapp und direkt. Fehler offen benennen.
- Meldungen dürfen nur Fakten aus der verlinkten Quelle enthalten. Nichts dazuerfinden und keine eigene Interpretation als Fakt ausgeben. Jede Meldung braucht Quelle, URL und Datum.
- Nur den Stil der Vorbilder übernehmen, nicht ihre Inhalte und nicht ihr Militär-Drama. Keine Videoclips aus unklarer Quelle.

## Stand
Aus dem Prototyp (`docs/prototyp.html`, eine Datei aus dem Claude-Chat) ist eine richtige App geworden. Seit Runde 2 (28.10.2026) läuft jede Folge als Gespräch dreier Stimmen nach dem Vorbild Conflictly, siehe `docs/video-analyse-conflictly.md` (Abschnitte 4, 5, 9, 10) und `docs/drehbuch-beispiel.md`.
- **App:** Vite + TypeScript ohne Framework, Module in `src/`: `player.ts` (Ablauf nach Audio-Zeit), `audio.ts` (Audiodatei der Folge, Systemstimme als Rückfall, Bass-Teppich ohne Datei), `globe.ts` (Kamerafahrt, Hervorhebung, Pins, weitere Orte, Linien), `earth.ts` (Satellitenbild per WebGL), `card.ts` (Karte, Details), `fx.ts` (Untertitel-Blöcke, Hochzählen), `topics.ts` (Themen-Editor), `github.ts`, `main.ts`. Gemeinsame Regeln für App und Pipeline in `src/shared/script.ts` (Pausen, Untertitel-Blöcke, Bild-Beats, Abschlussformeln).
- **Ablauf einer Folge:** kein Grußtext, Datum und „Folge N“ nur als Grafik. Erster Satz = Kernaussage des Aufmachers. Die Kamera fliegt während der Frage von LEITUNG, die Karte erscheint mit der Antwort, Zahl und weitere Orte erscheinen beim Wort (Wortzeitmarken). Untertitel als Blöcke mit 6–10 Wörtern. Karte im Ablauf nur Flagge, Ort, eine Zeile; „Kurz gesagt“, Zahl und Quelle per Tippen auf die Karte und auf dem Endbildschirm. Am Ende Zusammenfassung mit drei Schlagworten und feste Abschlussformel.
- **Globus:** NASA Blue Marble (Dez. 2004), Black Marble 2016 (Stadtlichter) und Wolken in `public/earth/`, gemeinfrei, geladen mit dem Workflow „Texturen“. Darüber dünne Grenzen aus `world-atlas` (110m, 50m bei engem Ausschnitt). Ohne WebGL der alte Vektor-Globus.
- **PWA:** Manifest, Icon, Service Worker; offline nutzbar. Mit Audiodatei läuft die Folge bei gesperrtem iPad weiter (Sperrbildschirm-Steuerung über Media Session).
- **Themen:** `config/themen.json` (Version 2), bearbeitbar in der App. Gespeichert wird per GitHub-API mit einem Fine-grained Token, der nur auf dem iPad liegt.
- **Pipeline:** `pipeline/run.ts`, gestartet von `.github/workflows/update.yml` (ab 6:45 Uhr Berlin, Wiederholungen bis 8:45). Schritte: `sources.ts` (RSS + GDELT) → `editorial.ts` (Auswahl, Einzelfakten, Faktencheck je Fakt) → `plan.ts` (Format, Zeit, Route, ohne KI) → `drehbuch.ts` (Dialog mit Claude, danach Prüfung jeder Zeile; einfache Fassung aus den Fakten als Rückfall) → `assemble.ts` (Märkte, Zusammenfassung, Abschlussformel) → `tts.ts` (Azure, drei Stimmen) → `mix.ts` (Pausen, Lautheit, Musikbett, MP3 mit und ohne Musik) → `store.ts`. Einstellungen in `config/pipeline.json`.
- **Querformat:** Ab 900 px Breite (iPad quer) steht der Globus links, Untertitel, Karte und Steuerung rechts.
- **Recherche:** 59 RSS-Feeds (`config/quellen.json`). Suchbegriffe aller Themen wirken auch auf alle Feed-Artikel. GDELT nur für Themen mit zu wenig Treffern.
- **Marktdaten:** `pipeline/markets.ts` holt Kurse (Yahoo Finance) und baut die gesprochenen Sätze ohne KI aus den Zahlen; eigener Block vor der Zusammenfassung.
- **Daten:** Branch `daten` mit `JJJJ-MM-TT.json`, `index.json`, `audio/` (14 Tage) und `logs/` (Kosten, verworfene Meldungen, Prüfprotokoll von Faktencheck und Drehbuch). Der Branch wird bei jedem Lauf als einzelner Commit neu geschrieben. Ohne Daten zeigt die App die Demo-Folge `public/demo/2026-10-27.json`.
- **Offene Stimmen im Test:** Workflow „Stimmtest“ vertont den Dialog aus 10.4 mit Modellen aus VoiceStudio auf der CPU: VoxCPM2 (Apache-2.0, Stimmen aus Beschreibung, auch ruhigere Variante), Supertonic-3 (OpenRAIL-M, fertige Sprecher, schnell), OmniVoice (Gewichte nur nichtkommerziell, CC-BY-NC). Ergebnis in den Branches `stimmtest-<modell>`; Workflow „Stimmprüfung“ lässt Whisper mitschreiben und vergleicht mit dem Sprechtext. VoxCPM2 braucht etwa 12 Minuten Rechenzeit pro Minute Audio.
- **Vorschau ohne Konten:** private claude.ai-Seite https://claude.ai/artifact/1f8cZC4BGbMBqFDg1Lq8XG mit der Demo-Folge (ohne Service Worker, Themen-Editor speichert nicht). Neu bauen mit `npm run vorschau`, dann `vorschau/lagebild.html` mit den Dateien aus `vorschau/files.json` an dieselbe Adresse veröffentlichen.
- **Befehle:** `npm run dev`, `npm run build`, `npm test`, `npm run typecheck`, `npm run update`, `npm run check-feeds`, `npm run vorschau`.

## Rollen, Formate, Gewichtung
- **Rollen:** LEITUNG fragt und leitet über (höchstens 6 Wörter, keine Tatsachen; spricht Zusammenfassung und Abschlussformel). LAGE berichtet, was passiert ist. EINORDNUNG bringt Zuschreibungen, Vorbehalte und Zusammenhang aus der Quelle und schließt meist ein Thema.
- **Faktenregel im Dialog:** Jede LAGE- und EINORDNUNG-Zeile nennt die IDs der geprüften Fakten (A1, A2 …), auf denen sie beruht, und wird nach dem Schreiben noch einmal dagegen geprüft. Fragen, Reaktionen und Überleitungen enthalten keine Tatsachen. Zusammenfassung aus den geprüften Schlagworten (`short`).
- **Formate:** Aufmacher 30–45 s (einer pro Folge, mit Vertiefungsfrage), Meldung 15–25 s, Kurz notiert 5–10 s im Block nach „Was noch?“/„Und sonst?“. „Tiefe braucht Stoff“: Hat die Quelle wenig Fakten, wird die Meldung kürzer.
- **Gewichtung pro Thema:** Aus / Nur kurz / Normal / Ausführlich. Format = Relevanz (1–5) + Gewichtung. Gesamtlänge 3, 5 oder 8 Minuten; der Plan verteilt die Zeit danach und lässt überzählige Meldungen weg.
- **Reihenfolge:** Aufmacher zuerst, dann eine Route ohne Sprünge über den Globus (wichtige Meldungen dürfen etwas weiter weg liegen), „Kurz notiert“ am Ende, dann Märkte.
- **Pausen:** Antwort auf Frage 0,3 s, Sprecherwechsel 0,5 s, gleiche Stimme im Satz 0,12 s, Themenwechsel 0,9 s, vor der Zusammenfassung 1 s.
- **Ton:** Lagezentrum (knapp, Abschluss „Das ist die Lage.“ / „Wir bleiben dran.“) oder Podcast (lockerer, Abschluss „Das war es für heute.“ / „Bis morgen!“), einstellbar im Themen-Editor.

## Entscheidungen (27.10.2026)
- **Hosting:** Repo öffentlich, GitHub Pages, Deploy per GitHub Actions. Als PWA auf dem iPad-Homescreen.
- **Claude-Modell:** Erst Opus 5.5, Sonnet 5.5 und Haiku 5.5 auf denselben Artikeln vergleichen, dann entscheide ich.
- **Uhrzeit:** Update um 8:00 Uhr fertig (Europe/Berlin).
- **Themen:** 5 Kategorien: Geopolitik & Sicherheit (USA-Politik, Nahost, Russland/Ukraine & NATO, China & Taiwan), Deutschland, Wirtschaft & Märkte (Wirtschaft, Marktanalyse), KI & Technologie (KI-Neuentwicklungen, KI & Arbeit, KI-Risiken & Regulierung, Cybersicherheit), Wissenschaft & Klima. Jede Meldung bekommt eine Relevanz 1–5. Eigene Themen kann ich im Interface hinzufügen; sie steuern die Recherche.
- **Quellen:** deutsche und internationale Medien gemischt, nur frei lesbare Artikel (der Faktencheck braucht den Volltext).

## Entscheidungen (28.10.2026)
- **Gesprächsform:** drei Stimmen und Drehbuch nach `docs/video-analyse-conflictly.md`, ohne „Sir“, ohne Militärjargon, ohne Clips.
- **Stimme:** vorerst die Gratis-Stimmen von Azure (F0): LEITUNG Conrad, LAGE Seraphina (multilingual), EINORDNUNG Florian (multilingual), Feinheiten in `config/pipeline.json`. Wenn es gut klappt, investiere ich später in eine bessere Stimme (ElevenLabs etwa 8–20 $/Monat, Azure HD etwa 2–6 $, Gemini TTS etwa 1–3 $). Offene Modelle aus VoiceStudio werden kostenlos getestet.
- **Ton:** Lagezentrum als Voreinstellung, Podcast umschaltbar.
- **Gesamtlänge:** Voreinstellung 3 Minuten.
- **Daumen hoch/runter:** nur Vorschlag, noch nicht gebaut (Knöpfe auf dem Endbildschirm, Hinweis für die Auswahl, nie Filter für Fakten).
- **Weiter offen:** Budget-Grenze für die API, sobald der Modellvergleich vorliegt. Hosting: Das Repo ist noch privat; ob öffentlich mit GitHub Pages oder privat mit anderer Lösung, entscheide ich noch.

## Nächste Schritte
1. Konten einrichten (`docs/einrichtung.md`), erster echter Lauf mit Drehbuch und Azure-Stimmen, Modellvergleich auswerten.
2. Offene Stimmen nach Gehör beurteilen; falls gut: Zahlen für den Sprechtext ausschreiben und als zweite Stimm-Engine einbauen.
3. Feinschliff nach dem ersten echten Lauf (Pausen, Lautstärke des Musikbetts, Globus-Look).

## Bekannte Probleme
- Claude- und Azure-Teil der Pipeline sind erst live getestet, wenn die Schlüssel eingetragen sind (`docs/einrichtung.md`). Bis dahin überspringt der tägliche Lauf das Update mit einer Warnung, und der Deploy überspringt sich, solange GitHub Pages aus ist.
- Times of Israel und AP sperren GitHub-Server (403), dafür Jerusalem Post. Feeds prüfen: Workflow „Tages-Update“ mit `check-feeds`, neue Adressen testen mit `probe`.
- Das Claude-SDK reicht Auswahlwerte (enum) nur als Beschreibung an das Modell weiter; Rollen, Fakten-Arten und Prüfergebnisse werden deshalb im Code normalisiert.
- Fehlt auch nur eine Zeile bei der Stimme, gibt es für den Tag keine Audiodatei; dann spricht die Systemstimme des Geräts (auch im Archiv nach 14 Tagen und in der Demo).
- GitHub-Server für private Repos haben 2 Kerne und 7 GB Speicher; große Stimm-Modelle brauchen dort Auslagerungsspeicher.

## Datenschema (`src/shared/types.ts`, Version 2)
Ein Tag ist ein `Briefing`; Kategorien bringen ihre Farben mit, damit ältere Tage im Archiv gleich aussehen.
```js
{
  schema: 2, date: '2026-10-27', generated: '2026-10-27T07:12:00+01:00',
  episode: 1, tone: 'lagezentrum',
  categories: [{ id: 'geopolitik', name: 'Geopolitik & Sicherheit', color: '#ff7a3d' }],
  stories: [Story, …],                       // in Sendereihenfolge
  markets: { asOf, source, items: [{ id, name, value, dec, unit, changePct, date }] },   // optional
  script: [Line, …],                         // die ganze Folge als Dialog
  audio: { src: 'audio/2026-10-28/folge.mp3', voice: 'audio/2026-10-28/folge-stimme.mp3', dur: 182.4 },  // optional
  meta: { model, costUsd, script: 'claude' | 'einfach' }
}
// Line
{ role: 'LEITUNG' | 'LAGE' | 'EINORDNUNG', text: 'Untertitel', say: 'optional: abweichender Sprechtext',
  story: 'israel',                           // fehlt bei Zusammenfassung und Abschluss; 'maerkte' für Märkte
  kind: 'frage' | 'fakt' | 'zusammenfassung' | 'abschluss',
  facts: ['A1', 'A2'],                       // nur Faktzeilen
  audio: { at: 12.4, dur: 3.1, words: [[0.31, 0.12], …] } }   // Beginn in der Folge, [Sekunde, Anteil] am Wortende
// Story
{
  id: 'israel', category: 'geopolitik', topic: 'Nahost-Konflikt',
  relevance: 4,                              // 1–5, Einschätzung, kein Fakt
  format: 'aufmacher' | 'meldung' | 'kurz',
  country: 'ISR', label: 'ISRAEL', flag: '🇮🇱', lon: 35.21, lat: 31.77, zoom: 10,
  places: [{ label: 'Nordkorea', lon: 127.5, lat: 40.3, route: false }],   // optional, Pin beim Wort
  headline: '[Israel] wählt mit [Rekord]beteiligung',   // eine Zeile auf der Karte, [..] = Akzentfarbe
  brief: 'Kurz gesagt, 2–3 Sätze',
  figure: { value: 55.7, dec: 1, prefix: '', suffix: ' %', label: 'Wahlbeteiligung um 16 Uhr' },  // optional, erscheint beim Wort
  source: { name: 'Times of Israel', url: 'https://…', date: '2026-10-27' },
  short: 'Rekordbeteiligung in Israel',      // Schlagwort für die Zusammenfassung
  facts: [{ id: 'A1', text: 'Geprüfter Einzelfakt.' }, …]
}
```
