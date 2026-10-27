#!/usr/bin/env python3
"""
Back Table Torah - add a new shiur from a Zoom recording folder.

Easiest: drag the Zoom recording folder onto new_shiur.bat.
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

    if not shutil.which("ffmpeg"):
        sys.exit("ffmpeg was not found. Install it first:  winget install Gyan.FFmpeg")
    cfg = json.load(open(os.path.join(HERE, "config.json"), encoding="utf-8"))
    if os.path.exists(os.path.join(HERE, "config.local.json")):
        cfg.update(json.load(open(os.path.join(HERE, "config.local.json"), encoding="utf-8")))
    media = os.path.join(HERE, cfg.get("media_folder", "BackTable"))
    S = load()

    folder = args[0] if args else ask("Drag the Zoom recording folder here and press Enter")
    folder = folder.strip('"')
    if not os.path.isdir(folder):
        sys.exit(f"Not a folder: {folder}")
    files = [os.path.join(folder, f) for f in os.listdir(folder)]
    mp4 = [f for f in files if f.lower().endswith(".mp4")]
    m4a = [f for f in files if f.lower().endswith((".m4a", ".mp3", ".wav"))]
    video = largest(mp4)
    audio_src = next((f for f in m4a if "audio_only" in os.path.basename(f).lower()), None) or largest(m4a) or video
    if not audio_src:
        sys.exit("No video or audio file found in that folder.")
    print(f"\nVideo: {os.path.basename(video) if video else '(none)'}")
    print(f"Audio from: {os.path.basename(audio_src)}")

    num = int(ask("\nShiur number", str(max(s["num"] or 0 for s in S) + 1)))
    if any(s["num"] == num for s in S):
        if ask(f"Shiur {num} already exists. Replace it? (y/n)", "n").lower() != "y":
            sys.exit("Nothing changed.")
    m = re.search(r"(\d{4}-\d{2}-\d{2})", os.path.basename(folder))
    date = ask("Date (YYYY-MM-DD)", m.group(1) if m else datetime.date.today().isoformat())
    title = ask("Title")
    speakers = [k for k, _ in sorted({s["speaker"]: 0 for s in S if s["speaker"]}.items())]
    counts = {}
    for s in S:
        counts[s["speaker"]] = counts.get(s["speaker"], 0) + 1
    speakers.sort(key=lambda k: -counts.get(k, 0))
    speaker = pick_one("Who gave it?", speakers)
    all_tags = sorted({t for s in S for t in s["tags"]}, key=lambda t: -sum(t in s["tags"] for s in S))
    tags = pick_many("Topics", all_tags)

    pdfs = [f for f in files if f.lower().endswith(".pdf")]
    pdf = pdfs[0] if len(pdfs) == 1 else ask("\nSource sheet PDF (drag it here, or Enter to skip)", required=False)
    imgs = [f for f in files if f.lower().endswith((".jpg", ".jpeg", ".png", ".webp"))]
    img = imgs[0] if len(imgs) == 1 else ask("Picture for the shiur (drag it here, or Enter to skip)", required=False)

    key = f"shiur-{num:03d}"
    for d in ("audio", "youtube", "pdf", "images"):
        os.makedirs(os.path.join(media, d), exist_ok=True)

    print("\nMaking the audio file...")
    mp3 = os.path.join(media, "audio", key + ".mp3")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", audio_src, "-vn", *SHRINK,
                    "-metadata", f"title={title}", "-metadata", "artist=Back Table Torah",
                    "-metadata", "album=Back Table Torah", "-metadata", f"track={num}", mp3], check=True)
    print(f"  {mp3}  ({os.path.getsize(mp3) / 1e6:.1f} MB)")

    yt_file = None
    if video:
        yt_file = os.path.join(media, "youtube", safe_name(f"Shiur {num:03d} - {title}") + ".mp4")
        print("Copying the video for YouTube...")
        shutil.copy2(video, yt_file)
        print(f"  {yt_file}")
    pdf_list, img_list = [], []
    if pdf and os.path.isfile(pdf):
        shutil.copy2(pdf, os.path.join(media, "pdf", key + ".pdf"))
        pdf_list = [key + ".pdf"]
    if img and os.path.isfile(img):
        ext = img.rsplit(".", 1)[-1].lower().replace("jpeg", "jpg")
        shutil.copy2(img, os.path.join(media, "images", f"{key}.{ext}"))
        img_list = [f"{key}.{ext}"]

    entry = {"num": num, "slug": f"shiur-{num}", "file_key": key, "date": date, "title": title,
             "speaker": speaker, "tags": tags, "runtime": duration_text(audio_src),
             "youtube": [], "video_parts": 1 if video else 0, "audio": [key + ".mp3"],
             "pdf": pdf_list, "images": img_list, "ext_links": [], "zoom_chat": [], "old_url": ""}

    chat = next((f for f in files if os.path.basename(f).lower() in ("chat.txt", "meeting_saved_chat.txt")), None)
    if chat:
        with open(chat, encoding="utf-8", errors="replace") as f:
            entry["zoom_chat"] = [ln.rstrip() for ln in f if ln.strip()]
        print(f"Zoom chat found: {len(entry['zoom_chat'])} lines")

    print("\nUpload the video to the Back Table YouTube channel (Unlisted).")
    link = ask("Paste the YouTube link now, or press Enter to add it later", required=False)
    if link:
        entry["youtube"] = [link]

    S = [s for s in S if s["num"] != num] + [entry]
    save(S)
    print(f"\nShiur {num} added.")
    print("Next: upload the video to YouTube, then double-click publish.bat.")
    if not link:
        print(f"When the video is up: double-click set_youtube.bat (shiur {num}).")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nStopped. Nothing was saved.")
