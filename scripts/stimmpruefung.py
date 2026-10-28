"""Verständlichkeit der Stimmtest-Aufnahmen prüfen: Whisper schreibt mit, Vergleich mit dem Sprechtext.

  python scripts/stimmpruefung.py <ordner mit <engine>/dialog.mp3 oder .wav> --out pruefung.json

Zeichenfehlerquote (ohne Leerzeichen, Satzzeichen und Bindestriche, damit „Penicillin-Werk“ und
„Penicillinwerk“ gleich zählen) und die Wörter, die anders verstanden wurden. Ziffern im Mitschrieb
werden vorher ausgeschrieben, weil der Sprechtext Zahlen als Wörter enthält.
"""
import argparse
import difflib
import json
import os
import re
import time

HERE = os.path.dirname(os.path.abspath(__file__))
DIALOG = json.load(open(os.path.join(HERE, "stimmtest-dialog.json"), encoding="utf-8"))


MONTHS = "Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember"


def spoken_numbers(text):
    """Ziffern im Mitschrieb ausschreiben, wie im Sprechtext („6. November“ → „sechsten November“)."""
    from num2words import num2words

    def dec(m):
        a, b = m.group(1).replace(".", ""), m.group(2)
        return f"{num2words(int(a), lang='de')} komma {' '.join(num2words(int(d), lang='de') for d in b)}"

    text = re.sub(r"([A-Za-z])(\d)", r"\1 \2", text)  # „M5“, „P500“
    text = re.sub(rf"\b(\d+)\.\s+({MONTHS})", lambda m: f"{num2words(int(m.group(1)), lang='de', to='ordinal')}n {m.group(2)}", text)
    text = re.sub(r"(\d[\d.]*),(\d+)", dec, text)
    return re.sub(r"\d[\d.]*\d|\d", lambda m: num2words(int(m.group(0).replace(".", "")), lang="de"), text)


# Gleichwertige Schreibweisen, die keine Aussprachefehler sind
SAME = [("ka-i", "ki"), ("vierzehnhundert", "tausendvierhundert"), ("eintausend", "tausend")]


def words(text):
    text = text.lower()
    for a, b in SAME:
        text = text.replace(a, b)
    text = text.replace("-", "").replace("–", " ").replace("&", " und ")
    return re.findall(r"[a-zäöüß0-9]+", text)


def cer(ref, hyp):
    a, b = "".join(ref), "".join(hyp)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i] + [0] * len(b)
        for j, cb in enumerate(b, 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb))
        prev = cur
    return prev[-1] / max(1, len(a))


def diffs(ref, hyp):
    out = []
    for op, i1, i2, j1, j2 in difflib.SequenceMatcher(a=ref, b=hyp, autojunk=False).get_opcodes():
        if op != "equal" and "".join(ref[i1:i2]) != "".join(hyp[j1:j2]):  # nur anders getrennt
            out.append({"gesagt": " ".join(ref[i1:i2]), "verstanden": " ".join(hyp[j1:j2])})
    return out


def compare(text):
    ref = words(" ".join(l.get("say") or l["text"] for l in DIALOG["zeilen"]))
    hyp = words(spoken_numbers(text))
    d = diffs(ref, hyp)
    return {"zeichenfehler_pct": round(100 * cer(ref, hyp), 1), "abweichungen": len(d), "unterschiede": d, "mitschrift": text}


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
