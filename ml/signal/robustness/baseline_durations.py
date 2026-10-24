"""Length of the tagged seated baseline on each stress-protocol day (seconds).
Usage: python -I baseline_durations.py <Wearable_Dataset dir> <out.csv>"""
import csv, datetime as dt, os, sys
root, out = sys.argv[1], sys.argv[2]
rows = []
for folder in sorted(os.listdir(os.path.join(root, 'STRESS'))):
    d = os.path.join(root, 'STRESS', folder)
    if not os.path.isdir(d):
        continue
    with open(os.path.join(d, 'EDA.csv')) as f:
        start = dt.datetime.fromisoformat(f.readline().strip().split(',')[0])
    with open(os.path.join(d, 'tags.csv')) as f:
        tags = [start] + [dt.datetime.fromisoformat(l.strip()) for l in f if l.strip()]
    v1 = folder.startswith('S')
    i, j = (1, 2) if v1 else (0, 1)
    if len(tags) > j:
        rows.append(dict(folder=folder, version='V1' if v1 else 'V2',
                         baseline_s=round((tags[j] - tags[i]).total_seconds(), 1)))
with open(out, 'w', newline='') as f:
    w = csv.DictWriter(f, fieldnames=['folder', 'version', 'baseline_s']); w.writeheader(); w.writerows(rows)
for r in rows: print(r['folder'], r['version'], r['baseline_s'])
