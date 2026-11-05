#!/usr/bin/env python3
"""
Back Table Torah - add a new shiur from a Zoom recording folder.

Easiest: drag the Zoom recording folder onto new_shiur.bat.
Have only the source sheet so far? Double-click new_shiur.bat, press Enter at the first
question, and fill in the details. Later, drag the Zoom folder onto it and give the same
number: the recording is added to that shiur and everything else is kept.
Or:      python new_shiur.py "C:\\Users\\you\\Documents\\Zoom\\2026-11-06 20.30.12 Back Table"

It asks for the title, speaker and topics, then:
  1. makes the shrunk audio      BackTable/audio/shiur-123.mp3   (48 kbps mono)
  2. copies the video for YouTube BackTable/youtube/Shiur 123 - Title.mp4
  3. copies the source sheet / picture if you give them
  4. adds the shiur to shiurim.json

Later, once the video is on YouTube:
  python new_shiur.py --youtube 123 https://youtu.be/XXXXXXXXXXX
  (or double-click set_youtube.bat)
"""
import datetime, glob, json, os, re, shutil, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SHRINK = ["-ac", "1", "-ar", "22050", "-b:a", "48k"]
DB = os.path.join(HERE, "shiurim.json")


def load():
    with open(DB, encoding="utf-8") as f:
        return json.load(f)


def save(S):
    shutil.copy2(DB, DB + ".bak")
    with open(DB, "w", encoding="utf-8") as f:
        json.dump(S, f, ensure_ascii=False, indent=1)


def ask(q, default=None, required=True):
    while True:
        a = input(f"{q}{f' [{default}]' if default else ''}: ").strip().strip('"')
        if a:
            return a
        if default is not None:
            return default
        if not required:
            return ""


def pick_one(title, options):
    print(f"\n{title}")
    for i, o in enumerate(options, 1):
        print(f"  {i}. {o}")
    while True:
        a = input("Number, or type a new name: ").strip()
        if a.isdigit() and 1 <= int(a) <= len(options):
            return options[int(a) - 1]
        if a and not a.isdigit():
            return a


def pick_many(title, options):
    print(f"\n{title}")
    for i, o in enumerate(options, 1):
        print(f"  {i}. {o}")
    a = input("Numbers separated by commas (Enter for none; you can also type a new topic): ").strip()
    out = []
    for part in [p.strip() for p in a.split(",") if p.strip()]:
        if part.isdigit() and 1 <= int(part) <= len(options):
            out.append(options[int(part) - 1])
        elif not part.isdigit():
            out.append(part)
    return list(dict.fromkeys(out))


def safe_name(s, limit=95):
    s = s.replace(":", " -").replace("/", "-").replace("\\", "-")
    s = re.sub(r'[<>"|?*\x00-\x1f]', "", s)
    return re.sub(r"\s+", " ", s).strip().rstrip(".")[:limit].rstrip()


def duration_text(path):
    try:
        r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
                           capture_output=True, text=True, check=True)
        m = round(float(r.stdout.strip()) / 60)
    except Exception:
        return ""
    h, m = divmod(m, 60)
    return (f"{h} hr {m} min" if m else f"{h} hr") if h else f"{m} min"


def largest(paths):
    return max(paths, key=os.path.getsize) if paths else None


def set_youtube(num, links):
    S = load()
    for s in S:
        if s["num"] == num:
            s["youtube"] = links
            save(S)
            print(f"Shiur {num}: YouTube link saved. Double-click publish.bat to update the site.")
            return
    sys.exit(f"Shiur {num} isn't in shiurim.json")


def main():
    args = sys.argv[1:]
    if args and args[0] == "--youtube":
        if len(args) < 3 or not args[1].isdigit():
            sys.exit("Usage: python new_shiur.py --youtube 123 https://youtu.be/XXXXXXXXXXX")
        return set_youtube(int(args[1]), args[2:])

    cfg = json.load(open(os.path.join(HERE, "config.json"), encoding="utf-8"))
    if os.path.exists(os.path.join(HERE, "config.local.json")):
        cfg.update(json.load(open(os.path.join(HERE, "config.local.json"), encoding="utf-8")))
    media = os.path.join(HERE, cfg.get("media_folder", "BackTable"))
    S = load()

    # ---- the recording (optional: a shiur can start with just its source sheet)
    folder = (args[0] if args else ask(
        "Drag the Zoom recording folder here and press Enter\n"
        "(or just press Enter to start with only the source sheet)", required=False)).strip('"')
    files, video, audio_src = [], None, None
    if folder:
        if not os.path.isdir(folder):
            sys.exit(f"Not a folder: {folder}")
        if not shutil.which("ffmpeg"):
            sys.exit("ffmpeg was not found. Install it first:  winget install Gyan.FFmpeg")
        files = [os.path.join(folder, f) for f in os.listdir(folder)]
        mp4 = [f for f in files if f.lower().endswith(".mp4")]
        m4a = [f for f in files if f.lower().endswith((".m4a", ".mp3", ".wav"))]
        video = largest(mp4)
        audio_src = next((f for f in m4a if "audio_only" in os.path.basename(f).lower()), None) or largest(m4a) or video
        if not audio_src:
            sys.exit("No video or audio file found in that folder.")
        print(f"\nVideo: {os.path.basename(video) if video else '(none)'}")
        print(f"Audio from: {os.path.basename(audio_src)}")
    else:
        print("\nStarting a shiur with just its source sheet. When you have the recording,")
        print("drag the Zoom folder onto new_shiur.bat and give the same shiur number.")

    # ---- which shiur
    waiting = [x for x in S if x.get("pending")]
    default = str(waiting[-1]["num"]) if (folder and waiting) else str(max(x["num"] or 0 for x in S) + 1)
    if folder and waiting:
        print("Waiting for a recording: " + ", ".join(f"Shiur {x['num']} ({x['title']})" for x in waiting))
    num = int(ask("\nShiur number", default))
    old = next((x for x in S if x["num"] == num), None)
    attach = False
    if old:
        if folder and old.get("pending"):
            attach = ask(f"Add this recording to Shiur {num} ({old['title']})? (y/n)", "y").lower() == "y"
        if not attach and ask(f"Shiur {num} already exists. Replace it completely? (y/n)", "n").lower() != "y":
            sys.exit("Nothing changed.")

    key = f"shiur-{num:03d}"
    for d in ("audio", "youtube", "pdf", "images"):
        os.makedirs(os.path.join(media, d), exist_ok=True)

    # ---- details (kept as they are when adding a recording to an existing shiur)
    if attach:
        entry = old
        title = old["title"]
        print(f"\nKeeping the title, date, speaker and topics already entered for Shiur {num}.")
    else:
        m = re.search(r"(\d{4}-\d{2}-\d{2})", os.path.basename(folder)) if folder else None
        date = ask("Date (YYYY-MM-DD)", m.group(1) if m else datetime.date.today().isoformat())
        title = ask("Title")
        counts = {}
        for x in S:
            if x["speaker"]:
                counts[x["speaker"]] = counts.get(x["speaker"], 0) + 1
        speakers = sorted(counts, key=lambda k: -counts[k])
        speaker = pick_one("Who gave it?", speakers)
        all_tags = sorted({t for x in S for t in x["tags"]}, key=lambda t: -sum(t in x["tags"] for x in S))
        tags = pick_many("Topics", all_tags)
        entry = {"num": num, "slug": f"shiur-{num}", "file_key": key, "date": date, "title": title,
                 "speaker": speaker, "tags": tags, "runtime": "", "youtube": [], "video_parts": 0,
                 "audio": [], "pdf": [], "images": [], "ext_links": [], "zoom_chat": [], "old_url": ""}

    # ---- source sheet and picture (asked only if the shiur doesn't have them yet)
    if not entry["pdf"]:
        pdfs = [f for f in files if f.lower().endswith(".pdf")]
        pdf = pdfs[0] if len(pdfs) == 1 else ask("\nSource sheet PDF (drag it here, or Enter to skip)", required=False).strip('"')
        if pdf and os.path.isfile(pdf):
            shutil.copy2(pdf, os.path.join(media, "pdf", key + ".pdf"))
            entry["pdf"] = [key + ".pdf"]
    if not entry["images"]:
        imgs = [f for f in files if f.lower().endswith((".jpg", ".jpeg", ".png", ".webp"))]
        img = imgs[0] if len(imgs) == 1 else ask("Picture for the shiur (drag it here, or Enter to skip)", required=False).strip('"')
        if img and os.path.isfile(img):
            ext = img.rsplit(".", 1)[-1].lower().replace("jpeg", "jpg")
            shutil.copy2(img, os.path.join(media, "images", f"{key}.{ext}"))
            entry["images"] = [f"{key}.{ext}"]

    # ---- the recording
    link = ""
    if folder:
        print("\nMaking the audio file...")
        mp3 = os.path.join(media, "audio", key + ".mp3")
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", audio_src, "-vn", *SHRINK,
                        "-metadata", f"title={title}", "-metadata", "artist=Back Table Torah",
                        "-metadata", "album=Back Table Torah", "-metadata", f"track={num}", mp3], check=True)
        print(f"  {mp3}  ({os.path.getsize(mp3) / 1e6:.1f} MB)")
        entry["audio"] = [key + ".mp3"]
        entry["runtime"] = duration_text(audio_src)
        if video:
            yt_file = os.path.join(media, "youtube", safe_name(f"Shiur {num:03d} - {title}") + ".mp4")
            print("Copying the video for YouTube...")
            shutil.copy2(video, yt_file)
            print(f"  {yt_file}")
            entry["video_parts"] = 1
        chat = next((f for f in files if os.path.basename(f).lower() in ("chat.txt", "meeting_saved_chat.txt")), None)
        if chat:
            with open(chat, encoding="utf-8", errors="replace") as f:
                entry["zoom_chat"] = [ln.rstrip() for ln in f if ln.strip()]
            print(f"Zoom chat found: {len(entry['zoom_chat'])} lines")
        entry.pop("pending", None)
        if video:
            print("\nUpload the video to the Back Table YouTube channel (Unlisted).")
            link = ask("Paste the YouTube link now, or press Enter to add it later", required=False)
            if link:
                entry["youtube"] = [link]
    else:
        entry["pending"] = True

    S = [x for x in S if x["num"] != num] + [entry]
    save(S)
    if not folder:
        print(f"\nShiur {num} added with its source sheet; the page will say the recording is coming soon.")
        print("Double-click publish.bat to put it up now.")
    else:
        print(f"\nShiur {num} {'recording added' if attach else 'added'}.")
        print("Next: upload the video to YouTube, then double-click publish.bat.")
        if video and not link:
            print(f"When the video is up: double-click set_youtube.bat (shiur {num}).")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nStopped. Nothing was saved.")
