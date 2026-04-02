# HOW TO USE: python csv_to_sequences.py parcourVis2000.utf8.csv sequences.json  (UTF-8 required)
#!/usr/bin/env python3
# csv_to_sequences.py  (robusto: rileva encoding e delimitatore)
import csv, json, sys, os
from datetime import datetime
from collections import defaultdict

ENCODINGS_TO_TRY = ['utf-8', 'utf-8-sig', 'cp1252', 'latin-1']

def try_detect_encoding_and_dialect(path, sample_size=4096):
    for enc in ENCODINGS_TO_TRY:
        try:
            with open(path, 'r', encoding=enc, errors='strict') as f:
                sample = f.read(sample_size)
            # if read succeeded, detect dialect
            sniffer = csv.Sniffer()
            try:
                dialect = sniffer.sniff(sample)
            except Exception:
                # fallback: try common delimiters
                for d in [',',';','\t']:
                    if d in sample:
                        class Dummy(csv.Dialect):
                            delimiter = d
                            quotechar = '"'
                            doublequote = True
                            skipinitialspace = True
                            lineterminator = '\n'
                            quoting = csv.QUOTE_MINIMAL
                        dialect = Dummy()
                        break
                else:
                    dialect = csv.excel
            return enc, dialect
        except Exception:
            continue
    return None, None

def parse_date_safe(s):
    if s is None: return None
    s = s.strip()
    if s == '': return None
    # try iso first
    try:
        return datetime.fromisoformat(s).date()
    except Exception:
        pass
    # try common formats
    for fmt in ('%Y-%m-%d','%d/%m/%Y','%d-%m-%Y','%Y/%m/%d','%m/%d/%Y'):
        try:
            return datetime.strptime(s, fmt).date()
        except Exception:
            continue
    # last resort: let the parser try
    try:
        from dateutil import parser as dparser
        return dparser.parse(s).date()
    except Exception:
        return None

def days_between(d1, d2):
    if not d1 or not d2: return 0
    return max(0, (d2 - d1).days)

def csv_to_sequences(inpath, outpath):
    enc, dialect = try_detect_encoding_and_dialect(inpath)
    if enc is None:
        raise SystemExit("Impossibile rilevare encoding: prova a convertire il file in UTF-8 o CP1252.")
    print(f"[info] detected encoding={enc}, delimiter='{getattr(dialect,'delimiter',',')}'")
    with open(inpath, 'r', encoding=enc, errors='replace', newline='') as f:
        reader = csv.DictReader(f, dialect=dialect)
        rows = [ {k.strip().lower(): (v if v is not None else '') for k,v in row.items()} for row in reader ]

    if not rows:
        raise SystemExit("Il CSV sembra vuoto o non ha righe valide.")

    # detect keys
    keys = set(rows[0].keys())
    pid_key = next((k for k in keys if k in ('num_enq','numenq','patient','id','patient_id','num')), None)
    cat_key = next((k for k in keys if k in ('category','event','type')), None)
    date_key = next((k for k in keys if k in ('date','datetime','time','event_date')), None)
    if pid_key is None or cat_key is None or date_key is None:
        print(f"[debug] keys found: {sorted(keys)}")
        raise SystemExit("Impossibile trovare le colonne obbligatorie. Assicurati che l'header contenga NUM_ENQ (o patient/id), category e date.")

    groups = defaultdict(list)
    for r in rows:
        pid = str(r.get(pid_key,'')).strip()
        if pid == '': continue
        rawd = r.get(date_key,'')
        d = parse_date_safe(rawd)
        groups[pid].append((d, r.get(cat_key,'').strip()))

    sequences = []
    for pid, events in groups.items():
        events = [e for e in events if e[0] is not None]
        if not events: continue
        events.sort(key=lambda x: x[0])
        segs = []
        cur_cat = None
        cur_start = None
        cur_end = None
        for d, cat in events:
            if cur_cat is None:
                cur_cat = cat; cur_start = d; cur_end = d
            elif cat == cur_cat:
                cur_end = d
            else:
                dur = days_between(cur_start, cur_end)
                if dur <= 0: dur = 7
                segs.append({"type": cur_cat, "duration": max(1, int(round(dur)))})
                cur_cat = cat; cur_start = d; cur_end = d
        if cur_cat is not None:
            dur = days_between(cur_start, cur_end)
            if dur <= 0: dur = 7
            segs.append({"type": cur_cat, "duration": max(1, int(round(dur)))})
        if segs:
            sequences.append(segs)

    with open(outpath, 'w', encoding='utf-8') as out:
        json.dump(sequences, out, ensure_ascii=False, indent=2)
    print(f"Wrote {len(sequences)} sequences to {outpath} (used encoding {enc})")

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python csv_to_sequences.py input.csv output.json")
        sys.exit(1)
    inpath = sys.argv[1]
    outpath = sys.argv[2]
    if not os.path.isfile(inpath):
        print("Input file not found:", inpath); sys.exit(1)
    csv_to_sequences(inpath, outpath)
