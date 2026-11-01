/* AI가 요약해줘도 나는 손으로 읽는다 — 마크다운 뷰어
 *
 * 차례는 viewer/toc.json 한 곳에서 관리한다. 원고 경로가 바뀌면 이 파일을
 * 고치고, 사이드바와 이전/다음 이동은 전부 이 데이터를 그대로 따른다. */

(function () {
  'use strict';

  var BASE = location.pathname.replace(/[^/]*$/, '');
  var REPO = 'https://github.com/leaf-kit/book-read-by-hand';

  var LS = {
    theme: 'aibook.theme',
    fs: 'aibook.fs',
    checks: 'aibook.checks',
    last: 'aibook.last',
    stars: 'aibook.stars'
  };

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var el = {
    toc: $('#toc'), doc: $('#doc'), main: $('#main'),
    sidebar: $('#sidebar'), pager: $('#pager'),
    prev: $('#pg-prev'), next: $('#pg-next'), bar: $('#progressbar'),
    q: $('#q'), qclear: $('#q-clear'), qhint: $('#q-hint'), fulltext: $('#fulltext'),
    menu: $('#menu'), scrim: $('#scrim'), totop: $('#totop')
  };

  var state = {
    toc: null,
    flat: [],
    byPath: {},
    path: '',
    cache: {},
    scrollAt: {},
    corpus: null
  };

  /* ───────── 저장값 ───────── */

  function store(k, v) {
    try {
      if (v === undefined) {
        var s = localStorage.getItem(k);
        return s === null ? null : JSON.parse(s);
      }
      localStorage.setItem(k, JSON.stringify(v));
    } catch (e) { return null; }
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ───────── 가져오기 ───────── */

  function fetchText(path) {
    if (state.cache[path]) return Promise.resolve(state.cache[path]);
    return fetch(BASE + path, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error(r.status + ' ' + r.statusText);
      return r.text();
    }).then(function (t) { state.cache[path] = t; return t; });
  }

  /* ───────── 차례 ───────── */

  function buildIndex(toc) {
    state.toc = toc;
    state.flat = [{ num: '', title: '소개', path: toc.home }];
    toc.parts.forEach(function (p) {
      p.items.forEach(function (x) { state.flat.push(x); });
    });
    state.byPath = {};
    state.flat.forEach(function (x, i) { x.i = i; state.byPath[x.path] = x; });
  }

  function renderToc() {
    var html = '<div class="part" data-open="1"><ul><li><a href="#/' +
      encodeURI(state.toc.home) + '" data-path="' + esc(state.toc.home) + '">' +
      '<span class="num"></span><span class="t">소개</span></a></li></ul></div>';

    state.toc.parts.forEach(function (p, pi) {
      html += '<div class="part" data-open="1" data-part="' + pi + '">';
      html += '<button class="part-h" type="button" aria-expanded="true">' +
        '<svg class="caret" viewBox="0 0 20 20" aria-hidden="true"><path d="M6 8l4 4 4-4"/></svg>' +
        '<span>' + esc(p.title) + '</span></button><ul>';
      p.items.forEach(function (x) {
        html += '<li><a href="#/' + encodeURI(x.path) + '" data-path="' + esc(x.path) + '" title="' + esc(x.title) + '">' +
          '<span class="num">' + esc(x.num) + '</span><span class="t">' + esc(x.short || x.title) + '</span></a></li>';
      });
      html += '</ul></div>';
    });

    el.toc.innerHTML = html;

    $$('.part-h', el.toc).forEach(function (b) {
      b.addEventListener('click', function () {
        var part = b.parentNode;
        var open = part.getAttribute('data-open') === '1' ? '0' : '1';
        part.setAttribute('data-open', open);
        b.setAttribute('aria-expanded', open === '1');
      });
    });
  }

  function syncToc() {
    $$('#toc a').forEach(function (a) {
      var on = a.getAttribute('data-path') === state.path;
      a.classList.toggle('active', on);
      if (on) {
        var part = a.closest('.part');
        if (part && part.getAttribute('data-open') === '0') part.setAttribute('data-open', '1');
      }
    });
  }

  /* ───────── 경로/라우팅 ───────── */

  function route() {
    var raw = location.hash.replace(/^#/, '');
    if (raw.charAt(0) === '?') return { search: decodeURIComponent(raw.slice(1).replace(/^q=/, '')) };
    if (!raw || raw === '/') return { path: state.toc.home, anchor: '' };
    var s = raw.charAt(0) === '/' ? raw.slice(1) : raw;
    var i = s.indexOf('#');
    var p = i < 0 ? s : s.slice(0, i);
    var a = i < 0 ? '' : s.slice(i + 1);
    try { p = decodeURIComponent(p); } catch (e) {}
    try { a = decodeURIComponent(a); } catch (e) {}
    return { path: p || state.toc.home, anchor: a };
  }

  function go(path, anchor) {
    location.hash = '#/' + encodeURI(path) + (anchor ? '#' + encodeURIComponent(anchor) : '');
  }

  function slugify(text) {
    return String(text).trim().toLowerCase()
      .replace(/[`*_~]/g, '')
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .replace(/\s/g, '-');
  }

  /* ───────── 체크박스 ───────── */

  function checksFor(path) { return (store(LS.checks) || {})[path] || {}; }

  function setCheck(path, idx, checked) {
    var all = store(LS.checks) || {};
    all[path] = all[path] || {};
    if (checked) all[path][idx] = 1; else delete all[path][idx];
    store(LS.checks, all);
  }

  function wireChecklists(root, path) {
    var boxes = $$('input[type="checkbox"]', root);
    var saved = checksFor(path);
    boxes.forEach(function (b, idx) {
      b.disabled = false;
      if (saved[idx]) b.checked = true;
      b.addEventListener('change', function () { setCheck(path, idx, b.checked); });
    });
  }

  /* ───────── 본문 그리기 ───────── */

  var renderSeq = 0;

  function open(path, anchor) {
    var mine = ++renderSeq;
    if (path === state.path) { scrollTo(anchor); return; }
    if (state.path) state.scrollAt[state.path] = el.main.scrollTop;

    state.path = path;
    syncToc();
    closeNav();
    el.doc.innerHTML = '<p class="loading">여는 중…</p>';
    el.pager.hidden = true;

    fetchText(path).then(function (md) {
      if (mine !== renderSeq) return;
      el.doc.innerHTML = renderMd(md);
      enhance(el.doc, path);
      wireChecklists(el.doc, path);
      renderPager();
      document.title = titleOf(path) + ' — AI가 요약해줘도 나는 손으로 읽는다';
      store(LS.last, path);

      var y = anchor ? null : state.scrollAt[path];
      el.main.scrollTop = 0;
      if (anchor) scrollTo(anchor, true);
      else if (y) el.main.scrollTop = y;
      updateProgress();
    }).catch(function (e) {
      if (mine !== renderSeq) return;
      el.doc.innerHTML =
        '<div class="err"><h2>이 문서를 열지 못했다</h2>' +
        '<p><code>' + esc(path) + '</code> 를 읽는 데 실패했다. (' + esc(e.message) + ')</p>' +
        '<p><code>file://</code>로 직접 열면 가져오기가 막힌다. 저장소 안에서 ' +
        '<code>python3 -m http.server 8000</code> 을 돌리고 ' +
        '<code>http://localhost:8000/</code> 로 들어간다.</p></div>';
    });
  }

  function renderMd(md) {
    if (window.marked && marked.parse) {
      try { return marked.parse(md); } catch (e) { /* fall through */ }
    }
    return '<pre>' + esc(md) + '</pre>';
  }

  function titleOf(path) {
    var x = state.byPath[path];
    return x ? ((x.num ? x.num + ' ' : '') + x.title) : path;
  }

  function scrollTo(anchor, instant) {
    if (!anchor) return;
    var t = document.getElementById(anchor);
    if (!t) return;
    var top = t.getBoundingClientRect().top - el.main.getBoundingClientRect().top + el.main.scrollTop - 14;
    if (instant) el.main.scrollTop = top;
    else el.main.scrollTo({ top: top, behavior: 'smooth' });
  }

  function resolvePath(from, href) {
    var dir = from.indexOf('/') >= 0 ? from.slice(0, from.lastIndexOf('/') + 1) : '';
    var u;
    try { u = new URL(dir + href, 'http://local/'); } catch (e) { return null; }
    return { path: decodeURIComponent(u.pathname.replace(/^\//, '')), anchor: u.hash ? decodeURIComponent(u.hash.slice(1)) : '' };
  }

  function enhance(root, path) {
    var used = {};
    $$('h1, h2, h3, h4', root).forEach(function (h) {
      var base = slugify(h.textContent) || 'h';
      var id = base;
      if (used[base]) id = base + '-' + used[base];
      used[base] = (used[base] || 0) + 1;
      h.id = id;
    });

    $$('a[href]', root).forEach(function (a) {
      var href = a.getAttribute('href');
      if (!href) return;
      if (/^(https?:|mailto:)/i.test(href)) { a.target = '_blank'; a.rel = 'noopener noreferrer'; return; }
      if (href.charAt(0) === '#') {
        var frag = href.slice(1);
        try { frag = decodeURIComponent(frag); } catch (e) {}
        a.setAttribute('href', '#/' + encodeURI(path) + '#' + encodeURIComponent(frag));
        return;
      }
      var r = resolvePath(path, href);
      if (!r) return;
      if (/\.md$/i.test(r.path)) {
        a.setAttribute('href', '#/' + encodeURI(r.path) + (r.anchor ? '#' + encodeURIComponent(r.anchor) : ''));
      } else {
        a.target = '_blank'; a.rel = 'noopener noreferrer';
      }
    });

    $$('img[src]', root).forEach(function (img) {
      var src = img.getAttribute('src');
      if (/^(https?:|data:)/i.test(src)) return;
      var r = resolvePath(path, src);
      if (r) img.setAttribute('src', BASE + r.path);
      img.loading = 'lazy';
    });

    $$('table', root).forEach(function (t) {
      if (t.parentNode.classList.contains('table-wrap')) return;
      var w = document.createElement('div');
      w.className = 'table-wrap';
      t.parentNode.insertBefore(w, t);
      w.appendChild(t);
    });
  }

  /* ───────── 이전/다음 ───────── */

  function renderPager() {
    var x = state.byPath[state.path];
    if (!x) { el.pager.hidden = true; return; }
    var p = state.flat[x.i - 1], n = state.flat[x.i + 1];
    el.pager.hidden = false;
    if (p) { el.prev.hidden = false; el.prev.href = '#/' + encodeURI(p.path); $('.t', el.prev).textContent = (p.num ? p.num + ' ' : '') + p.title; }
    else el.prev.hidden = true;
    if (n) { el.next.hidden = false; el.next.href = '#/' + encodeURI(n.path); $('.t', el.next).textContent = (n.num ? n.num + ' ' : '') + n.title; }
    else el.next.hidden = true;
  }

  function step(d) {
    var x = state.byPath[state.path];
    if (!x) return;
    var t = state.flat[x.i + d];
    if (t) go(t.path, '');
  }

  /* ───────── 진행률 ───────── */

  function updateProgress() {
    var max = el.main.scrollHeight - el.main.clientHeight;
    var r = max > 0 ? el.main.scrollTop / max : 1;
    el.bar.style.width = (r * 100).toFixed(1) + '%';
    el.totop.hidden = el.main.scrollTop < 400;
  }

  /* ───────── 차례 거르기 ───────── */

  function filterToc(q) {
    var needle = q.trim().toLowerCase();
    el.qclear.hidden = !needle;
    el.fulltext.hidden = needle.length < 2;
    if (needle.length >= 2) $('span', el.fulltext).textContent = q.trim();

    if (!needle) {
      $$('#toc .part', el.toc).forEach(function (p) { p.classList.remove('hidden'); });
      $$('#toc li', el.toc).forEach(function (li) {
        li.classList.remove('hidden');
        var t = $('.t', li);
        if (t) t.innerHTML = esc(t.textContent);
      });
      el.qhint.hidden = true;
      return;
    }

    var hits = 0;
    $$('#toc .part', el.toc).forEach(function (p) {
      var any = false;
      $$('li', p).forEach(function (li) {
        var a = $('a', li), t = $('.t', a), num = $('.num', a).textContent;
        var text = t.textContent;
        var i = text.toLowerCase().indexOf(needle);
        if (i >= 0 || num.toLowerCase().indexOf(needle) >= 0) {
          any = true; hits++;
          li.classList.remove('hidden');
          t.innerHTML = i >= 0
            ? esc(text.slice(0, i)) + '<mark>' + esc(text.slice(i, i + needle.length)) + '</mark>' + esc(text.slice(i + needle.length))
            : esc(text);
        } else li.classList.add('hidden');
      });
      p.classList.toggle('hidden', !any);
      if (any) p.setAttribute('data-open', '1');
    });

    el.qhint.hidden = false;
    el.qhint.textContent = hits ? '제목에서 ' + hits + '개를 찾았다.' : '제목에는 없다. 본문까지 찾아본다.';
  }

  /* ───────── 본문 전체 검색 ───────── */

  function stripMd(s) {
    return s
      .replace(/^#{1,6}\s+/, '')
      .replace(/^\s*[-+*]\s+/, '')
      .replace(/^\s*>\s?/, '')
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[*_`]/g, '')
      .trim();
  }

  function loadCorpus(onProgress) {
    if (state.corpus) return Promise.resolve(state.corpus);
    var paths = state.flat.map(function (x) { return x.path; });
    var done = 0;
    return Promise.all(paths.map(function (p) {
      return fetchText(p).then(function (t) {
        done++; onProgress(done, paths.length);
        return { path: p, text: t };
      }).catch(function () { done++; onProgress(done, paths.length); return { path: p, text: '' }; });
    })).then(function (docs) { state.corpus = docs; return docs; });
  }

  function showSearch(q) {
    state.path = '';
    syncToc();
    closeNav();
    el.pager.hidden = true;
    el.main.scrollTop = 0;
    document.title = '"' + q + '" 검색 — AI가 요약해줘도 나는 손으로 읽는다';
    el.doc.innerHTML = '<h1>본문 검색</h1><p class="loading">원고를 모으는 중… <span id="dl">0</span></p>';

    loadCorpus(function (d, n) {
      var s = $('#dl');
      if (s) s.textContent = d + ' / ' + n;
    }).then(function (docs) {
      var needle = q.toLowerCase();
      var hits = [];
      docs.forEach(function (d) {
        var lines = d.text.split('\n');
        var count = 0, snips = [], heading = '';
        for (var i = 0; i < lines.length; i++) {
          var raw = lines[i];
          var hm = raw.match(/^(#{1,4})\s+(.*)$/);
          if (hm && snips.length === 0) heading = hm[2];
          if (/^\s*```/.test(raw)) continue;
          var line = stripMd(raw);
          var at = line.toLowerCase().indexOf(needle);
          if (at < 0) continue;
          count++;
          if (snips.length < 3) {
            var from = Math.max(0, at - 42), to = Math.min(line.length, at + needle.length + 70);
            snips.push({
              pre: (from > 0 ? '…' : '') + line.slice(from, at),
              hit: line.slice(at, at + needle.length),
              post: line.slice(at + needle.length, to) + (to < line.length ? '…' : ''),
              anchor: heading ? slugify(heading) : ''
            });
          }
        }
        if (count) hits.push({ path: d.path, count: count, snips: snips });
      });

      hits.sort(function (a, b) { return b.count - a.count; });

      var html = '<h1>본문 검색</h1>';
      html += '<p>"' + esc(q) + '" — 문서 ' + hits.length + '개에서 ' +
        hits.reduce(function (s, h) { return s + h.count; }, 0) + '번 나온다.</p>';
      if (!hits.length) html += '<p>찾지 못했다. 다른 말로 찾아본다.</p>';
      else {
        html += '<div class="results">';
        hits.forEach(function (h) {
          var a = h.snips[0] && h.snips[0].anchor ? '#' + encodeURIComponent(h.snips[0].anchor) : '';
          html += '<p><a href="#/' + encodeURI(h.path) + a + '"><b>' + esc(titleOf(h.path)) +
            '</b> (' + h.count + ')</a></p>';
          h.snips.forEach(function (s) {
            html += '<div class="snip">' + esc(s.pre) + '<mark>' + esc(s.hit) + '</mark>' + esc(s.post) + '</div>';
          });
        });
        html += '</div>';
      }
      el.doc.innerHTML = html;
      updateProgress();
    });
  }

  /* ───────── 서랍 ───────── */

  function openNav() { document.body.classList.add('nav-open'); el.scrim.hidden = false; el.menu.setAttribute('aria-expanded', 'true'); }
  function closeNav() { document.body.classList.remove('nav-open'); el.scrim.hidden = true; el.menu.setAttribute('aria-expanded', 'false'); }

  /* ───────── 설정 ───────── */

  function applyTheme(t) { document.documentElement.setAttribute('data-theme', t); store(LS.theme, t); }
  function applyFs(n) { n = Math.max(15, Math.min(22, n)); document.documentElement.style.setProperty('--fs', n + 'px'); store(LS.fs, n); }

  /* ───────── 인쇄 ───────── */

  function printCurrentPage() {
    if (!state.path) return;
    window.print();
  }

  /* ───────── 별 개수 ───────── */

  /* 깃허브 API 는 로그인 없이 시간당 60번이다. 한 시간 동안은 받아 둔 값을 쓴다.
     못 받아 오면 Star 단추만 두고 개수 칸은 비워 둔다. */
  function loadStars() {
    var cached = store(LS.stars);
    var now = Date.now();
    if (cached && cached.n != null && now - cached.at < 3600000) { showStars(cached.n); return; }

    var apiUrl = REPO.replace('https://github.com/', 'https://api.github.com/repos/');
    fetch(apiUrl)
      .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error(r.status)); })
      .then(function (d) {
        if (typeof d.stargazers_count !== 'number') return;
        store(LS.stars, { n: d.stargazers_count, at: now });
        showStars(d.stargazers_count);
      })
      .catch(function () { if (cached && cached.n != null) showStars(cached.n); });
  }

  function showStars(n) {
    var e = $('#star-n');
    if (!e) return;
    e.textContent = n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(n);
    e.title = '별 ' + n.toLocaleString('ko-KR') + '개';
    e.hidden = false;
  }

  /* ───────── 연결 ───────── */

  function wire() {
    window.addEventListener('hashchange', function () {
      var r = route();
      if (r.search !== undefined) showSearch(r.search);
      else open(r.path, r.anchor);
    });

    var tick = null;
    el.main.addEventListener('scroll', function () {
      if (tick) return;
      tick = requestAnimationFrame(function () { tick = null; updateProgress(); });
    }, { passive: true });

    el.totop.addEventListener('click', function () { el.main.scrollTo({ top: 0, behavior: 'smooth' }); });
    el.menu.addEventListener('click', function () { document.body.classList.contains('nav-open') ? closeNav() : openNav(); });
    el.scrim.addEventListener('click', closeNav);
    el.toc.addEventListener('click', function (e) {
      if (e.target.closest('a') && window.matchMedia('(max-width: 860px)').matches) closeNav();
    });

    el.q.addEventListener('input', function () { filterToc(el.q.value); });
    el.q.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); if (el.q.value.trim().length >= 2) location.hash = '#?q=' + encodeURIComponent(el.q.value.trim()); }
      if (e.key === 'Escape') { el.q.value = ''; filterToc(''); el.q.blur(); }
    });
    el.qclear.addEventListener('click', function () { el.q.value = ''; filterToc(''); el.q.focus(); });
    el.fulltext.addEventListener('click', function () {
      if (el.q.value.trim().length >= 2) location.hash = '#?q=' + encodeURIComponent(el.q.value.trim());
    });

    $('#theme').addEventListener('click', function () {
      applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
    });
    $('#font-up').addEventListener('click', function () { applyFs((store(LS.fs) || 17) + 1); });
    $('#font-down').addEventListener('click', function () { applyFs((store(LS.fs) || 17) - 1); });
    $('#print-page').addEventListener('click', printCurrentPage);

    document.addEventListener('keydown', function (e) {
      var t = e.target;
      var typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if (e.key === '/' && !typing) { e.preventDefault(); el.q.focus(); el.q.select(); return; }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === 'ArrowRight') step(1);
      else if (e.key === 't' || e.key === 'T' || e.key === 'ㅅ') {
        applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
      } else if (e.key === 'p' || e.key === 'P' || e.key === 'ㅔ') printCurrentPage();
      else if (e.key === 'Escape') closeNav();
    });
  }

  /* ───────── 시작 ───────── */

  function boot() {
    applyTheme(store(LS.theme) || 'light');
    applyFs(store(LS.fs) || 17);
    if (window.marked && marked.setOptions) marked.setOptions({ gfm: true, breaks: false });
    wire();
    loadStars();

    fetch(BASE + 'viewer/toc.json').then(function (r) { return r.json(); }).then(function (toc) {
      buildIndex(toc);
      renderToc();
      var r = route();
      if (r.search !== undefined) showSearch(r.search);
      else open(r.path, r.anchor);
    }).catch(function (e) {
      el.toc.innerHTML = '<p class="loading">차례를 읽지 못했다.</p>';
      el.doc.innerHTML = '<div class="err"><h2>toc.json을 읽지 못했다</h2>' +
        '<p>' + esc(e.message) + '</p>' +
        '<p><code>file://</code>로 직접 열면 가져오기가 막힌다. 저장소 안에서 ' +
        '<code>python3 -m http.server 8000</code> 을 돌리고 ' +
        '<code>http://localhost:8000/</code> 로 들어간다.</p></div>';
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
