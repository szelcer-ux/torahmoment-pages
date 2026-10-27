#!/usr/bin/env python3
"""
Back Table Torah - publish.

Double-click publish.bat. It:
  1. gets the latest from GitHub (so every computer starts from the same list)
  2. rebuilds the /backtable/ pages
  3. uploads any new audio / source sheets to Backblaze (if rclone is set up here)
  4. saves the change to GitHub, which puts it live on torahmoment.com

  python publish.py --sync     # only step 1 (new_shiur.bat runs this first)
  python publish.py --no-push  # build and upload, but don't publish
"""
import json, os, shutil, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)


def run(cmd, check=True, quiet=False, cwd=REPO):
    r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if not quiet and (r.stdout.strip() or r.stderr.strip()):
        print("   " + (r.stdout + r.stderr).strip().replace("\n", "\n   "))
    if check and r.returncode != 0:
        sys.exit(f"\nStopped: {' '.join(cmd[:3])} failed. Nothing was published. Send Claude the message above.")
    return r


def need_git():
    if not shutil.which("git"):
        sys.exit("Git isn't installed on this computer. Run:  winget install Git.Git  then try again.")
    if run(["git", "rev-parse", "--is-inside-work-tree"], check=False, quiet=True).returncode != 0:
        sys.exit("This kit isn't inside the torahmoment-pages folder from GitHub. See README.txt (setting up a computer).")


def sync():
    print("1. Getting the latest from GitHub...")
    run(["git", "pull", "--rebase", "--autostash", "origin", "main"])


def config():
    cfg = json.load(open(os.path.join(HERE, "config.json"), encoding="utf-8"))
    local = os.path.join(HERE, "config.local.json")
    if os.path.exists(local):
        cfg.update(json.load(open(local, encoding="utf-8")))
    return cfg


def upload(cfg):
    media = os.path.join(HERE, cfg.get("media_folder", "BackTable"))
    remote = cfg.get("rclone_remote", "b2:backtable-audio")
    if not shutil.which("rclone"):
        print("3. Skipping Backblaze upload (rclone isn't set up on this computer).")
        return
    print("3. Uploading new audio and source sheets to Backblaze...")
    for sub in ("audio", "pdf"):
        folder = os.path.join(media, sub)
        if os.path.isdir(folder):
            run(["rclone", "copy", folder, f"{remote}/{sub}", "--ignore-existing"], cwd=HERE)


def main():
    args = sys.argv[1:]
    need_git()
    sync()
    if "--sync" in args:
        return
    cfg = config()

    print("2. Building the pages...")
    r = subprocess.run([sys.executable, os.path.join(HERE, "build_backtable.py"),
                        "--out", os.path.join(REPO, "backtable")], cwd=HERE)
    if r.returncode != 0:
        sys.exit("\nStopped: the build failed. Nothing was published.")

    upload(cfg)
    if "--no-push" in args:
        print("\nBuilt (not published).")
        return

    print("4. Publishing to torahmoment.com...")
    kit = os.path.relpath(HERE, REPO)
    run(["git", "add", "backtable", os.path.join(kit, "shiurim.json")], quiet=True)
    if run(["git", "diff", "--cached", "--quiet"], check=False, quiet=True).returncode == 0:
        print("   Nothing changed - the site is already up to date.")
        return
    nums = []
    try:
        d = run(["git", "diff", "--cached", "--name-only"], quiet=True).stdout.split()
        nums = sorted({p.split("/")[1] for p in d if p.startswith("backtable/shiur-")})
    except Exception:
        pass
    msg = "Back Table: update " + (", ".join(nums[:6]) + (" ..." if len(nums) > 6 else "") if nums else "archive")
    run(["git", "commit", "-q", "-m", msg])
    if run(["git", "push", "origin", "HEAD:main"], check=False).returncode != 0:
        run(["git", "pull", "--rebase", "origin", "main"])
        run(["git", "push", "origin", "HEAD:main"])
    print("\nPublished. The site updates in a minute or two: https://torahmoment.com/backtable/")


if __name__ == "__main__":
    main()
