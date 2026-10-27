/* Back Table Torah - password screen, archive filters, copy link.
   The password screen keeps casual visitors out; it is not real security. */
(function () {
  var KEY = 'bt-ok';
  var G = window.BT_GATE || {};
  var root = document.documentElement;

  function djb(s) { var h = 5381; for (var i = 0; i < s.length; i++) { h = (Math.imul(h, 33) ^ s.charCodeAt(i)) >>> 0; } return h.toString(16); }
  function sha(s) {
    if (!(window.crypto && crypto.subtle && window.TextEncoder)) return Promise.resolve(null);
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)).then(function (b) {
      return Array.prototype.map.call(new Uint8Array(b), function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
    });
  }
  function saved() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function unlock() { root.classList.remove('bt-locked'); var g = document.getElementById('bt-gate'); if (g) g.remove(); start(); }

  if (saved() === G.sha) { unlock(); } else {
    var showGate = function () {
      var d = document.createElement('div');
      d.className = 'bt-gate'; d.id = 'bt-gate';
      d.innerHTML = '<form><h1>Back Table Torah</h1><p>This archive is for members of the chaburah.</p>' +
        '<label for="bt-pw">Password</label><input id="bt-pw" type="password" autocomplete="current-password" required>' +
        '<p class="bt-err" id="bt-err" hidden>That password didn’t match. Try again.</p>' +
        '<button type="submit" class="bt-btn" style="justify-content:center">Enter</button></form>';
      document.body.insertBefore(d, document.body.firstChild);
      var f = d.querySelector('form'), inp = d.querySelector('input'), err = d.querySelector('#bt-err');
      inp.focus();
      f.addEventListener('submit', function (e) {
        e.preventDefault();
        var v = inp.value;
        sha(v).then(function (h) {
          var ok = h ? h === G.sha : djb(v) === G.djb;
          if (ok) { try { localStorage.setItem(KEY, G.sha); } catch (x) {} unlock(); }
          else { err.hidden = false; inp.select(); }
        });
      });
    };
    if (document.body) showGate(); else document.addEventListener('DOMContentLoaded', showGate);
  }

  var started = false;
  function start() {
    if (started) return; started = true;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire); else wire();
  }

  function wire() {
    document.querySelectorAll('[data-copy]').forEach(function (b) {
      b.addEventListener('click', function () {
        var t = b.getAttribute('data-copy');
        (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () {
          var o = b.textContent; b.textContent = 'Copied'; setTimeout(function () { b.textContent = o; }, 1500);
        }, function () { window.prompt('Copy this link:', t); });
      });
    });

    var list = document.getElementById('bt-list');
    if (!list) return;
    var items = Array.prototype.slice.call(list.children);
    var q = document.getElementById('bt-q'), sp = document.getElementById('bt-sp'), yr = document.getElementById('bt-yr');
    var chips = Array.prototype.slice.call(document.querySelectorAll('.bt-chip'));
    var count = document.getElementById('bt-count'), none = document.getElementById('bt-none'), reset = document.getElementById('bt-reset');
    var tag = '';

    function setTag(t) {
      tag = t;
      chips.forEach(function (c) { var on = c.getAttribute('data-tag') === t; c.classList.toggle('is-on', on); c.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    }
    function apply() {
      var words = q.value.toLowerCase().trim().split(/\s+/).filter(Boolean), s = sp.value, y = yr.value, n = 0;
      items.forEach(function (li) {
        var text = li.getAttribute('data-text');
        var ok = (!s || li.getAttribute('data-speaker') === s) && (!y || li.getAttribute('data-year') === y) &&
          (!tag || ('|' + li.getAttribute('data-tags') + '|').indexOf('|' + tag + '|') !== -1) &&
          words.every(function (w) { return text.indexOf(w) !== -1; });
        li.hidden = !ok; if (ok) n++;
      });
      count.textContent = (n === items.length ? 'Showing all ' + n + ' shiurim, newest first' : 'Showing ' + n + ' of ' + items.length + ' shiurim');
      none.hidden = n !== 0;
      reset.hidden = !(words.length || s || y || tag);
      var p = new URLSearchParams();
      if (s) p.set('speaker', s); if (tag) p.set('tag', tag); if (y) p.set('year', y);
      var qs = p.toString();
      try { history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '')); } catch (e) {}
    }

    var params = new URLSearchParams(location.search);
    if (params.get('speaker')) sp.value = params.get('speaker');
    if (params.get('year')) yr.value = params.get('year');
    setTag(params.get('tag') || '');

    q.addEventListener('input', apply); sp.addEventListener('change', apply); yr.addEventListener('change', apply);
    chips.forEach(function (c) { c.addEventListener('click', function () { setTag(c.getAttribute('data-tag')); apply(); }); });
    document.querySelectorAll('.bt-bar').forEach(function (b) {
      b.addEventListener('click', function () { sp.value = b.getAttribute('data-speaker'); apply(); list.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    });
    reset.addEventListener('click', function () { q.value = ''; sp.value = ''; yr.value = ''; setTag(''); apply(); });
    apply();
  }
})();
