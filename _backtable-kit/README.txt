BACK TABLE TORAH - SITE KIT
===========================

This folder lives inside the torahmoment-pages repo, so every computer works from
the same list of shiurim. The website pages it builds go in the repo's backtable\ folder.
(The folder name starts with "_" so it is never published on the website itself.)

WHAT'S HERE
  shiurim.json        The master list of every shiur. Synced through GitHub.
  config.json         Shared settings (Backblaze address, Analytics). Synced.
  config.local.json   THIS computer only: members' password and where the media folder is.
                      Never uploaded to GitHub.

  new_shiur.bat       Drag a Zoom recording folder onto it to add a shiur.
  set_youtube.bat     Add one YouTube link to a shiur.
  import_youtube.bat  Add a whole batch of YouTube links from the playlist (see below).
  publish.bat         Get the latest, rebuild, upload audio/PDFs, and put it live.
  preview.bat         Build a copy on this computer and open it, without publishing.
  announce.bat        Make the WhatsApp message for any shiur (copied, ready to paste).


ADDING A NEW SHIUR
  1. Drag the Zoom recording folder onto new_shiur.bat and answer the questions.
     (Pick the speaker and topics by NUMBER so names stay consistent.)
  2. Upload the video from the media folder's youtube\ subfolder to the Back Table
     channel: Unlisted, add to the playlist. Paste the link when asked, or later
     with set_youtube.bat.
  3. Double-click publish.bat. Done - it uploads the audio/PDF and updates the site.
  4. publish.bat ends with a WhatsApp message for the new shiur, already copied.
     Paste it into the group once the page is live (a minute or two).


ADDING YOUTUBE LINKS IN BULK (for the archive uploads)
  1. Open the playlist in Chrome, press F12 -> Console, paste this line, press Enter:
     copy([...document.querySelectorAll('ytd-playlist-video-renderer a#video-title')].map(a=>a.title+'\t'+new URL(a.href).searchParams.get('v')).join('\n'))
  2. Paste into a new file youtube_list.txt in this folder and save.
  3. Double-click import_youtube.bat, then publish.bat.


SETTING UP A COMPUTER (once per computer, about 15 minutes)
  1. In Command Prompt:
       winget install Python.Python.3.12
       winget install Git.Git
       winget install Gyan.FFmpeg
       winget install Rclone.Rclone
     Close Command Prompt and open a new one.
  2. Download the repo (pick a folder, e.g. your Documents):
       cd %USERPROFILE%\Documents
       git clone https://github.com/szelcer-ux/torahmoment-pages
     The first time you publish, a browser window asks you to sign in to GitHub.
  3. pip install pillow          (shrinks thumbnails)
  4. Copy config.local.example.json to config.local.json and fill in:
       "password"     - the members' password (must be the SAME on every computer)
       "media_folder" - where new recordings and audio files are kept on this computer
  5. Connect rclone to Backblaze (make a key under Backblaze > Application Keys):
       rclone config create b2 b2 account=KEYID key=APPKEY
     If Windows says 'rclone' is not recognized, put rclone.exe in this folder, or add
     its location to config.local.json, e.g.  "rclone": "C:\\Tools\\rclone.exe"


NOTES
  - Pages are hidden from Google and sit behind a simple password screen. That keeps
    casual visitors out; it is not real security - like unlisted YouTube.
  - Audio and PDFs live on Backblaze; videos on YouTube; thumbnails in the repo.
    The big download folder (BackTable\) is only a backup and isn't needed elsewhere.
  - publish.bat always gets the latest first, so switching computers is safe.
