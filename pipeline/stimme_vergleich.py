"""Vergleich zwischen Sprechtext und Whisper-Mitschrift (für Stimmprüfung und VoxCPM2-Engine).

Zeichenfehlerquote ohne Leerzeichen, Satzzeichen und Bindestriche, damit „Penicillin-Werk“ und
„Penicillinwerk“ gleich zählen; Ziffern im Mitschrieb werden vorher ausgeschrieben, weil der
Sprechtext Zahlen als Wörter enthält. Dazu die Stellen, die anders verstanden wurden.
"""
import difflib
import re

MONTHS = "Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember"

# Gleichwertige Schreibweisen, die keine Aussprachefehler sind
SAME = [("ka-i", "ki"), ("vierzehnhundert", "tausendvierhundert"), ("eintausend", "tausend"), ("einhundert", "hundert")]

# Wörter, deren Fehlen den Sinn umdreht
NEGATION = {"nicht", "kein", "keine", "keinen", "keiner", "keinem", "nie", "niemals", "nichts"}


def spoken_numbers(text):
    """Ziffern im Mitschrieb ausschreiben („6. November“ → „sechsten November“, 1973 → Jahreszahl)."""
    from num2words import num2words

    def dec(m):
        a, b = m.group(1).replace(".", ""), m.group(2)
        return f"{num2words(int(a), lang='de')} komma {' '.join(num2words(int(d), lang='de') for d in b)}"

    def whole(m):
        s = m.group(0)
        n = int(s.replace(".", ""))
        if len(s) == 4 and 1100 <= n <= 1999:
            return num2words(n, lang="de", to="year")
        return num2words(n, lang="de")

    text = re.sub(r"([A-Za-z])(\d)", r"\1 \2", text)  # „M5“, „P500“
    text = re.sub(rf"\b(\d+)\.\s+({MONTHS})", lambda m: f"{num2words(int(m.group(1)), lang='de', to='ordinal')}n {m.group(2)}", text)
    text = re.sub(r"(\d[\d.]*),(\d+)", dec, text)
    return re.sub(r"\d[\d.]*\d|\d", whole, text)


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


def compare(reference, transcript):
    ref = words(reference)
    hyp = words(spoken_numbers(transcript))
    d = diffs(ref, hyp)
    return {"zeichenfehler_pct": round(100 * cer(ref, hyp), 1), "abweichungen": len(d), "unterschiede": d, "mitschrift": transcript}


def judge(reference, transcript, max_cer=0.25):
    """Ist die Aufnahme brauchbar? Fehler: zu viele falsche Zeichen, fehlende oder zusätzliche Wortfolgen
    (ausgelassene oder wiederholte Satzteile), verschluckte Verneinung."""
    r = compare(reference, transcript)
    problems = []
    if r["zeichenfehler_pct"] > max_cer * 100:
        problems.append(f"{r['zeichenfehler_pct']} % Zeichenfehler")
    for x in r["unterschiede"]:
        said, heard = x["gesagt"].split(), x["verstanden"].split()
        if len(heard) - len(said) >= 4:
            problems.append(f"zusätzlich: „{x['verstanden']}“")
        if len(said) - len(heard) >= 3:
            problems.append(f"fehlt: „{x['gesagt']}“")
        lost = [w for w in said if w in NEGATION and w not in heard]
        if lost:
            problems.append(f"Verneinung fehlt: „{' '.join(lost)}“")
    r["probleme"] = problems
    r["ok"] = not problems
    return r
