#!/usr/bin/env python3
"""
Back Table Torah - site builder.

Reads shiurim.json + config.json and writes the whole /backtable/ section of
TorahMoment.com as plain HTML: an archive page plus one page per shiur.

  python build_backtable.py                      # writes to the "output_dir" in config.json
  python build_backtable.py --out C:\\path\\to\\torahmoment\\backtable
  python build_backtable.py --local              # links end in index.html, so pages open from disk

Nothing here points at thebacktable.org; the build stops if it finds such a link.
Only needs Python 3.8+ (no extra packages).
"""
import argparse, collections, hashlib, html, json, os, re, shutil, sys

HERE = os.path.dirname(os.path.abspath(__file__))
E = lambda s: html.escape(str(s or ""), quote=True)


# ---------------------------------------------------------------- helpers
def load_config():
    """config.json (shared, in the repo) + config.local.json (this computer only: password, media folder)."""
    cfg = load("config.json")
    local = os.path.join(HERE, "config.local.json")
    if os.path.exists(local):
        with open(local, encoding="utf-8") as f:
            cfg.update(json.load(f))
    return cfg


def load(name):
    with open(os.path.join(HERE, name), encoding="utf-8") as f:
        return json.load(f)


def nice_date(d):
    y, m, dd = d.split("-")
    months = "January February March April May June July August September October November December".split()
    return f"{months[int(m) - 1]} {int(dd)}, {y}"


def short_date(d):
    y, m, dd = d.split("-")
    return f"{'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split()[int(m) - 1]} {int(dd)}, {y}"


def runtime(r):
    r = re.sub(r"^\s*App\w*\.?,?\s*", "", r or "").strip().rstrip(".").strip()
    return f"About {r}" if r else ""


def yt_id(v):
    m = re.search(r"(?:youtu\.be/|v=|embed/|shorts/|live/)([A-Za-z0-9_-]{11})", v)
    return m.group(1) if m else (v if re.fullmatch(r"[A-Za-z0-9_-]{11}", v or "") else None)


URL_RE = re.compile(r"(https?://[^\s<>\"]+)")


def linkify(text):
    out, last = [], 0
    for m in URL_RE.finditer(text):
        out.append(E(text[last:m.start()]))
        u = m.group(1).rstrip(".,)")
        shown = re.sub(r"^https?://(www\.)?", "", u)
        shown = shown if len(shown) <= 60 else shown[:57] + "…"
        out.append(f'<a href="{E(u)}" target="_blank" rel="noopener" title="{E(u)}">{E(shown)}</a>' + E(m.group(1)[len(u):]))
        last = m.end()
    out.append(E(text[last:]))
    return "".join(out)


def chat_rows(lines):
    rows = []
    for ln in lines:
        m = re.match(r"^(\d{1,2}:\d{2}:\d{2})\s+From\s+(.+?)\s*:\s?(.*)$", ln)
        if m:
            t, who, msg = m.groups()
            who = re.sub(r"\s+to\s+Everyone$", "", who.strip(), flags=re.I)
            rows.append(f'<li><span class="bt-chat-time">{E(t)}</span><span class="bt-chat-who">{E(who)}</span>'
                        f'<span class="bt-chat-msg" dir="auto">{linkify(msg)}</span></li>')
        else:
            rows.append(f'<li class="bt-chat-cont"><span class="bt-chat-msg" dir="auto">{linkify(ln)}</span></li>')
    return "\n".join(rows)


def pw_hashes(pw):
    sha = hashlib.sha256(pw.encode("utf-8")).hexdigest()
    h = 5381
    for ch in pw:
        h = ((h * 33) ^ ord(ch)) & 0xFFFFFFFF
    return sha, format(h, "x")


ICON = {
    "video": '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3"/></svg>',
    "audio": '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 14v-2a9 9 0 0 1 18 0v2"/><rect x="3" y="14" width="4" height="6" rx="1"/><rect x="17" y="14" width="4" height="6" rx="1"/></svg>',
    "pdf": '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/></svg>',
    "down": '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 4v12"/><path d="M6 11l6 6 6-6"/><path d="M4 20h16"/></svg>',
    "play": '<svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="7 4 20 12 7 20 7 4"/></svg>',
}


# ---------------------------------------------------------------- page shell
def page(cfg, title, body, depth, og=None, extra_head=""):
    up = "../" * depth
    sha, djb = pw_hashes(cfg["password"])
    ga = ""
    if cfg.get("ga_id"):
        g = E(cfg["ga_id"])
        ga = (f'<script async src="https://www.googletagmanager.com/gtag/js?id={g}"></script>\n'
              f"<script>window.dataLayer=window.dataLayer||[];function gtag(){{dataLayer.push(arguments);}}"
              f"gtag('js',new Date());gtag('config','{g}');</script>")
    ogm = ""
    if og:
        ogm = "\n".join(f'<meta property="og:{k}" content="{E(v)}">' for k, v in og.items() if v)
    return f"""<!doctype html>
<html lang="en" class="bt-locked">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>{E(title)}</title>
{ogm}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,500;8..60,600&family=Inter:wght@400;500;600&family=Frank+Ruhl+Libre:wght@500&display=swap">
<link rel="icon" href="/favicon-32x32.png" sizes="32x32">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="stylesheet" href="{up}assets/bt.css">
<script>window.BT_GATE={{sha:"{sha}",djb:"{djb}"}};</script>
<script src="{up}assets/bt.js" defer></script>
{ga}
{extra_head}
</head>
<body>
<div class="bt-page">
{body}
<footer class="bt-footer"><div class="bt-wrap bt-row">
<span>Back Table Torah · part of <a href="{E(cfg['torahmoment_url'])}">TorahMoment.com</a></span>
<span>Members only · please don't share links publicly</span>
</div></footer>
</div>
</body>
</html>
"""


def header(cfg, depth, crumb=None):
    up = "../" * depth
    home = up + ("index.html" if cfg["_local"] else "")
    wa = (f'<a class="bt-wa" href="{E(cfg["whatsapp_group_url"])}" target="_blank" rel="noopener">WhatsApp group</a>'
          if cfg.get("whatsapp_group_url") else "")
    if crumb:
        nav = (f'<nav aria-label="Breadcrumb" class="bt-crumbs"><a href="{E(cfg["torahmoment_url"])}">TorahMoment.com</a>'
               f'<span aria-hidden="true">›</span><a href="{home or "./"}" class="bt-strong">Back Table Torah</a>'
               f'<span aria-hidden="true">›</span><span>{E(crumb)}</span></nav>')
    else:
        nav = f'<a class="bt-back" href="{E(cfg["torahmoment_url"])}">← TorahMoment.com</a>'
    return f'<header class="bt-top"><div class="bt-wrap bt-row">{nav}{wa}</div></header>'


# ---------------------------------------------------------------- archive
def build_archive(cfg, S, extras=()):
    tags = collections.Counter(t for s in S for t in s["tags"])
    speakers = collections.Counter(s["speaker"] for s in S if s["speaker"])
    years = sorted({s["date"][:4] for s in S}, reverse=True)
    newest = S[0]
    link = lambda s: s["slug"] + ("/index.html" if cfg["_local"] else "/")

    chips = ['<button type="button" class="bt-chip is-on" data-tag="" aria-pressed="true">All</button>']
    for t, n in sorted(tags.items(), key=lambda x: -x[1]):
        chips.append(f'<button type="button" class="bt-chip" data-tag="{E(t)}" aria-pressed="false" dir="auto">{E(t)} <span>{n}</span></button>')
    sp_opts = "".join(f'<option value="{E(k)}">{E(k)} ({v})</option>' for k, v in speakers.most_common())
    yr_opts = "".join(f'<option value="{y}">{y}</option>' for y in years)

    mx = max(speakers.values())
    bars = "".join(
        f'<li><button type="button" class="bt-bar" data-speaker="{E(k)}"><span class="bt-bar-name">{E(k)}</span>'
        f'<span class="bt-bar-track"><span style="width:{v / mx * 100:.1f}%"></span></span><span class="bt-bar-n">{v}</span></button></li>'
        for k, v in speakers.most_common())

    rows = []
    for s in S:
        img = (f'<img src="images/{E(cfg["_has_images"].get(s["images"][0]))}" alt="" loading="lazy">' if s["images"] and cfg["_has_images"].get(s["images"][0])
               else f'<span class="bt-thumb-num">{s["num"] if s["num"] else "Mini"}</span>')
        label = f"Shiur {s['num']}" if s["num"] else "Mini-Episode 1"
        media = []
        if s["video_parts"] or s["youtube"]:
            media.append(f"<span>{ICON['video']}Video</span>")
        if s["audio"]:
            media.append(f"<span>{ICON['audio']}Audio</span>")
        if s["pdf"]:
            media.append(f"<span>{ICON['pdf']}Sheet</span>")
        tagh = "".join(f'<span class="bt-tag" dir="auto">{E(t)}</span>' for t in s["tags"])
        text = " ".join([label, s["title"], s["speaker"]] + s["tags"]).lower()
        rows.append(f"""<li class="bt-item" data-tags="{E('|'.join(s['tags']))}" data-speaker="{E(s['speaker'])}" data-year="{s['date'][:4]}" data-text="{E(text)}">
<a href="{link(s)}" class="bt-card">
<span class="bt-thumb">{img}</span>
<span class="bt-card-body">
<span class="bt-meta"><strong>{E(label)}</strong><span>{short_date(s['date'])}</span><span>{E(s['speaker'])}</span></span>
<span class="bt-card-title" dir="auto">{E(s['title'])}</span>
<span class="bt-tags">{tagh}</span>
</span>
<span class="bt-media">{''.join(media)}</span>
</a></li>""")

    extras_html = ""
    if extras:
        li = "".join(f'<li><a href="{link(x)}"><span class="bt-muted">{short_date(x["date"])}</span>'
                     f'<span class="bt-pn-title" dir="auto">{E(x["title"])}</span></a></li>' for x in extras)
        extras_html = (f'<section class="bt-extras" aria-labelledby="bt-ex-h"><h2 id="bt-ex-h">Also in the archive</h2>'
                       f'<p class="bt-muted">Recordings outside the numbered series, kept for the record.</p><ul>{li}</ul></section>')

    body = f"""{header(cfg, 0)}
<section class="bt-hero"><div class="bt-wrap">
<p class="bt-kicker">A Zoom chaburah · <span lang="he" dir="rtl">ליל ששי לחיים בזום</span></p>
<h1>Back Table Torah</h1>
<p class="bt-lede">{len([s for s in S if s['num']])} shiurim since {nice_date(S[-1]['date']).split(' ')[-1]} on history, halacha, hashkafa and the parsha. Each one has the recording and, where there is one, the source sheet.</p>
<a class="bt-btn-gold" href="{link(newest)}">{ICON['play'].replace('28', '16')} Latest: Shiur {newest['num']}</a>
</div></section>
<main class="bt-wrap bt-main">
<div class="bt-controls">
<div class="bt-field bt-grow"><label for="bt-q">Search</label><input id="bt-q" type="search" placeholder="Title, topic, speaker or number" autocomplete="off"></div>
<div class="bt-field"><label for="bt-sp">Speaker</label><select id="bt-sp"><option value="">All speakers</option>{sp_opts}</select></div>
<div class="bt-field"><label for="bt-yr">Year</label><select id="bt-yr"><option value="">All years</option>{yr_opts}</select></div>
</div>
<div class="bt-chips" role="group" aria-label="Topic">{''.join(chips)}</div>
<div class="bt-row bt-count-row"><p id="bt-count" class="bt-count" aria-live="polite"></p><button type="button" id="bt-reset" class="bt-link" hidden>Clear filters</button></div>
<ol class="bt-list" id="bt-list">
{''.join(rows)}
</ol>
<p id="bt-none" class="bt-none" hidden>No shiurim match. Try clearing a filter.</p>
{extras_html}
<section class="bt-speakers" aria-labelledby="bt-sp-h">
<h2 id="bt-sp-h">Shiurim by speaker</h2>
<ul>{bars}</ul>
</section>
</main>"""
    return page(cfg, "Back Table Torah", body, 0, og={"title": "Back Table Torah", "type": "website",
                                                       "url": cfg.get("site_url", "")})


# ---------------------------------------------------------------- shiur page
def build_shiur(cfg, s, prev, nxt):
    mb = cfg.get("media_base", "").rstrip("/")
    label = f"Shiur {s['num']}" if s["num"] else "Mini-Episode 1"
    sib = lambda o: "../" + o["slug"] + ("/index.html" if cfg["_local"] else "/")
    arch = "../" + ("index.html" if cfg["_local"] else "")

    meta = [f"<strong>{E(label)}</strong>", f"<span>{nice_date(s['date'])}</span>"]
    if s["speaker"]:
        meta.append(f'<span>Given by <a href="{arch}?speaker={E(s["speaker"])}">{E(s["speaker"])}</a></span>')
    if runtime(s["runtime"]):
        meta.append(f"<span>{E(runtime(s['runtime']))}</span>")
    tags = "".join(f'<a class="bt-tag bt-tag-link" dir="auto" href="{arch}?tag={E(t)}">{E(t)}</a>' for t in s["tags"])

    # video
    ids = [i for i in (yt_id(v) for v in s["youtube"]) if i]
    vids = []
    for n, i in enumerate(ids, 1):
        cap = f'<p class="bt-part">Part {n}</p>' if len(ids) > 1 else ""
        vids.append(f'{cap}<div class="bt-video"><iframe src="https://www.youtube.com/embed/{i}?rel=0" '
                    f'title="{E(label)} video{f" part {n}" if len(ids) > 1 else ""}" loading="lazy" '
                    f'allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" '
                    f'referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe></div>'
                    f'<p class="bt-yt-link"><a href="https://www.youtube.com/watch?v={i}" target="_blank" rel="noopener">Video not playing? Watch on YouTube</a></p>')
    if not ids and s["video_parts"]:
        vids.append(f'<div class="bt-video bt-pending">{ICON["play"]}<span>Video coming soon</span></div>')

    # audio
    aud = []
    for n, a in enumerate(s["audio"], 1):
        part = f"Part {n}" if len(s["audio"]) > 1 else "Listen to the audio"
        if mb:
            src = f"{mb}/audio/{a}"
            aud.append(f'<div class="bt-audio"><div class="bt-row"><span class="bt-audio-label">{ICON["audio"]}{part}</span>'
                       f'<a class="bt-btn-ghost" href="{E(src)}" download>{ICON["down"]}MP3</a></div>'
                       f'<audio controls preload="none" src="{E(src)}"></audio></div>')
        else:
            aud.append(f'<div class="bt-audio bt-pending-row">{ICON["audio"]}<span>{part}: audio coming soon</span></div>')

    # source sheets
    pdfs = ""
    if s["pdf"]:
        items = []
        for n, p in enumerate(s["pdf"], 1):
            name = "Source sheet" + (f" {n}" if len(s["pdf"]) > 1 else "")
            if mb:
                u = f"{mb}/pdf/{p}"
                items.append(f'<li><span>{ICON["pdf"]}{name}</span><span class="bt-row-tight">'
                             f'<a class="bt-btn-ghost" href="{E(u)}" target="_blank" rel="noopener">Open</a>'
                             f'<a class="bt-btn" href="{E(u)}" download>{ICON["down"]}Download</a></span></li>')
            else:
                items.append(f'<li><span>{ICON["pdf"]}{name}</span><span class="bt-muted">coming soon</span></li>')
        viewer = (f'<iframe class="bt-pdf" src="{E(mb)}/pdf/{E(s["pdf"][0])}#view=FitH" title="Source sheet" loading="lazy"></iframe>'
                  if mb else '<div class="bt-pdf bt-pending"><span>Source sheet preview appears here once uploaded</span></div>')
        pdfs = f'<section class="bt-card-box"><h2>Source sheet{"s" if len(s["pdf"]) > 1 else ""}</h2><ul class="bt-files">{"".join(items)}</ul>{viewer}</section>'

    note = f'<p class="bt-note">{E(s["note"])}</p>' if s.get("note") else ""

    links = ""
    if s["ext_links"]:
        li = "".join(f'<li><a href="{E(u)}" target="_blank" rel="noopener">{E(u)}</a></li>' for u in s["ext_links"])
        links = f'<section class="bt-card-box"><h2>Links</h2><ul class="bt-ext">{li}</ul></section>'

    chat = ""
    if s["zoom_chat"]:
        chat = (f'<details class="bt-chat"><summary>Zoom chat <span>({len(s["zoom_chat"])} messages)</span></summary>'
                f'<ol>{chat_rows(s["zoom_chat"])}</ol></details>')

    img = ""
    if s["images"] and cfg["_has_images"].get(s["images"][0]):
        img = f'<img class="bt-hero-img" src="../images/{E(cfg["_has_images"][s["images"][0]])}" alt="">'

    def pn(o, cls, word):
        if not o:
            return '<span class="bt-pn bt-pn-empty"></span>'
        lab = f"Shiur {o['num']}" if o["num"] else "Mini-episode"
        return f'<a class="bt-pn {cls}" href="{sib(o)}"><span class="bt-muted">{word} · {E(lab)}</span><span class="bt-pn-title" dir="auto">{E(o["title"])}</span></a>'

    share = ""
    page_url = (cfg.get("site_url", "").rstrip("/") + "/" + s["slug"] + "/") if cfg.get("site_url") else ""
    if page_url:
        import urllib.parse
        txt = urllib.parse.quote(f"Back Table Torah – {label}: {s['title']}\n{page_url}")
        share = (f'<div class="bt-share"><a class="bt-wa-btn" href="https://wa.me/?text={txt}" target="_blank" rel="noopener">Send on WhatsApp</a>'
                 f'<button type="button" class="bt-btn-ghost" data-copy="{E(page_url)}">Copy link</button></div>')

    body = f"""{header(cfg, 1, crumb=label)}
<main class="bt-wrap bt-main">
<div class="bt-title-row">
<div class="bt-title-text">
<p class="bt-meta">{''.join(meta)}</p>
<h1 dir="auto">{E(s['title'])}</h1>
<div class="bt-tags">{tags}</div>
{share}
</div>
{img}
</div>
{note}{''.join(vids)}
{''.join(aud)}
{pdfs}
{links}
{chat}
<nav class="bt-pns" aria-label="Previous and next shiur">{pn(prev, '', '← Older')}{pn(nxt, 'bt-pn-next', 'Newer →')}</nav>
</main>"""
    og = {"title": f"{label}: {s['title']}", "type": "article", "url": page_url,
          "image": (cfg.get("site_url", "").rstrip("/") + "/images/" + cfg["_has_images"][s["images"][0]]) if (img and cfg.get("site_url")) else ""}
    return page(cfg, f"{label}: {s['title']} · Back Table Torah", body, 1, og=og)


# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out")
    ap.add_argument("--local", action="store_true", help="links end in index.html (for opening from disk)")
    a = ap.parse_args()

    cfg = load_config()
    if not cfg.get("password") or cfg["password"] == "changeme":
        sys.exit("Set the members' password in config.local.json first (see README.txt).")
    S = load("shiurim.json")
    cfg["_local"] = a.local
    out = os.path.abspath(a.out or os.path.join(HERE, cfg.get("output_dir", "site/backtable")))
    S.sort(key=lambda s: (s["date"], s["num"] or 0), reverse=True)   # newest first

    # links to the old site inside chat logs -> the matching new page
    site = cfg.get("site_url", "").rstrip("/")
    old = {s["old_url"].rstrip("/").split("://")[-1]: s["slug"] for s in S if s.get("old_url")}
    by_num = {s["num"]: s["slug"] for s in S if s["num"]}

    def fix(m):
        u = m.group(0).rstrip(".,)")
        key = u.rstrip("/").split("://")[-1]
        slug = old.get(key)
        if not slug:
            n = re.search(r"/uploads/\d{4}/\d{2}/(\d+)[-_.]", u)
            slug = by_num.get(int(n.group(1))) if n else None
        return f"{site}/{slug}/" if slug else f"{site}/"
    for s in S:
        s["zoom_chat"] = [re.sub(r"https?://(?:www\.)?thebacktable\.org[^\s<>\"]*", fix, ln) for ln in s["zoom_chat"]]
        s["ext_links"] = [re.sub(r"https?://(?:www\.)?thebacktable\.org[^\s<>\"]*", fix, u) for u in s["ext_links"]]

    # images: only the first picture of each shiur is shown. With Pillow installed
    # (pip install pillow) each one is shrunk to a web-size JPG; otherwise copied as-is.
    img_src = os.path.join(HERE, cfg.get("media_folder", "BackTable"), "images")
    os.makedirs(os.path.join(out, "images"), exist_ok=True)
    try:
        from PIL import Image
    except ImportError:
        Image = None
    cfg["_has_images"] = {}
    for s in S:
        if not s["images"]:
            continue
        im = s["images"][0]
        src = os.path.join(img_src, im)
        web = (s["file_key"] + ".jpg") if Image else im
        dst = os.path.join(out, "images", web)
        if os.path.exists(src):
            if not os.path.exists(dst) or os.path.getmtime(src) > os.path.getmtime(dst):
                if Image:
                    with Image.open(src) as pic:
                        pic = pic.convert("RGB")
                        pic.thumbnail((960, 960))
                        pic.save(dst, "JPEG", quality=80, optimize=True, progressive=True)
                else:
                    shutil.copy2(src, dst)
            cfg["_has_images"][im] = web
        elif os.path.exists(dst):
            cfg["_has_images"][im] = web

    os.makedirs(os.path.join(out, "assets"), exist_ok=True)
    for f in ("bt.css", "bt.js"):
        shutil.copy2(os.path.join(HERE, "assets", f), os.path.join(out, "assets", f))

    numbered = [s for s in S if s["num"]]
    extras = [s for s in S if not s["num"]]
    pages = {"index.html": build_archive(cfg, numbered, extras)}
    for i, s in enumerate(numbered):
        older = numbered[i + 1] if i + 1 < len(numbered) else None
        newer = numbered[i - 1] if i > 0 else None
        pages[os.path.join(s["slug"], "index.html")] = build_shiur(cfg, s, older, newer)
    for s in extras:
        pages[os.path.join(s["slug"], "index.html")] = build_shiur(cfg, s, None, None)

    bad = [p for p, h in pages.items() if "thebacktable.org" in h]
    if bad:
        sys.exit(f"Stopped: these pages still link to thebacktable.org: {bad[:5]}")

    for p, h in pages.items():
        path = os.path.join(out, p)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(h)

    missing_yt = sum(1 for s in S if s["video_parts"] and not s["youtube"])
    print(f"Built {len(pages)} pages in {out}")
    print(f"  images found: {len(cfg['_has_images'])}   videos still without a YouTube link: {missing_yt}"
          f"   media_base: {cfg.get('media_base') or '(not set yet - audio/PDFs show as coming soon)'}")


if __name__ == "__main__":
    main()
