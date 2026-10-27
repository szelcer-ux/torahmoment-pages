#!/usr/bin/env python3
"""
Back Table Torah - fill in YouTube links from the playlist.

1. Open the playlist in Chrome, press F12 -> Console, paste the copy(...) line, press Enter.
2. Paste the result into youtube_list.txt (in this folder) and save.
3. Double-click import_youtube.bat, then publish.bat

Each line looks like:   Shiur 120   Forgiveness in Halacha<TAB>sco7DdcHuaE
Videos split in parts ("Shiur 034 - ... (part 2)") are put in order.
"""
import json, os, re, shutil, sys

HERE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(HERE, "shiurim.json")


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "youtube_list.txt")
    if not os.path.exists(src):
        sys.exit(f"Put the copied list in {src} first.")
    found = {}
    for line in open(src, encoding="utf-8-sig"):
        line = line.strip()
        if not line:
            continue
        m_id = re.search(r"([A-Za-z0-9_-]{11})\s*$", line)
        m_num = re.search(r"Shiur\s*#?\s*0*(\d+)", line, re.I)
        mini = re.search(r"Mini[- ]Episode", line, re.I)
        if not m_id or not (m_num or mini):
            print(f"  skipped (couldn't read): {line[:70]}")
            continue
        num = int(m_num.group(1)) if m_num else None
        part = re.search(r"part\s*(\d+)", line, re.I)
        found.setdefault(num, []).append((int(part.group(1)) if part else 1, m_id.group(1)))

    with open(DB, encoding="utf-8") as f:
        S = json.load(f)
    changed = 0
    for s in S:
        if s["num"] in found:
            links = [f"https://youtu.be/{vid}" for _, vid in sorted(found[s["num"]])]
            if s["youtube"] != links:
                s["youtube"] = links
                changed += 1
    known = {s["num"] for s in S}
    for n in found:
        if n not in known:
            print(f"  Shiur {n} is not in shiurim.json - skipped")
    shutil.copy2(DB, DB + ".bak")
    with open(DB, "w", encoding="utf-8") as f:
        json.dump(S, f, ensure_ascii=False, indent=1)
    have = sum(1 for s in S if s["youtube"])
    need = sum(1 for s in S if s["video_parts"])
    print(f"Read {sum(len(v) for v in found.values())} videos; updated {changed} shiurim.")
    print(f"Shiurim with video linked: {have} of {need}. Double-click publish.bat to update the site.")


if __name__ == "__main__":
    main()
