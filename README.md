# Lagebild

Tägliches News-Update als TikTok-Ersatz: animierter Globus, Sprecherstimme mit Untertiteln, eigene Themen. Läuft als Web-App (PWA) auf dem iPad, jeden Morgen um 8:00 Uhr mit neuen Meldungen.

## So funktioniert es
1. **Recherche** (GitHub Actions, jeden Morgen): RSS-Feeds je Thema und eine Stichwortsuche über GDELT, nur seriöse Quellen.
2. **Auswahl:** Claude wählt 5–7 Meldungen nach deinen Themen und Prioritäten und vergibt eine Relevanz von 1–5.
3. **Schreiben:** Pro Meldung wird der Volltext einer frei lesbaren Quelle geladen. Claude schreibt die Meldung ausschließlich aus diesem Text.
4. **Faktencheck:** Ein zweiter Durchgang prüft jede Aussage gegen den Text; Unbelegtes wird korrigiert oder gestrichen.
5. **Stimme:** Azure Speech spricht jede Zeile (zwei Stimmen), mit Wort-Zeitmarken für die Untertitel.
6. **Veröffentlichen:** Die Daten landen im Branch `daten`, die App wird auf GitHub Pages neu gebaut.

## Ordner
- `src/` – die App (Vite + TypeScript)
- `pipeline/` – das tägliche Update (Node 22, TypeScript ohne Build-Schritt)
- `config/themen.json` – Themen, Prioritäten, Suchbegriffe (in der App bearbeitbar)
- `config/quellen.json` – RSS-Feeds und vertrauenswürdige Domains
- `config/pipeline.json` – Claude-Modell, Stimmen, Länge
- `public/demo/` – Demo-Update mit den Prototyp-Meldungen vom 27.10.2026
- `tests/` – Unit-Tests (Vitest)
- `docs/einrichtung.md` – Konten und Schlüssel einrichten (am iPad)
- `docs/prototyp.html`, `docs/stilanalyse.md` – Prototyp und Stilanalyse der Vorbilder
- `CLAUDE.md` – Stand, Entscheidungen, Regeln und Datenschema

## Entwicklung
`npm install`, dann `npm run dev`. Prüfen: `npm run typecheck && npm test && npm run build`.
Pipeline lokal: `ANTHROPIC_API_KEY=… npm run update -- --out daten` (ohne Azure-Schlüssel ohne Stimme), nur Quellen prüfen: `npm run check-feeds`.
