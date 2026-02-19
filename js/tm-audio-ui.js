// js/tm-audio-ui.js
(function(){
  const SPEEDS = [1, 1.25, 1.5, 2];

  function fmtTime(sec){
    if (!Number.isFinite(sec) || sec < 0) return "";
    sec = Math.floor(sec);
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const mm = String(m).padStart(h ? 2 : 1, "0");
    const ss = String(s).padStart(2, "0");
    return h ? `${h}:${String(m).padStart(2,"0")}:${ss}` : `${mm}:${ss}`;
  }

  function getSavedRate(){
    const v = Number(localStorage.getItem("tm_rate") || "1");
    return SPEEDS.includes(v) ? v : 1;
  }
  function setSavedRate(v){
    localStorage.setItem("tm_rate", String(v));
  }

  function pauseAllExcept(audioEl){
    document.querySelectorAll("audio[data-tm-audio='1']").forEach(a => {
      if (a !== audioEl && !a.paused) a.pause();
    });
  }

  function cycleRate(current){
    const i = SPEEDS.indexOf(current);
    return SPEEDS[(i + 1) % SPEEDS.length];
  }

  // Public: build a halacha-style row
  window.tmBuildAudioRow = function({
    title,
    note,        // e.g. date or parsha
    url,
    badgeText,   // "Short" / "Long" or ""
    badgeClass,  // "tm-short" / "tm-long" optional
    durationText // optional initial duration like "5:46" (can be blank; will auto-fill from metadata)
  }){
    const wrap = document.createElement("div");
    wrap.className = "item";

    const row = document.createElement("div");
    row.className = "tm-row";

    const play = document.createElement("button");
    play.className = "tm-play";
    play.type = "button";
    play.textContent = "▶";

    const main = document.createElement("div");
    main.className = "tm-main";

    const titleRow = document.createElement("div");
    titleRow.className = "tm-title-row";

    const t = document.createElement("div");
    t.className = "tm-title";
    t.textContent = title || "Untitled";
    t.title = t.textContent;

    const n = document.createElement("div");
    n.className = "tm-note";
    n.textContent = note || "";

    titleRow.appendChild(t);
    titleRow.appendChild(n);

    const player = document.createElement("div");
    player.className = "tm-player";

    const audio = document.createElement("audio");
    audio.setAttribute("data-tm-audio", "1");
    audio.preload = "metadata";
    audio.src = url;

    // "seek" bar = input range
    const seek = document.createElement("input");
    seek.className = "tm-seek";
    seek.type = "range";
    seek.min = "0";
    seek.max = "1000";
    seek.value = "0";

    const right = document.createElement("div");
    right.className = "tm-right";

    const speed = document.createElement("button");
    speed.className = "tm-speed";
    speed.type = "button";

    let rate = getSavedRate();
    speed.textContent = `${rate}×`;

    const badge = document.createElement("div");
    badge.className = "tm-badge tm-len";
    if (badgeClass) badge.classList.add(badgeClass);
    badge.textContent = badgeText || "";
    if (!badgeText) badge.style.display = "none";

    const dur = document.createElement("div");
    dur.className = "tm-dur";
    dur.textContent = durationText || "";

    right.appendChild(speed);
    right.appendChild(badge);
    right.appendChild(dur);

    player.appendChild(play);
    player.appendChild(seek);
    player.appendChild(right);

    // Optional progress line (like your CSS)
    const prog = document.createElement("div");
    prog.className = "tm-progress";
    const progInner = document.createElement("div");
    prog.appendChild(progInner);

    main.appendChild(titleRow);
    main.appendChild(player);
    main.appendChild(prog);

    row.appendChild(main);
    wrap.appendChild(row);
    wrap.appendChild(audio);

    // --- wiring ---
    audio.playbackRate = rate;

    function setPlayIcon(){
      play.textContent = audio.paused ? "▶" : "❚❚";
    }

    function updateSeek(){
      if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
      const p = audio.currentTime / audio.duration;
      seek.value = String(Math.round(p * 1000));
      progInner.style.width = `${Math.round(p * 100)}%`;
    }

    play.addEventListener("click", (e) => {
      e.stopPropagation();
      if (audio.paused){
        pauseAllExcept(audio);
        audio.play().catch(()=>{});
      } else {
        audio.pause();
      }
    });

    speed.addEventListener("click", (e) => {
      e.stopPropagation();
      rate = cycleRate(rate);
      audio.playbackRate = rate;
      speed.textContent = `${rate}×`;
      setSavedRate(rate);
    });

    seek.addEventListener("input", (e) => {
      e.stopPropagation();
      if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
      const p = Number(seek.value) / 1000;
      audio.currentTime = p * audio.duration;
      updateSeek();
    });

    // Clicking anywhere on the row toggles play (matches your “tap row” UX)
    row.addEventListener("click", () => {
      if (audio.paused){
        pauseAllExcept(audio);
        audio.play().catch(()=>{});
      } else {
        audio.pause();
      }
    });

    audio.addEventListener("play", () => { pauseAllExcept(audio); setPlayIcon(); });
    audio.addEventListener("pause", setPlayIcon);
    audio.addEventListener("timeupdate", updateSeek);

    audio.addEventListener("loadedmetadata", () => {
      // Auto-fill duration text if not already set
      if (!dur.textContent) dur.textContent = `(${fmtTime(audio.duration)})`;
      updateSeek();

      // Auto-apply Short/Long badge if you want it everywhere:
      // (only if badgeText wasn't provided)
      if (!badgeText && Number.isFinite(audio.duration)){
        const isLong = audio.duration >= 10 * 60;
        badge.style.display = "";
        badge.textContent = isLong ? "Long" : "Short";
        badge.classList.toggle("tm-long", isLong);
        badge.classList.toggle("tm-short", !isLong);
      }
    });

    // Mobile: tap-to-expand title (you already have .expanded CSS)
    t.addEventListener("click", (e) => {
      if (window.matchMedia("(max-width: 767px)").matches){
        e.stopPropagation();
        t.classList.toggle("expanded");
      }
    });

    return wrap;
  };

  window.tmPauseAllExcept = pauseAllExcept;
})();
