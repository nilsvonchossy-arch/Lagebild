"""Stimme der Folge mit VoxCPM2 (offenes Modell, Apache-2.0) auf der CPU, aufgerufen von pipeline/tts-voxcpm.ts.

  python pipeline/stimme_voxcpm.py auftrag.json ausgabe/

auftrag.json: {"lines": [{"i", "role", "say", "ref"}], "voices": {ROLLE: {"ref", "text"}}, "cfg", "steps",
               "attempts", "whisper", "seed", "dtype"}
  say  Sprechtext (Zahlen und Abkürzungen ausgeschrieben, src/shared/sprechtext.ts)
  ref  derselbe Text ohne buchstabierte Abkürzungen, zum Vergleich mit der Whisper-Mitschrift

Jede Rolle klont eine feste Referenzstimme (config/stimmen/voxcpm2); die Stimmprobe wird einmal kodiert.
Whisper schreibt jede Zeile mit: Weicht sie ab (verschluckte Verneinung, wiederholte oder fehlende
Satzteile, zu viele falsche Zeichen), wird sie mit anderem Zufall neu erzeugt. Die Wortzeiten aus
Whisper ergeben die Untertitel-Zeitmarken.

Auf der CPU rechnet das Modell in float32 (Voreinstellung "dtype"): Das Checkpoint-Format bfloat16
können die meisten Server-CPUs nicht direkt und rechnen es um, das kostet ein Vielfaches an Zeit.

Ergebnis: ausgabe/zeile-NNN.wav (16 Bit) und ausgabe/ergebnis.json mit Wortzeiten, Prüfung und Rechenzeiten.
"""
import json
import os
import sys
import time

import numpy as np
import soundfile as sf

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from stimme_vergleich import judge  # noqa: E402

# Nach allen Versuchen sind diese Fehler nicht hinnehmbar: Sie würden etwas Falsches sagen
HARD = ("Verneinung fehlt", "zusätzlich")


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def trim(wav, sr, db=-42.0, pad=0.03):
    if wav.ndim > 1:
        wav = wav.mean(axis=1)
    peak = float(np.max(np.abs(wav))) if len(wav) else 0.0
    if not peak:
        return wav
    idx = np.where(np.abs(wav) > peak * 10 ** (db / 20))[0]
    a = max(0, idx[0] - int(pad * sr))
    b = min(len(wav), idx[-1] + int(pad * sr))
    return wav[a:b]


def cpu_info():
    try:
        info = open("/proc/cpuinfo", encoding="utf-8").read()
    except OSError:
        return "unbekannt"
    name = next((l.split(":", 1)[1].strip() for l in info.splitlines() if l.startswith("model name")), "unbekannt")
    flags = next((l.split(":", 1)[1].split() for l in info.splitlines() if l.startswith("flags")), [])
    native = [f for f in ("avx512_bf16", "amx_bf16") if f in flags]
    return f"{name}, bfloat16 nativ: {', '.join(native) or 'nein'}"


def main():
    job = json.load(open(sys.argv[1], encoding="utf-8"))
    out = sys.argv[2]
    os.makedirs(out, exist_ok=True)
    import torch
    from faster_whisper import WhisperModel
    import voxcpm.model.voxcpm2 as voxcpm2
    from voxcpm import VoxCPM

    dtype = job.get("dtype", "float32")
    pick = voxcpm2.pick_runtime_dtype
    voxcpm2.pick_runtime_dtype = lambda device, configured: dtype if device == "cpu" else pick(device, configured)
    torch.set_num_threads(os.cpu_count() or 2)
    log(f"CPU: {cpu_info()}, {torch.get_num_threads()} Threads, Rechenformat {dtype}")
    t0 = time.time()
    model = VoxCPM.from_pretrained("openbmb/VoxCPM2", load_denoiser=False)
    tts = model.tts_model
    sr = tts.sample_rate
    load_tts = time.time() - t0
    caches = {}
    for role, v in job["voices"].items():
        caches[role] = tts.build_prompt_cache(prompt_text=v["text"], prompt_wav_path=v["ref"], reference_wav_path=v["ref"])
    t1 = time.time()
    whisper = WhisperModel(job.get("whisper", "large-v3-turbo"), device="cpu", compute_type="int8")
    load_whisper = time.time() - t1
    log(f"Modelle geladen: VoxCPM2 {load_tts:.0f} s, Whisper {load_whisper:.0f} s, Abtastrate {sr} Hz")

    results = []
    t_gen = time.time()
    for n, line in enumerate(job["lines"]):
        best = None
        for attempt in range(1, int(job.get("attempts", 3)) + 1):
            torch.manual_seed(int(job.get("seed", 7)) + 1000 * attempt + n)
            ts = time.time()
            wav, _, _ = tts.generate_with_prompt_cache(
                target_text=line["say"], prompt_cache=caches[line["role"]],
                inference_timesteps=int(job.get("steps", 10)), cfg_value=float(job.get("cfg", 2.0)), retry_badcase=True,
            )
            audio = trim(wav.squeeze(0).cpu().numpy().astype(np.float32), sr)
            path = os.path.join(out, f"zeile-{line['i']:03d}.wav")
            tmp = path + f".{attempt}.wav"
            sf.write(tmp, audio, sr, subtype="PCM_16")
            segs, _ = whisper.transcribe(tmp, language="de", beam_size=5, word_timestamps=True, vad_filter=False)
            segs = list(segs)
            transcript = " ".join(s.text.strip() for s in segs)
            bounds = [{"end": round(w.end, 2), "len": len(w.word.strip())} for s in segs for w in (s.words or []) if w.word.strip()]
            check = judge(line["ref"], transcript)
            score = (len([p for p in check["probleme"] if p.startswith(HARD)]), len(check["probleme"]), check["zeichenfehler_pct"])
            cand = {"tmp": tmp, "check": check, "bounds": bounds, "dur": round(len(audio) / sr, 2), "attempt": attempt, "score": score, "sec": round(time.time() - ts, 1)}
            if best is None or score < best["score"]:
                if best:
                    os.remove(best["tmp"])
                best = cand
            else:
                os.remove(tmp)
            log(f"{n + 1}/{len(job['lines'])} {line['role']} Versuch {attempt}: {cand['sec']} s, {check['zeichenfehler_pct']} % {'; '.join(check['probleme']) or 'ok'}")
            if check["ok"]:
                break
        hard = [p for p in best["check"]["probleme"] if p.startswith(HARD)]
        os.replace(best["tmp"], path)
        results.append({
            "i": line["i"], "ok": not hard, "file": os.path.basename(path), "dur": best["dur"], "bounds": best["bounds"],
            "attempts": best["attempt"], "cer": best["check"]["zeichenfehler_pct"], "problems": best["check"]["probleme"],
            "transcript": best["check"]["mitschrift"],
        })
    calc = time.time() - t_gen
    audio_s = sum(r["dur"] for r in results)
    report = {
        "engine": "voxcpm2", "sr": sr, "dtype": dtype, "cpu": cpu_info(), "load_tts_s": round(load_tts, 1), "load_whisper_s": round(load_whisper, 1),
        "calc_s": round(calc, 1), "audio_s": round(audio_s, 1), "rtf": round(calc / max(audio_s, 0.1), 2),
        "retried": sum(1 for r in results if r["attempts"] > 1), "failed": [r["i"] for r in results if not r["ok"]],
        "lines": results,
    }
    json.dump(report, open(os.path.join(out, "ergebnis.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    log(f"Fertig: {len(results)} Zeilen, {audio_s:.0f} s Audio in {calc:.0f} s (Faktor {report['rtf']}), "
        f"{report['retried']} neu erzeugt, {len(report['failed'])} unbrauchbar")


if __name__ == "__main__":
    main()
