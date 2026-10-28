# Einrichtung (am iPad, alles in Safari)

Einmalig nötig. Danach läuft Lagebild jeden Morgen von selbst.

## 1. Repo öffentlich machen und Pages einschalten
1. github.com/nilsvonchossy-arch/Lagebild → **Settings** → **General** → ganz unten „Danger Zone“ → **Change visibility** → **Public**.
2. **Settings** → **Pages** → „Build and deployment“ → Source: **GitHub Actions**.

Die App liegt danach unter **https://nilsvonchossy-arch.github.io/Lagebild/** (für Suchmaschinen gesperrt, aber per Link erreichbar).

Warum öffentlich: Die GitHub-Server für öffentliche Repos sind kostenlos und haben 4 Kerne und 16 GB Speicher. Die offene Stimme (VoxCPM2) braucht etwa 10 GB; auf den Servern privater Repos (2 Kerne, 7 GB, 2.000 Gratis-Minuten im Monat) muss sie auslagern und wird unzuverlässig langsam. Sichtbar werden Code, Dokumentation (auch diese Datei und CLAUDE.md) und die täglichen Folgen; Schlüssel und der GitHub-Token der App bleiben geheim. Die Historie ist geprüft: keine Schlüssel, alle Commits unter „Claude“ oder dem GitHub-Bot.

## 2. Claude API (Anthropic)
Die API ist ein eigenes Konto und **nicht** im Claude-Abo enthalten.
1. [console.anthropic.com](https://console.anthropic.com) → Konto anlegen.
2. **Billing** → 5 $ Guthaben aufladen.
3. **Limits** → Monatslimit setzen, z. B. 10 $.
4. **API Keys** → **Create Key** „lagebild“ → Schlüssel kopieren.

## 3. Azure Speech (nur nötig, wenn du statt VoxCPM2 Azure als Stimme wählst)
Voreingestellt ist die offene Stimme VoxCPM2: kein Konto, keine Kosten, sie rechnet jeden Morgen auf dem GitHub-Server. Azure ist die Alternative im Themen-Editor (Stimme: Azure).
1. [portal.azure.com](https://portal.azure.com) → Konto anlegen (Kreditkarte nur zur Verifizierung).
2. Oben „Speech service“ suchen → **Create**.
3. Region **West Europe**, Pricing tier **Free F0** (500.000 Zeichen pro Monat gratis; Lagebild braucht etwa 100.000 bei 3 Minuten pro Tag, 250.000 bei 8 Minuten).
4. Nach dem Anlegen: **Keys and Endpoint** → **Key 1** kopieren.

## 4. Schlüssel als Secrets bei GitHub eintragen
Repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**:

| Name | Wert |
|---|---|
| `ANTHROPIC_API_KEY` | Schlüssel aus Schritt 2 |
| `AZURE_SPEECH_KEY` | Key 1 aus Schritt 3 (nur für Azure) |
| `AZURE_SPEECH_REGION` | `westeurope` (nur für Azure) |

Die Schlüssel stehen nirgends im Code und sind auch im öffentlichen Repo nicht sichtbar.

## 5. App auf den Homescreen legen
Die App-Adresse in Safari öffnen → Teilen-Symbol → **Zum Home-Bildschirm**. Ab dann startet Lagebild wie eine App, auch offline mit dem letzten Update.

## 6. Themen in der App bearbeiten (GitHub-Zugang)
Damit Änderungen an den Themen die Recherche steuern, speichert die App sie im Repo. Dafür einmalig einen Schlüssel anlegen:
1. [Neuen Fine-grained Token anlegen](https://github.com/settings/personal-access-tokens/new), Name „Lagebild-App“, Ablauf nach Wunsch.
2. **Repository access** → **Only select repositories** → Lagebild.
3. **Permissions** → **Contents**: Read and write, **Actions**: Read and write.
4. Token kopieren und in der App unter Einstellungen → GitHub-Zugang einfügen.

Der Token liegt nur auf dem iPad. Geht das iPad verloren: Token auf github.com widerrufen.

## Von Hand starten
Repo → **Actions** → **Tages-Update** → **Run workflow**:
- `update`: neues Tages-Update (mit „force“ auch, wenn es heute schon eins gibt)
- `check-feeds`: nur prüfen, ob alle Nachrichtenquellen erreichbar sind (kostet nichts)
- `compare`: dieselben Meldungen mit mehreren Claude-Modellen schreiben lassen (inklusive Drehbuch), Ergebnis im Branch `daten` unter `vergleich/`
- `voices`: Hörproben der deutschen Azure-Stimmen im Branch `daten` unter `stimmproben/`

Außerdem: **Demo vertonen** (die Demo-Folge mit der Stimme der Pipeline sprechen lassen, gleichzeitig Messlauf für die Rechenzeit), **Stimmtest** (offene Stimm-Modelle vergleichen), **Stimmprüfung** (Whisper schreibt die Stimmtests mit), **Archivbilder (Demo)** und **Texturen** (Satellitenbilder der NASA für den Globus neu laden).

Der tägliche Lauf startet um 5:45 Uhr (Berlin), weil VoxCPM2 auf der CPU etwa 20 Sekunden pro Sekunde Sprache rechnet (3-Minuten-Folge knapp eine Stunde); eine 8-Minuten-Folge startet um 4:45. Wiederholungen bis 8:45 Uhr.

Oder in der App: Einstellungen → **Jetzt recherchieren**.

## Kosten im Blick
- Claude: console.anthropic.com → **Usage**. Jedes Update steht außerdem mit seinen Kosten in `logs/JJJJ-MM-TT.json` im Branch `daten`.
- Azure: portal.azure.com → **Cost Management**. Im F0-Tarif fallen keine Kosten an; ist das Kontingent erschöpft, liefert Azure bis Monatsende keine Stimme mehr und die App nimmt die Systemstimme.
