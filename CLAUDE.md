# Lagebild – tägliches News-Update als TikTok-Ersatz

## Ziel
Ich will TikTok deinstallieren und trotzdem jeden Tag auf dem neuesten Stand bleiben. Lagebild ist mein persönliches tägliches News-Update mit animiertem Globus, Sprecherstimme, Untertiteln und frei wählbaren Themen. Es läuft vor allem auf meinem iPad. Vorbild für den Stil sind zwei TikTok-Accounts (Conflictly und Netwatch Global), siehe `docs/stilanalyse.md`.

## Arbeitsweise
- Mit mir auf Deutsch kommunizieren, knapp und direkt. Fehler offen benennen.
- Meldungen dürfen nur Fakten aus der verlinkten Quelle enthalten. Nichts dazuerfinden und keine eigene Interpretation als Fakt ausgeben. Jede Meldung braucht Quelle, URL und Datum.
- Nur den Stil der Vorbilder übernehmen, nicht ihre Inhalte und nicht ihr Militär-Drama. Keine Videoclips aus unklarer Quelle.

## Stand (27.10.2026)
Der Prototyp ist in einem Claude-Chat entstanden: `index.html`. Es ist eine einzelne Datei ohne Build-Schritt, die man direkt im Browser öffnen kann.
- **Globus:** D3 v7 von cdnjs, orthografische Projektion auf einem Canvas. Die Weltkarte kommt aus `datamaps@0.5.9` (`Datamap.prototype.worldTopo`), weil die Artifact-Umgebung Daten nur per Script-Tag laden durfte. Dafür gibt es einen eigenen kleinen TopoJSON-Decoder (`topoFeatures`).
- **Ablauf pro Meldung:** BRIEFING-Satz während der Kamerafahrt → Land wird hervorgehoben → Pin mit Linie zur Karte → Karte baut sich auf → Zeilen mit den Rollen LAGE und EINORDNUNG. Dazu Intro mit Glitch, Datum und Begrüßung sowie ein Outro mit Zusammenfassung und Endbildschirm samt Quellenliste.
- **Stimme:** Web Speech API (`speechSynthesis`), also die Systemstimme des Geräts. Untertitel mit Schreibmaschinen-Effekt. Ohne Stimme läuft ein Timer-Modus.
- **Ton:** WebAudio, ein leiser Bass-Teppich und ein Blip, wenn die Karte erscheint.
- **Einstellungen** (in localStorage): Themen (8 Ressorts), Stimme, Tempo, Atmo-Sound.
- **Inhalte:** Fünf Meldungen vom 27.10.2026 sind fest im Objekt `DATA` eingebaut.

## Bekannte Probleme
- Die Weltkarte von datamaps über das CDN wurde **nie live getestet**, nur mit einer synthetischen Testgeometrie. Das zuerst im Browser prüfen.
- Die Systemstimme klingt je nach Gerät blechern.
- Die Meldungen sind statisch und aktualisieren sich nicht.

## Nächste Schritte (Vorschlag, noch nicht entschieden)
1. Ein echtes Projekt aufsetzen (z. B. Vite und TypeScript), den Prototyp übernehmen und die Weltkarte lokal aus `world-atlas` (countries-110m) laden statt aus datamaps.
2. Datenpipeline als täglicher Job (GitHub Actions cron oder Vercel Cron): Meldungen aus RSS-Feeds oder News-APIs nach meinen Themen holen, per Claude API im Schema unten zusammenfassen und als `data/YYYY-MM-DD.json` speichern.
3. Stimme: Im Job pro Zeile Audio per TTS-API erzeugen (ElevenLabs oder OpenAI) und als MP3 ablegen. Das Untertitel-Timing ergibt sich aus der Audiolänge. Für BRIEFING eine zweite Stimme verwenden.
4. Hosting als PWA (z. B. Vercel), damit es als Icon auf meinem iPad-Homescreen liegt.
5. Die Themen-Einstellungen sollen schon die Recherche steuern, nicht nur nachträglich filtern.

## Offene Entscheidungen (mich fragen)
- Uhrzeit des täglichen Updates und finale Themenliste
- Sprachdienst und Budget dafür (API-Kosten)
- Hosting und welche News-Quellen und Feeds

## Datenschema einer Meldung (wie in `DATA.stories`)
```js
{
  id: 'israel',
  ressort: 'welt',              // Schlüssel aus RESSORTS
  country: 'ISR',               // ISO-3-Code für die Hervorhebung des Landes
  label: 'ISRAEL', flag: '🇮🇱',
  lon: 35.21, lat: 31.77, zoom: 10,
  headline: '[Israel] wählt mit [Rekord]beteiligung',   // [..] = Akzentfarbe
  brief: 'Kurz gesagt-Absatz, 2–4 Sätze',
  figure: { value: 55.7, dec: 1, prefix: '', suffix: ' %', label: 'Wahlbeteiligung um 16 Uhr' },
  source: { name: 'Times of Israel', url: 'https://…' },
  short: 'Rekordbeteiligung in Israel',                 // für die Zusammenfassung im Outro
  open: { first: '…', mid: '…', last: '…' },            // BRIEFING-Überleitung je nach Position
  lines: [['LAGE', 'Untertitel', 'optional: abweichender Sprechtext'], ['EINORDNUNG', '…']]
}
```
