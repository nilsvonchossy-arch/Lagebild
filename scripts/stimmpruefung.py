"""Verständlichkeit der Stimmtest-Aufnahmen prüfen: Whisper schreibt mit, Vergleich mit dem Sprechtext.

  python scripts/stimmpruefung.py <ordner mit <engine>/dialog.mp3 oder .wav> --out pruefung.json

Zeichenfehlerquote (ohne Leerzeichen, Satzzeichen und Bindestriche, damit „Penicillin-Werk“ und
„Penicillinwerk“ gleich zählen) und die Wörter, die anders verstanden wurden. Ziffern im Mitschrieb
werden vorher ausgeschrieben, weil der Sprechtext Zahlen als Wörter enthält.
"""
import argparse
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
DIALOG = json.load(open(os.path.join(HERE, "stimmtest-dialog.json"), encoding="utf-8"))
sys.path.insert(0, os.path.join(HERE, "..", "pipeline"))
from stimme_vergleich import compare as _compare  # noqa: E402


def compare(text):
    return _compare(" ".join(l.get("say") or l["text"] for l in DIALOG["zeilen"]), text)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("root", help="Ordner mit <engine>/dialog.mp3, oder mit --neu-vergleichen eine pruefung.json")
    ap.add_argument("--out", default="pruefung.json")
    ap.add_argument("--modell", default="large-v3-turbo")
    ap.add_argument("--neu-vergleichen", action="store_true", help="vorhandene Mitschriften nur neu vergleichen")
    a = ap.parse_args()
    if a.neu_vergleichen:
        result = json.load(open(a.root, encoding="utf-8"))
        for engine, r in result["aufnahmen"].items():
            r.update(compare(r["mitschrift"]))
            print(engine, r["zeichenfehler_pct"], "%", r["abweichungen"], "Abweichungen", flush=True)
        json.dump(result, open(a.out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        return
    from faster_whisper import WhisperModel

    t = time.time()
    model = WhisperModel(a.modell, device="cpu", compute_type="int8")
    result = {"modell": a.modell, "laden_s": round(time.time() - t, 1), "aufnahmen": {}}
    for engine in sorted(os.listdir(a.root)):
        found = [os.path.join(a.root, engine, f"dialog.{x}") for x in ("mp3", "wav")]
        found = [p for p in found if os.path.exists(p)]
        if not found:
            continue
        t = time.time()
        segs, _ = model.transcribe(found[0], language="de", beam_size=5, vad_filter=False)
        r = compare(" ".join(s.text.strip() for s in segs))
        r["rechenzeit_s"] = round(time.time() - t, 1)
        result["aufnahmen"][engine] = r
        print(engine, r["zeichenfehler_pct"], "%", r["abweichungen"], "Abweichungen", flush=True)
    json.dump(result, open(a.out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
