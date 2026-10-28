"""Hörprobe mit offenen Stimm-Modellen (die Modelle hinter VoiceStudio), läuft in GitHub Actions auf der CPU.

  python scripts/stimmtest.py design   --out stimmtest        # drei Stimmen aus Beschreibungen entwerfen (VoxCPM2)
  python scripts/stimmtest.py voxcpm2  --out stimmtest        # Dialog aus 10.4 mit VoxCPM2 vertonen
  python scripts/stimmtest.py omnivoice --out stimmtest       # denselben Dialog mit OmniVoice vertonen

Die Stimmen werden aus einer Beschreibung entworfen, es wird keine echte Person geklont. Jede Zeile
wird einzeln erzeugt, danach mit den Pausen-Regeln aus src/shared/script.ts zusammengesetzt.
Ergebnis: <out>/<engine>/dialog.mp3 und <out>/bericht.json mit Rechenzeiten.
"""
import argparse
import json
import os
import re
import subprocess
import sys
import time

import numpy as np
import soundfile as sf

HERE = os.path.dirname(os.path.abspath(__file__))
DIALOG = json.load(open(os.path.join(HERE, "stimmtest-dialog.json"), encoding="utf-8"))
SEEDS = {"LEITUNG": 11, "LAGE": 23, "EINORDNUNG": 37}


def kind(l):
    return l.get("kind") or ("frage" if l["role"] == "LEITUNG" else "fakt")


def pause_before(prev, cur):
    """Wie pauseBefore in src/shared/script.ts."""
    if prev is None:
        return 0.0
    if kind(cur) == "zusammenfassung" and kind(prev) != "zusammenfassung":
        return 1.0
    if kind(cur) == "abschluss":
        return 0.35 if kind(prev) == "abschluss" else 0.6
    if cur.get("story") != prev.get("story"):
        return 0.9
    if prev["role"] == "LEITUNG" and cur["role"] != "LEITUNG" and prev["text"].rstrip().endswith("?"):
        return 0.3
    if prev["role"] != cur["role"]:
        return 0.5
    return 0.35 if re.search(r"[.!?…:][\"“”»«)]*$", prev["text"].strip()) else 0.12


def trim(wav, sr, db=-42.0, pad=0.03):
    """Stille am Anfang und Ende abschneiden."""
    if wav.ndim > 1:
        wav = wav.mean(axis=1)
    thr = 10 ** (db / 20) * max(1e-9, float(np.max(np.abs(wav))))
    idx = np.where(np.abs(wav) > thr)[0]
    if not len(idx):
        return wav
    a = max(0, idx[0] - int(pad * sr))
    b = min(len(wav), idx[-1] + int(pad * sr))
    return wav[a:b]


def level(wav, target_db=-20.0):
    """Gleiche Lautheit pro Zeile (RMS der lauten Teile), Spitzen unter -1 dBFS."""
    frame = 1024
    n = len(wav) // frame
    if n == 0:
        return wav
    rms = np.sqrt(np.mean(wav[: n * frame].reshape(n, frame) ** 2, axis=1))
    loud = rms[rms > np.max(rms) * 0.25]
    cur = float(np.sqrt(np.mean(loud ** 2))) if len(loud) else 1e-9
    g = 10 ** (target_db / 20) / max(cur, 1e-9)
    peak = float(np.max(np.abs(wav))) * g
    if peak > 0.89:
        g *= 0.89 / peak
    return wav * g


def assemble(chunks, sr, out_mp3):
    parts = [np.zeros(int(0.5 * sr), dtype=np.float32)]
    prev = None
    for line, wav in chunks:
        parts.append(np.zeros(int(pause_before(prev, line) * sr), dtype=np.float32))
        parts.append(level(trim(wav, sr)).astype(np.float32))
        prev = line
    parts.append(np.zeros(int(0.8 * sr), dtype=np.float32))
    full = np.concatenate(parts)
    tmp = out_mp3.replace(".mp3", ".wav")
    sf.write(tmp, full, sr)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", tmp, "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-ac", "1", "-b:a", "96k", out_mp3], check=True)
    os.remove(tmp)
    return len(full) / sr


def report(out, key, data):
    path = os.path.join(out, "bericht.json")
    rep = json.load(open(path, encoding="utf-8")) if os.path.exists(path) else {}
    rep[key] = data
    json.dump(rep, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)


def say(l):
    return l.get("say") or l["text"]


def load_voxcpm():
    from voxcpm import VoxCPM
    t = time.time()
    m = VoxCPM.from_pretrained("openbmb/VoxCPM2", load_denoiser=False)
    return m, time.time() - t


def cmd_design(out):
    """Drei Referenzstimmen aus Beschreibungen (VoxCPM2 Voice Design)."""
    m, load = load_voxcpm()
    sr = m.tts_model.sample_rate
    os.makedirs(os.path.join(out, "stimmen"), exist_ok=True)
    info = {"laden_s": round(load, 1), "stimmen": {}}
    for role, v in DIALOG["stimmen"].items():
        t = time.time()
        wav = m.generate(text=f"({v['beschreibung']}){v['probe']}", cfg_value=2.0, inference_timesteps=10, seed=SEEDS[role])
        wav = trim(np.asarray(wav, dtype=np.float32), sr)
        sf.write(os.path.join(out, "stimmen", f"{role}.wav"), wav, sr)
        info["stimmen"][role] = {"rechenzeit_s": round(time.time() - t, 1), "dauer_s": round(len(wav) / sr, 2)}
        print(role, info["stimmen"][role], flush=True)
    report(out, "design", info)


def cmd_voxcpm2(out):
    m, load = load_voxcpm()
    sr = m.tts_model.sample_rate
    refs = {r: os.path.join(out, "stimmen", f"{r}.wav") for r in DIALOG["stimmen"]}
    os.makedirs(os.path.join(out, "voxcpm2"), exist_ok=True)
    chunks, t0 = [], time.time()
    for i, l in enumerate(DIALOG["zeilen"]):
        r = l["role"]
        wav = m.generate(text=say(l), prompt_wav_path=refs[r], prompt_text=DIALOG["stimmen"][r]["probe"], reference_wav_path=refs[r], cfg_value=2.0, inference_timesteps=10, seed=SEEDS[r])
        chunks.append((l, np.asarray(wav, dtype=np.float32)))
        print(f"{i + 1}/{len(DIALOG['zeilen'])} {r}: {l['text']}", flush=True)
    calc = time.time() - t0
    dur = assemble(chunks, sr, os.path.join(out, "voxcpm2", "dialog.mp3"))
    report(out, "voxcpm2", {"laden_s": round(load, 1), "rechenzeit_s": round(calc, 1), "audio_s": round(dur, 1), "rtf": round(calc / dur, 2)})


def cmd_omnivoice(out):
    import torch
    from omnivoice import OmniVoice
    t = time.time()
    m = OmniVoice.from_pretrained("k2-fsa/OmniVoice", device_map="cpu", dtype=torch.float32)
    load = time.time() - t
    sr = 24000
    os.makedirs(os.path.join(out, "omnivoice"), exist_ok=True)
    refs = {r: os.path.join(out, "stimmen", f"{r}.wav") for r in DIALOG["stimmen"]}
    have_refs = all(os.path.exists(p) for p in refs.values())
    design = {"LEITUNG": "male, middle-aged, low pitch", "LAGE": "female, young adult, moderate pitch", "EINORDNUNG": "male, elderly, low pitch"}
    chunks, t0 = [], time.time()
    for i, l in enumerate(DIALOG["zeilen"]):
        r = l["role"]
        if have_refs:
            audio = m.generate(text=say(l), ref_audio=refs[r], ref_text=DIALOG["stimmen"][r]["probe"])
        else:
            audio = m.generate(text=say(l), instruct=design[r])
        chunks.append((l, np.asarray(audio[0], dtype=np.float32)))
        print(f"{i + 1}/{len(DIALOG['zeilen'])} {r}: {l['text']}", flush=True)
    calc = time.time() - t0
    dur = assemble(chunks, sr, os.path.join(out, "omnivoice", "dialog.mp3"))
    report(out, "omnivoice", {"laden_s": round(load, 1), "rechenzeit_s": round(calc, 1), "audio_s": round(dur, 1), "rtf": round(calc / dur, 2), "stimmen": "VoxCPM2-Entwurf" if have_refs else "OmniVoice-Entwurf"})


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["design", "voxcpm2", "omnivoice"])
    ap.add_argument("--out", default="stimmtest")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    try:
        {"design": cmd_design, "voxcpm2": cmd_voxcpm2, "omnivoice": cmd_omnivoice}[a.cmd](a.out)
    except Exception as e:  # Fehler in den Bericht, damit der Lauf weitergeht
        report(a.out, a.cmd, {"fehler": f"{type(e).__name__}: {e}"})
        print("FEHLER", e, file=sys.stderr)
        sys.exit(1)
