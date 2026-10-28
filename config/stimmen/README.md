# Referenzstimmen

Jede Zeile einer Folge wird mit der Referenzstimme ihrer Rolle geklont, damit die Stimmen jeden Tag gleich
klingen. Die Stimmen sind aus einer Beschreibung entworfen, keine echte Person ist geklont.

## `voxcpm2/` (im Einsatz)

Entworfen am 28.10.2026 mit VoxCPM2 (Apache-2.0), Variante „ruhig“ aus dem Stimmtest
(Branch `stimmtest-voxcpm2-ruhig`, umgewandelt in WAV, 48 kHz mono). Der Text der Probe steht in
`config/pipeline.json` unter `voxcpm2.voices`.

| Datei | Rolle | Beschreibung beim Entwurf |
|---|---|---|
| `LEITUNG.wav` | LEITUNG | A German man in his forties with a calm, low, warm voice, speaking slowly and quietly in a relaxed way, like a late-night radio host asking short questions |
| `LAGE.wav` | LAGE | A German woman in her thirties with a calm, warm, medium-low voice, speaking at a steady, unhurried pace, clear and friendly, like a radio news presenter |
| `EINORDNUNG.wav` | EINORDNUNG | A German man in his fifties with a deep, soft, warm voice, speaking slowly and thoughtfully in a relaxed way, like a radio documentary narrator |

## `omnivoice/` (Archiv)

Erster OmniVoice-Entwurf aus dem Stimmtest (male, middle-aged, low pitch · female, young adult, high pitch ·
male, elderly, very low pitch). OmniVoice-Gewichte sind nur nichtkommerziell nutzbar (CC-BY-NC).
