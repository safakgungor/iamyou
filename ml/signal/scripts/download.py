"""Download the PhysioNet wearable dataset files the Signal model needs.

Usage: python download.py <out dir>

Fetches HR, EDA, TEMP, ACC, IBI and tags for every session, plus the
metadata files, from PhysioNet's open-data mirror on AWS, then checks each
file against the dataset's SHA256SUMS.txt. About 160 MB.
"""
import hashlib
import os
import re
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor

BUCKET = 'https://physionet-open.s3.amazonaws.com'
PREFIX = 'wearable-device-dataset/1.0.1/'
WANT = re.compile(r'/(HR|EDA|TEMP|ACC|IBI|tags)\.csv$|\.txt$|Stress_Level_v[12]\.csv$|'
                  r'subject-info\.csv$|Data_Dictionary\.csv$|\.ipynb$')


def list_keys():
    keys, marker = [], ''
    while True:
        url = f'{BUCKET}/?prefix={PREFIX}&max-keys=1000' + (f'&marker={marker}' if marker else '')
        xml = urllib.request.urlopen(url, timeout=60).read().decode()
        page = re.findall(r'<Key>([^<]+)</Key>', xml)
        keys += page
        if '<IsTruncated>true' not in xml:
            return keys
        marker = page[-1]


def fetch(key, out):
    path = os.path.join(out, key[len(PREFIX):])
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with urllib.request.urlopen(f'{BUCKET}/{key}', timeout=300) as r, open(path, 'wb') as f:
        f.write(r.read())
    return path


def main(out):
    keys = [k for k in list_keys() if WANT.search(k)]
    with ThreadPoolExecutor(12) as pool:
        list(pool.map(lambda k: fetch(k, out), keys))
    sums = {}
    with open(os.path.join(out, 'SHA256SUMS.txt')) as f:
        for line in f:
            digest, name = line.split(maxsplit=1)
            sums[name.strip()] = digest
    bad = []
    for k in keys:
        name = k[len(PREFIX):]
        if name not in sums:
            continue
        with open(os.path.join(out, name), 'rb') as f:
            if hashlib.sha256(f.read()).hexdigest() != sums[name]:
                bad.append(name)
    print(f'{len(keys)} files downloaded, {len(bad)} checksum failures')
    if bad:
        sys.exit('checksum mismatch: ' + ', '.join(bad[:5]))


if __name__ == '__main__':
    main(sys.argv[1])
