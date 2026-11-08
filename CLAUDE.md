# Lagebild – tägliches News-Update als TikTok-Ersatz

## Ziel
Ein persönliches tägliches News-Update als Ersatz für Nachrichtenclips auf TikTok: animierter Globus, Sprecherstimmen, Untertitel und frei wählbare Themen. Läuft vor allem auf dem iPad. Vorbild für den Stil sind zwei TikTok-Accounts (Conflictly und Netwatch Global), siehe `docs/stilanalyse.md`.

## Arbeitsweise
- Auf Deutsch kommunizieren, knapp und direkt. Fehler offen benennen.
- Meldungen dürfen nur Fakten aus der verlinkten Quelle enthalten. Nichts dazuerfinden und keine eigene Interpretation als Fakt ausgeben. Jede Meldung braucht Quelle, URL und Datum.
- Nur den Stil der Vorbilder übernehmen, nicht ihre Inhalte und nicht ihr Militär-Drama. Keine Videoclips aus unklarer Quelle.

## Stand
Aus dem Prototyp (`docs/prototyp.html`, eine Datei aus dem Claude-Chat) ist eine richtige App geworden. Seit Runde 2 (28.10.2026) läuft jede Folge als Gespräch dreier Stimmen nach dem Vorbild Conflictly, siehe `docs/video-analyse-conflictly.md` (Abschnitte 4, 5, 9, 10) und `docs/drehbuch-beispiel.md`.
- **App:** Vite + TypeScript ohne Framework, Module in `src/`: `player.ts` (Ablauf nach Audio-Zeit), `audio.ts` (Audiodatei der Folge, Systemstimme als Rückfall, Bass-Teppich ohne Datei), `globe.ts` (Kamerafahrt, Hervorhebung, Pins, weitere Orte, Linien), `earth.ts` (Satellitenbild per WebGL), `card.ts` (Karte, Details, Kursverlauf), `viz.ts` (Einblendungen), `icons.ts` (Symbole), `fx.ts` (Untertitel-Blöcke, Hochzählen), `topics.ts` (Themen-Editor), `github.ts`, `main.ts`. Gemeinsame Regeln für App und Pipeline in `src/shared/script.ts` (Pausen, Untertitel-Blöcke, Bild-Beats, Abschlussformeln) und `src/shared/symbols.ts`.
- **Ablauf einer Folge:** Im Ton „Assistent“ (Voreinstellung) begrüßt LEITUNG zuerst mit Wochentag, Datum und auf Wunsch Namen und nennt die drei wichtigsten Schlagworte; der Globus zeigt dabei die Übersicht. In den anderen Tönen kein Grußtext. Datum und „Folge N“ zusätzlich als Grafik. Erster Satz nach der Begrüßung = Kernaussage des Aufmachers. Die Kamera fliegt während der Frage von LEITUNG, die Karte erscheint mit der Antwort, Zahl und weitere Orte erscheinen beim Wort (Wortzeitmarken). Untertitel als Blöcke mit 6–10 Wörtern. Einblendungen erscheinen beim Wort, eine zugleich: Vergleich als Balken, Termin als Uhr oder Kalenderblatt, Archivbild mit Urheber und Lizenz; eine Meldung ohne solche Einblendung zeigt kurz ihr Symbol. Hochkant oben über dem Globus, quer in der rechten Spalte. Karte im Ablauf nur Flagge, Ort, eine Zeile; „Kurz gesagt“, Zahl und Quelle per Tippen auf die Karte und auf dem Endbildschirm. Am Ende Zusammenfassung mit drei Schlagworten und feste Abschlussformel.
- **Globus:** NASA Blue Marble (Dez. 2004), Black Marble 2016 (Stadtlichter) und Wolken in `public/earth/`, gemeinfrei, geladen mit dem Workflow „Texturen“. Darüber dünne Grenzen aus `world-atlas` (110m, 50m bei engem Ausschnitt). Ohne WebGL der alte Vektor-Globus.
- **PWA:** Manifest, Icon, Service Worker; offline nutzbar. Mit Audiodatei läuft die Folge bei gesperrtem iPad weiter (Sperrbildschirm-Steuerung über Media Session).
- **Themen:** `config/themen.json` (Version 2), bearbeitbar in der App. Gespeichert wird per GitHub-API mit einem Fine-grained Token, der nur auf dem iPad liegt.
- **Pipeline:** `pipeline/run.ts`, gestartet von `.github/workflows/update.yml` (ab 5:45 Uhr Berlin, eine 8-Minuten-Folge mit VoxCPM2 ab 4:45; Wiederholungen bis 8:45). Schritte: `sources.ts` (RSS + GDELT) → `editorial.ts` (Auswahl, Einzelfakten, Faktencheck je Fakt, Hintergrund für große Meldungen) → `plan.ts` (Format, Zeit, Route, ohne KI) → `bilder.ts` (Archivbilder, nur für eingeplante Meldungen) → `drehbuch.ts` (Dialog mit Claude, danach Prüfung jeder Zeile; einfache Fassung aus den Fakten als Rückfall) → `assemble.ts` (Märkte, Zusammenfassung, Abschlussformel, Prüfung der Erklär-Grafiken) → Stimme: `tts-voxcpm.ts` + `stimme_voxcpm.py` (VoxCPM2, Voreinstellung) oder `tts.ts` (Azure) → `mix.ts` (Pausen, Lautheit, Musikbett, MP3 mit und ohne Musik) → `store.ts`. Einstellungen in `config/pipeline.json`, dort auch das Modell je Schritt (`steps`: auswahl, fakten, hintergrund, faktencheck, drehbuch; nicht genannte nehmen `model`). `--model` oder `LAGEBILD_MODEL` setzt ein Modell für alle Schritte.
- **Hintergrund und Fokus (seit 6.11.2026, Schema 3):** Die Auswahl markiert Enthüllungen (`investigative`: eigene Recherche eines Mediums) und nennt für Meldungen ab Relevanz 4 bis zu zwei weitere Artikel mit Hintergrund. Für die zwei wichtigsten Meldungen ab Relevanz 4 (nach Plan-Wertung; Anzahl in `config/pipeline.json`, `background.maxStories`) lädt die Pipeline eine zweite Quelle zum selben Ereignis (Volltext, andere Domain bevorzugt; gibt es keine verwertbare, noch einmal die Hauptquelle) und zieht daraus 2–8 Hintergrund-Fakten (Vorgeschichte, Beteiligte, Gründe) sowie Zeitleiste, Akteure und Ursache-Wirkung-Kette. Der Faktencheck prüft die Hintergrund-Fakten gegen den zweiten Text und die Grafiken gegen ihre Fakten (nach Korrekturen eine zweite Runde ohne Korrekturen); der Code nimmt Grafiken nur, wenn Zeitangaben und Namen wörtlich in ihren Fakten stehen. In die Folge kommt der Hintergrund nur bei Aufmacher und Fokus mit Relevanz ab 4; LEITUNG fragt dann „Wie kam es dazu?“, „Wer steckt dahinter?“. Ob ein Text wirklich auf eigener Recherche beruht, prüft der Faktencheck mit (`enthuellung`); bei einer Enthüllung nennt der erste Satz, wer recherchiert hat.
- **Look:** „persönlicher Assistent“, clean und warm: abgerundete Glasflächen, eine Schrift (SF Pro auf Apple-Geräten, sonst Inter), normale Groß- und Kleinschreibung, warme Akzentfarbe (Korall), Rollen als kleine Namensschilder („Lagebild“, „Lage“, „Einordnung“), Startbildschirm als Karte mit Symbol je Meldung, Einstellungen als gruppierte Listen. Keine Sci-Fi-Versalien, kein Glitch, kein Entschlüsseln.
- **Querformat:** Ab 900 px Breite (iPad quer) steht der Globus links, Untertitel, Karte und Steuerung rechts.
- **Recherche:** 59 RSS-Feeds (`config/quellen.json`). Suchbegriffe aller Themen wirken auch auf alle Feed-Artikel. GDELT nur für Themen mit zu wenig Treffern.
- **Marktdaten:** `pipeline/markets.ts` holt Kurse (Yahoo Finance, ein Monat für den Kursverlauf) und baut die gesprochenen Sätze ohne KI aus den Zahlen; eigener Block vor der Zusammenfassung.
- **Erklär-Grafiken (statt Videoclips):** Vorgeschichte als Zeitleiste (Linie füllt sich bis zum erzählten Jahr, „Heute“ als Quadrat), „Wer steht wo“ (Beteiligte mit Rolle und Position, keine Einordnung in Lager; wer gerade genannt wird, ist hervorgehoben) und Ursache und Wirkung (Kette mit Pfeilen, die sich Schritt für Schritt einzeichnet). Zeitleiste und Akteure erscheinen bei Zeitangabe bzw. Namen im Dialog, sonst bei einer Zeile mit ihrem Fakt; weitere Einträge schalten die stehende Grafik nur weiter. Die Kette erscheint mit der Ursache. Jede Einblendung steht mindestens 2,2 s, bevor die nächste sie ersetzt. Hochkant dürfen Erklär-Grafiken 60 % der Bühne nutzen; reicht das nicht, werden sie kompakt (Nebentexte nur beim aktuellen Eintrag) und rollen zum aktuellen Eintrag (`viz.ts`, `fit`). In den Details der Karte stehen Hintergrund (mit Quelle), Vorgeschichte, Akteure, Kette und alle Quellen als Text.
- **Einblendungen:** Claude liefert beim Faktenziehen Vergleichswerte, Termin, Symbol und bis zu zwei Bildmotive. Vergleich und Termin bewertet der Faktencheck mit; zusätzlich nimmt der Code sie nur, wenn jeder Wert (und seine Beschriftung) wörtlich in einem geprüften Fakt steht. Archivbilder: Wikidata-Eintrag, dessen deutscher oder englischer Hauptname genau dem Motiv entspricht (keine Aliase), Bild aus P18, nur freie Lizenzen (CC0, CC BY, CC BY-SA, gemeinfrei) mit Urheber; gespeichert in `bilder/<Datum>/` im Branch `daten`, nach 14 Tagen gelöscht. Beschriftung immer „Archivbild“. Demo-Bilder holt der Workflow „Archivbilder (Demo)“ (Motive in `scripts/demo-motive.json`).
- **Daten:** Branch `daten` mit `JJJJ-MM-TT.json`, `index.json`, `audio/` und `bilder/` (je 14 Tage) und `logs/` (Kosten, verworfene Meldungen, Prüfprotokoll von Faktencheck und Drehbuch). Der Branch wird bei jedem Lauf als einzelner Commit neu geschrieben. Ohne Daten zeigt die App die Demo-Folge `public/demo/2026-10-27.json`; vertonte Demo-Audios gehören nach `public/demo/audio/` mit Prüfsumme im Dateinamen, weil der Offline-Cache Audiodateien nie neu lädt.
- **Stimme VoxCPM2:** offenes Modell (Apache-2.0) auf der CPU des GitHub-Servers, drei Referenzstimmen „ruhig“ in `config/stimmen/voxcpm2/`, geklont für jede Zeile. Sprechtext aus `src/shared/sprechtext.ts` (Zahlen, Datum, Uhrzeit, Jahre, Abkürzungen ausgeschrieben). Whisper prüft jede Zeile; bei Abweichung bis zu drei Versuche. Fehlt eine Verneinung oder kommt ein zusätzlicher Satzteil dazu, gibt es für den Tag keine Audiodatei (Systemstimme). Wortzeiten für die Untertitel aus Whisper. Umgebung: `.github/actions/stimme`; Messlauf: Workflow „Demo vertonen“ (`run.ts --vertonen`). Wahl VoxCPM2/Azure im Themen-Editor (`episode.voice`). Zwei Modi (`voxcpm2.mode`): „fortsetzung“ (Voreinstellung, seit 6.11. wieder: setzt die Stimmprobe fort, Klang am genauesten, Ausdruck so ruhig wie die Probe) und „steuerbar“ (nur Klangfarbe geklont, Ausdruck je Zeile aus `mood`; am 29.10. gehört, Faktor 15 statt 17, Ergebnis im Branch `folge-2026-10-29-steuerbar`). Die Demo-Folge ist mit „fortsetzung“ vertont (6.11.); neu vertonen mit dem Workflow „Demo vertonen“.
- **Offene Stimmen im Test:** Workflow „Stimmtest“ vertont den Dialog aus 10.4 mit Modellen aus VoiceStudio auf der CPU: VoxCPM2 (Apache-2.0, Stimmen aus Beschreibung, auch ruhigere Variante), Supertonic-3 (OpenRAIL-M, fertige Sprecher, schnell), OmniVoice (Gewichte nur nichtkommerziell, CC-BY-NC). Ergebnis in den Branches `stimmtest-<modell>`; Workflow „Stimmprüfung“ lässt Whisper mitschreiben und vergleicht mit dem Sprechtext.
- **Vorschau ohne Konten:** private claude.ai-Seite https://claude.ai/artifact/1f8cZC4BGbMBqFDg1Lq8XG mit der Demo-Folge (ohne Service Worker, Themen-Editor speichert nicht). Neu bauen mit `npm run vorschau`, dann `vorschau/lagebild.html` mit den Dateien aus `vorschau/files.json` an dieselbe Adresse veröffentlichen.
- **Befehle:** `npm run dev`, `npm run build`, `npm test`, `npm run typecheck`, `npm run update`, `npm run check-feeds`, `npm run vorschau`.

## Rollen, Formate, Gewichtung
- **Rollen:** LEITUNG fragt und leitet über (höchstens 6 Wörter, keine Tatsachen; spricht Zusammenfassung und Abschlussformel). LAGE berichtet, was passiert ist. EINORDNUNG bringt Zuschreibungen, Vorbehalte und Zusammenhang aus der Quelle und schließt meist ein Thema.
- **Faktenregel im Dialog:** Jede LAGE- und EINORDNUNG-Zeile nennt die IDs der geprüften Fakten (A1, A2 …), auf denen sie beruht, und wird nach dem Schreiben noch einmal dagegen geprüft. Fragen, Reaktionen und Überleitungen enthalten keine Tatsachen. Zusammenfassung aus den geprüften Schlagworten (`short`).
- **Briefing statt Schlagzeile:** Jede Meldung wie ein Lagebriefing für eine Regierungschefin, so knapp wie möglich: Kern → Problem (worum es eigentlich geht) → Positionen und Größenordnung → Ausblick (nächster Schritt) → offener Punkt. Fakten-Arten dafür: kern, problem, ausblick, zahl, vorbehalt u. a.; LEITUNG fragt gezielt („Wo liegt das Problem?“, „Wie geht's weiter?“). Höchstens zwei Zahlen pro Meldung im Ton.
- **Formate:** Aufmacher 30–45 s (einer pro Folge, mit Vertiefungsfrage), Im Fokus 60–90 s (höchstens einer pro Folge), Meldung 15–25 s, Kurz notiert 5–10 s im Block nach „Was noch?“/„Und sonst?“. „Tiefe braucht Stoff“: Hat die Quelle wenig Fakten, wird die Meldung kürzer.
- **Im Fokus:** für große Enthüllungen (Enthüllung mit Relevanz ab 4) und Meldungen mit Relevanz 5, wenn mindestens 9 geprüfte Fakten da sind (mit Hintergrund) und das Thema nicht auf „Kurz“ steht. Ist die Fokus-Meldung die wichtigste, ist sie selbst der Aufmacher; sonst läuft sie direkt nach dem Aufmacher, wenn danach noch 20 s für anderes bleiben. 75 s bei „Normal“, 90 s bei „Mehr“. Leiter: Kern → was herausgekommen ist → Hintergrund → Reaktionen → Ausblick → offener Punkt, mindestens drei Fragen, bis zu drei Zahlen. Enthüllungen gehen bei gleicher Relevanz leicht vor (+0,3 in der Plan-Wertung).
- **Hintergrund im Dialog:** Fakten der Art „hintergrund“ bekommen bei Aufmacher und Fokus einen eigenen Teil nach dem Kern; LEITUNG fragt („Wie kam es dazu?“, „Wer steckt dahinter?“, „Was war vorher?“), EINORDNUNG oder LAGE antworten nur mit diesen Fakten, ältere zuerst. Stammt ein Fakt aus der zweiten Quelle, darf der Dialog sie nennen („laut Deutschlandfunk“); die Drehbuch-Prüfung erlaubt das.
- **Gewichtung pro Thema:** Aus / Kurz / Normal / Mehr (intern aus, kurz, normal, ausfuehrlich). Format = Relevanz (1–5) + Gewichtung. Gesamtlänge 3, 5 oder 8 Minuten; der Plan verteilt die Zeit danach und lässt überzählige Meldungen weg.
- **Reihenfolge:** Aufmacher zuerst, dann eine Route ohne Sprünge über den Globus (wichtige Meldungen dürfen etwas weiter weg liegen), „Kurz notiert“ am Ende, dann Märkte.
- **Pausen:** Antwort auf Frage 0,3 s, Sprecherwechsel 0,5 s, gleiche Stimme im Satz 0,12 s, Themenwechsel 0,9 s, vor der Zusammenfassung 1 s.
- **Ton:** Assistent (Voreinstellung: LEITUNG ist „Lagebild“, ein persönlicher Assistent wie Jarvis ohne „Sir“, duzt, spricht in Ich-Form, warm und ruhig; Begrüßung und Vorschau statt Zusammenfassung; Abschluss „Das war's für heute[, Name]. Ich halt dich auf dem Laufenden.“ / „Bis morgen!“), Lagezentrum (knapp, Abschluss „Das ist die Lage.“ / „Wir bleiben dran.“) oder Podcast (lockerer, Abschluss „Das war es für heute.“ / „Bis morgen!“). Einstellbar im Themen-Editor, dort auch die Anrede (`episode.name`). Persönlich heißt Anrede und Ton, nicht Inhalt: keine Wertungen der Nachrichten, keine Vermutungen über den Zuhörer, bei ernsten Themen kein Augenzwinkern.
- **Gefühl:** Das Gespräch soll lebendig klingen. LEITUNG reagiert (Staunen „Oha.“, „Moment – so viele?“, Neugier „Und warum?“, Anteilnahme „Oh je.“), LAGE und EINORDNUNG gehen auf Fragen ein („Ja, wirklich:“). Keine Parteinahme, bei Toten, Krieg, Katastrophen nur Anteilnahme. Jede Zeile hat eine Stimmung (`mood`: neutral, neugierig, ueberrascht, warm, ernst, nachdenklich, heiter); im Stimm-Modus „steuerbar“ wird daraus eine Anweisung an VoxCPM2 (`config/pipeline.json`, `voxcpm2.moods`).

## Entscheidungen (27.10.2026)
- **Hosting:** Repo öffentlich, GitHub Pages, Deploy per GitHub Actions. Als PWA auf dem iPad-Homescreen.
- **Claude-Modell:** Erst Opus 5.5, Sonnet 5.5 und Haiku 5.5 auf denselben Artikeln vergleichen, dann fällt die Entscheidung. (Am 28.10. ohne Vergleich entschieden: Haiku 5.5, siehe unten.)
- **Uhrzeit:** Update um 8:00 Uhr fertig (Europe/Berlin).
- **Themen:** 5 Kategorien: Geopolitik & Sicherheit (USA-Politik, Nahost, Russland/Ukraine & NATO, China & Taiwan), Deutschland, Wirtschaft & Märkte (Wirtschaft, Marktanalyse), KI & Technologie (KI-Neuentwicklungen, KI & Arbeit, KI-Risiken & Regulierung, Cybersicherheit), Wissenschaft & Klima. Jede Meldung bekommt eine Relevanz 1–5. Eigene Themen lassen sich im Interface hinzufügen; sie steuern die Recherche.
- **Quellen:** deutsche und internationale Medien gemischt, nur frei lesbare Artikel (der Faktencheck braucht den Volltext).

## Entscheidungen (28.10.2026)
- **Gesprächsform:** drei Stimmen und Drehbuch nach `docs/video-analyse-conflictly.md`, ohne „Sir“, ohne Militärjargon, ohne Clips.
- **Stimme:** vorerst die Gratis-Stimmen von Azure (F0): LEITUNG Conrad, LAGE Seraphina (multilingual), EINORDNUNG Florian (multilingual), Feinheiten in `config/pipeline.json`. Später eventuell eine bessere bezahlte Stimme (ElevenLabs etwa 8–20 $/Monat, Azure HD etwa 2–6 $, Gemini TTS etwa 1–3 $). Offene Modelle aus VoiceStudio werden kostenlos getestet.
- **Ton:** Lagezentrum als Voreinstellung, Podcast umschaltbar. (Später am 28.10. geändert: Ton „Assistent“ mit Begrüßung als Voreinstellung, siehe oben.)
- **Gesamtlänge:** Voreinstellung 3 Minuten.
- **Daumen hoch/runter:** nur Vorschlag, noch nicht gebaut (Knöpfe auf dem Endbildschirm, Hinweis für die Auswahl, nie Filter für Fakten).
- **Einblendungen:** Grafiken aus geprüften Fakten (Vergleich, Termin, Kursverlauf, Symbol) und Archivbilder aus Wikimedia Commons (a + b). Keine Aufnahmen vom Ereignis selbst (Rechte bei Agenturen und Verlagen).
- **Stimme (Nachtrag):** Nach dem Hörvergleich ist VoxCPM2 „ruhig“ die Stimme (vorher Azure, dann OmniVoice erwogen). Azure bleibt im Themen-Editor wählbar.
- **Hosting (Nachtrag):** Repo seit 28.10. öffentlich (kostenlose Server mit 4 Kernen und 16 GB für die Stimme), GitHub Pages mit Source „GitHub Actions“ eingeschaltet. Persönliche Formulierungen in der Doku sind neutral gehalten; eine Anrede im Themen-Editor wäre öffentlich sichtbar.
- **Claude-Modell (Nachtrag):** Haiku 5.5 mit Effort „high“ für alle Schritte (`config/pipeline.json`). Geschätzt etwa 5–10 Cent pro Tag statt etwa 2 $ mit Opus 5.5. Kein serverseitiger Fallback bei Ablehnungen: Die Meldung fällt dann weg. Wird der Faktencheck zu lasch, als Erstes nur Faktenziehen und Faktencheck auf Sonnet 5.5 oder Opus 5.5 stellen. (Am 6.11. geändert: Auswahl und Faktencheck auf Sonnet 5.5, siehe unten.)
- **Weiter offen:** Budget-Grenze in der Anthropic-Console.

## Entscheidungen (06.11.2026)
- **Qualität vor Cent-Beträgen:** Auswahl (Effort „medium“) und Faktencheck (Effort „high“) laufen auf Sonnet 5.5, Faktenziehen, Hintergrund-Fakten und Drehbuch samt Drehbuch-Prüfung bleiben bei Haiku 5.5 („high“), `config/pipeline.json` → `steps`. Kosten geschätzt 30–60 Cent pro Tag bei der 3-Minuten-Folge (Preise: Sonnet 2 $/10 $, Haiku 0,10 $/0,50 $ je 1 Mio. Token Eingabe/Ausgabe; gut 80 % davon entfallen auf Sonnet, vor allem den Faktencheck mit Denkschritten), bei 8 Minuten eher 70 Cent bis 1 $. Der erste echte Lauf zeigt die echten Zahlen: `logs/JJJJ-MM-TT.json` → `usage.byModel`. Wird es zu teuer: zuerst Auswahl auf Haiku zurück; nächster Qualitätsschritt wäre Faktenziehen auf Sonnet (etwa +20–30 Cent).
- **Hintergrund:** höchstens zwei Meldungen pro Tag (Kosten), zweite Quelle aus den Feeds und vertrauenswürdigen Domains von `config/quellen.json` (wie alle Kandidaten). Ohne zweite Quelle ein zweiter Durchgang über die Hauptquelle, nur für noch nicht gezogenen Hintergrund. Hintergrund-Fakten tragen die Quelle (`source: 1`), damit Zuschreibung und Details stimmen.
- **Erklär-Grafiken statt Clips:** Zeitleiste, Akteure, Kette nur aus geprüften Fakten; keine Aufnahmen vom Ereignis, keine Clips. Zeitangaben der Zeitleiste sind Text wie im Fakt („März 2024“), kein ISO-Datum, weil Quellen oft nur Monat oder Jahr nennen; die Reihenfolge der Liste ist die zeitliche (der Code prüft, dass Jahreszahlen nicht rückwärts laufen). Akteure ohne Lager oder Wertung.
- **Fokus:** einer pro Folge, nur mit genug Stoff (9 Fakten); keine eigene Kategorie, sondern ein Format.
- **Schema 3:** nur zusätzliche Felder; die App spielt Schema 2 und 3 (`isPlayable` in `src/shared/types.ts`). Cortex (eigenes Projekt) liest dieselben Felder.

## Nächste Schritte
1. Claude-Schlüssel als Secret eintragen (`docs/einrichtung.md`, Schritte 2 und 4), erster echter Lauf mit Sonnet (Auswahl, Faktencheck), Haiku (Rest), Drehbuch und VoxCPM2 („steuerbar“); Prüfprotokoll in `logs/` auf verworfene oder korrigierte Fakten ansehen, besonders die Einträge „Hintergrund:“, und die Kosten je Modell (`usage.byModel`).
2. Rechenzeit der Stimme im echten Tageslauf beobachten. Richtwert aus dem Messlauf „Demo vertonen“: 97 s Sprache in 33 Minuten (Faktor 20). Wird es knapp: Vertonung auf mehrere parallele Jobs verteilen (öffentliche Server kostenlos, etwa Faktor 3–4 schneller).
3. Feinschliff nach dem ersten echten Lauf (Pausen, Lautstärke des Musikbetts, Globus-Look).
4. Nach den ersten Läufen mit Hintergrund ansehen: Wie oft findet sich eine zweite Quelle, wie oft bestehen Zeitleiste, Akteure und Kette die Prüfung, und erscheinen sie im Dialog an der richtigen Stelle? Die Demo zeigt sie mit vorhandenen Fakten (Israel: Zeitleiste und Akteure, Kundl: Kette); der Hintergrund-Teil mit „Wie kam es dazu?“ ist dort noch nicht im Dialog, weil die Demo-Fakten keine Vorgeschichte hergeben.

## Bekannte Probleme
- Claude- und Azure-Teil der Pipeline sind erst live getestet, wenn die Schlüssel eingetragen sind (`docs/einrichtung.md`). Bis dahin überspringt der tägliche Lauf das Update mit einer Warnung, und der Deploy überspringt sich, solange GitHub Pages aus ist.
- Times of Israel und AP sperren GitHub-Server (403), dafür Jerusalem Post. Feeds prüfen: Workflow „Tages-Update“ mit `check-feeds`, neue Adressen testen mit `probe`.
- Das Claude-SDK reicht Auswahlwerte (enum) nur als Beschreibung an das Modell weiter; Rollen, Fakten-Arten und Prüfergebnisse werden deshalb im Code normalisiert.
- Hintergrund, Fokus und die Erklär-Grafiken sind nur mit Tests und der Demo geprüft, noch nicht mit einem echten Lauf (Schlüssel fehlt). Die Kosten für Sonnet sind geschätzt.
- Fehlt auch nur eine Zeile bei der Stimme, gibt es für den Tag keine Audiodatei; dann spricht die Systemstimme des Geräts (auch im Archiv nach 14 Tagen).
- VoxCPM2 rechnet auf der CPU etwa 20 Sekunden pro Sekunde Sprache (öffentlicher Server, float32; mit bfloat16 war es Faktor 48, weil die Server-CPU es nicht direkt kann): 3-Minuten-Folge knapp eine Stunde, 8 Minuten gut zwei Stunden. Nach 190 Minuten bricht die Stimme ab, die Folge kommt dann ohne Audiodatei. Speicher in float32 mit Whisper etwa 10 GB; auf privaten GitHub-Servern (7 GB) lagert es aus und die Rechenzeit schwankt stark.
- GitHub-Server für private Repos haben 2 Kerne und 7 GB Speicher; große Stimm-Modelle brauchen dort Auslagerungsspeicher.

## Datenschema (`src/shared/types.ts`, Version 3)
Ein Tag ist ein `Briefing`; Kategorien bringen ihre Farben mit, damit ältere Tage im Archiv gleich aussehen.
Version 3 (seit 6.11.2026) ergänzt Version 2 nur um Felder (unten mit „ab 3“ markiert); Tage mit Version 2 laufen unverändert weiter (`SUPPORTED_SCHEMAS`, `isPlayable`). Cortex liest dieselben Felder.
```js
{
  schema: 3, date: '2026-10-27', generated: '2026-10-27T07:12:00+01:00',
  episode: 1, tone: 'assistent',             // 'assistent' | 'lagezentrum' | 'podcast'
  categories: [{ id: 'geopolitik', name: 'Geopolitik & Sicherheit', color: '#ff7a3d' }],
  stories: [Story, …],                       // in Sendereihenfolge
  markets: { asOf, source, items: [{ id, name, value, dec, unit, changePct, date }] },   // optional
  script: [Line, …],                         // die ganze Folge als Dialog
  audio: { src: 'audio/2026-10-28/folge.mp3', voice: 'audio/2026-10-28/folge-stimme.mp3', dur: 182.4 },  // optional
  meta: { model, models: { auswahl, fakten, hintergrund, faktencheck, drehbuch }, costUsd, script: 'claude' | 'einfach' }   // models ab 3
}
// Line
{ role: 'LEITUNG' | 'LAGE' | 'EINORDNUNG', text: 'Untertitel', say: 'optional: abweichender Sprechtext',
  story: 'israel',                           // fehlt bei Zusammenfassung und Abschluss; 'maerkte' für Märkte
  kind: 'begruessung' | 'frage' | 'fakt' | 'zusammenfassung' | 'abschluss',   // Begrüßung ohne story
  facts: ['A1', 'A2'],                       // nur Faktzeilen
  mood: 'ueberrascht',                       // optional, Stimmung beim Sprechen (fehlt = neutral)
  audio: { at: 12.4, dur: 3.1, words: [[0.31, 0.12], …] } }   // Beginn in der Folge, [Sekunde, Anteil] am Wortende
// Story
{
  id: 'israel', category: 'geopolitik', topic: 'Nahost-Konflikt',
  relevance: 4,                              // 1–5, Einschätzung, kein Fakt
  format: 'aufmacher' | 'fokus' | 'meldung' | 'kurz',   // 'fokus' ab 3: Im Fokus, 60–90 s, höchstens einer pro Folge
  investigative: true,                       // ab 3, optional: eigene Recherche eines Mediums (Enthüllung), vom Faktencheck bestätigt
  country: 'ISR', label: 'ISRAEL', flag: '🇮🇱', lon: 35.21, lat: 31.77, zoom: 10,
  places: [{ label: 'Nordkorea', lon: 127.5, lat: 40.3, route: false }],   // optional, Pin beim Wort
  headline: '[Israel] wählt mit [Rekord]beteiligung',   // eine Zeile auf der Karte, [..] = Akzentfarbe
  brief: 'Kurz gesagt, 2–3 Sätze',
  figure: { value: 55.7, dec: 1, prefix: '', suffix: ' %', label: 'Wahlbeteiligung um 16 Uhr' },  // optional, erscheint beim Wort
  source: { name: 'Times of Israel', url: 'https://…', date: '2026-10-27' },   // Hauptquelle = sources[0]
  sources: [Source, …],                      // ab 3: alle Quellen, Hauptquelle zuerst, dann die Hintergrund-Quelle
  short: 'Rekordbeteiligung in Israel',      // Schlagwort für die Zusammenfassung
  facts: [{ id: 'A1', text: 'Geprüfter Einzelfakt.',
            kind: 'kern',                    // ab 3: kern | problem | ausblick | detail | zahl | zitat | vorbehalt | hintergrund | reaktion
            source: 0 }, …],                 // ab 3: Index in sources
  background: { facts: ['A7', 'A8'] },       // ab 3, nur Aufmacher/Fokus ab Relevanz 4: Teil „Hintergrund“ (Fakten mit kind 'hintergrund')
  symbol: 'wahl',                            // optional, eines von SYMBOLS (types.ts)
  comparison: { label, unit: ' %', dec: 1, items: [{ label: '2022', value: 47.5 }, …], facts: ['A4'] },   // optional
  deadline: { time: '22:00', date: '2026-11-06', label, facts: ['A6'] },                                   // optional, time und/oder date
  images: [{ src: 'bilder/2026-10-28/ab12.jpg', w, h, motif: 'Gadi Eisenkot', match: 'Eisenkot', author, license, licenseUrl, page }],  // optional
  // ab 3, optional, nur aus geprüften Fakten (Erklär-Grafiken; im Code geprüft in assemble.ts):
  timeline: [{ date: '2022', label: '47,5 % bis 16 Uhr', facts: ['A4'] }, …],   // 2–5, älteste zuerst; date wörtlich wie im Fakt („März 2024“) oder 'heute' (nur als letzter)
  actors: [{ name: 'Likud', role: 'Partei von Netanjahu', position: 'tritt gegen Yashar an', facts: ['A5'] }, …],   // 2–4, name steht im Fakt
  chain: [{ label: 'Günstigere Konkurrenz aus China', facts: ['B3'] }, …]       // 2–4 Schritte Ursache → Wirkung, nur wenn die Fakten den Zusammenhang nennen
}
// MarketItem bekommt optional series: [Schlusskurse der letzten Handelstage] für den Kursverlauf
```
