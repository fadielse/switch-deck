#!/usr/bin/env python3
"""Bangun dokumentasi HTML dua bahasa dari file README.

  README.md    -> docs/index.html   (English)
  README.id.md -> docs/id.html      (Bahasa Indonesia)

Dokumentasi HTML yang ditulis tangan terpisah akan melenceng dari README dalam
hitungan minggu. Ini menurunkannya dari satu sumber, jadi yang perlu diedit
cuma file README-nya — lalu `make docs`.
"""
import io, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

HEAD = r'''<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SwitchDeck — Dokumentasi</title>
<style>
  :root {
    --bg:#0f1116; --panel:#161a21; --line:#252a34; --fg:#e6e8ec; --dim:#98a1b0;
    --accent:#4d84e6; --mono: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--fg);
         font:16px/1.65 -apple-system, "Segoe UI", Roboto, sans-serif; }
  a { color:var(--accent); }
  .wrap { display:flex; align-items:flex-start; max-width:1500px; margin:0 auto; }
  nav { position:sticky; top:0; align-self:flex-start; flex:0 0 268px;
        max-height:100vh; overflow-y:auto; padding:26px 16px 40px;
        border-right:1px solid var(--line); font-size:13.5px; }
  nav .brand { display:flex; align-items:center; gap:9px; margin-bottom:18px; }
  nav .brand svg { width:26px; height:26px; }
  nav .brand b { font-size:15px; letter-spacing:-.01em; }
  nav .brand b span { color:var(--dim); font-weight:500; }
  nav ol { list-style:none; margin:0; padding:0; counter-reset:s; }
  nav li { counter-increment:s; }
  nav ol a { display:block; padding:6px 10px; border-radius:7px; color:var(--dim);
             text-decoration:none; }
  nav ol a::before { content:counter(s) ". "; color:#5b6472; }
  nav ol a:hover { background:var(--panel); color:var(--fg); }
  main { flex:1 1 auto; min-width:0; padding:26px 34px 90px; max-width:920px; }
  h1 { font-size:34px; letter-spacing:-.02em; margin:.2em 0 .1em; }
  h2 { font-size:23px; letter-spacing:-.01em; margin:2.4em 0 .5em;
       padding-top:.7em; border-top:1px solid var(--line); scroll-margin-top:14px; }
  h3 { font-size:17px; margin:1.7em 0 .4em; color:#cfd6e2; }
  p, li { color:#d3d8e0; }
  code { font-family:var(--mono); font-size:.87em; background:#1c212b;
         padding:2px 6px; border-radius:5px; color:#cbd5e6; }
  pre { background:#12161d; border:1px solid var(--line); border-radius:10px;
        padding:14px 16px; overflow-x:auto; font-size:13.5px; line-height:1.55; }
  pre code { background:none; padding:0; font-size:inherit; }
  table { border-collapse:collapse; width:100%; margin:1em 0; font-size:14.5px; }
  th, td { text-align:left; padding:9px 12px; border-bottom:1px solid var(--line);
           vertical-align:top; }
  th { color:var(--dim); font-weight:600; font-size:12.5px; text-transform:uppercase;
       letter-spacing:.06em; }
  tbody tr:hover { background:#141821; }
  figure { margin:1.4em 0; }
  figure img { width:100%; display:block; border:1px solid var(--line);
               border-radius:11px; background:#0b0d12; }
  figcaption { color:var(--dim); font-size:13px; margin-top:8px; }
  blockquote { margin:1.3em 0; padding:13px 16px; border-radius:10px;
               background:#1a1710; border:1px solid #4a3c17; color:#e8d9ae; }
  blockquote p { margin:.3em 0; color:inherit; }
  blockquote code { background:#241f14; color:#f0e2bb; }
  hr { border:0; border-top:1px solid var(--line); margin:2em 0; }
  .langswitch { display:flex; gap:6px; margin-bottom:16px; }
  .langswitch a, .langswitch span {
    flex:1; text-align:center; padding:6px 8px; border-radius:7px; font-size:12.5px;
    border:1px solid var(--line); text-decoration:none; color:var(--dim);
  }
  .langswitch span { background:#1f2a3d; border-color:#3d6fd1; color:#cdd6e4; font-weight:600; }
  @media (max-width:900px) { nav { display:none; } main { padding:20px 18px 60px; } }
</style>
</head>
<body>
<div class="wrap">
<nav>
  <div class="brand">
    <svg viewBox="0 0 24 24" fill="none">
      <rect x="1.6" y="1.6" width="20.8" height="20.8" rx="6" fill="#3d6fd1"/>
      <path d="M7.1 9.6h8.1M12.9 7.3l2.4 2.3-2.4 2.3" stroke="#fff" stroke-width="1.7"
            stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M16.9 14.4H8.8M11.1 16.7l-2.4-2.3 2.4-2.3" stroke="#bcd4ff" stroke-width="1.7"
            stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    <b><span>Switch</span>Deck</b>
  </div>
  <div class="langswitch">__LANGSWITCH__</div>
  <ol id="toc"></ol>
</nav>
<main>
'''

FOOT = r'''
</main>
</div>
<script>
  // Sidebar dibangun dari isi halaman, jadi tidak ada daftar kedua yang bisa
  // basi terhadap judul yang sebenarnya ada.
  var toc = document.getElementById('toc');
  document.querySelectorAll('main h2').forEach(function (h) {
    var li = document.createElement('li');
    var a = document.createElement('a');
    a.href = '#' + h.id; a.textContent = h.textContent;
    li.appendChild(a); toc.appendChild(li);
  });
</script>
</body>
</html>
'''

def slug(t):
    t = re.sub(r'[`*]', '', t.lower())
    t = re.sub(r'[^a-z0-9 \-&]', '', t).replace('&', '')
    return re.sub(r'\s+', '-', t.strip()).strip('-')

def inline(t):
    t = t.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
    t = re.sub(r'`([^`]+)`', r'<code>\1</code>', t)
    t = re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', t)
    t = re.sub(r'\*([^*]+)\*', r'<em>\1</em>', t)
    t = re.sub(r'!\[([^\]]*)\]\(([^)]+)\)', r'<img alt="\1" src="\2">', t)
    t = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'<a href="\2">\1</a>', t)
    return t

def convert(md):
    lines, out, i, skip_toc = md.split('\n'), [], 0, False
    while i < len(lines):
        L = lines[i]
        if L.startswith('```'):
            i += 1; buf = []
            while i < len(lines) and not lines[i].startswith('```'):
                buf.append(lines[i]); i += 1
            i += 1
            body = '\n'.join(buf).replace('&','&amp;').replace('<','&lt;').replace('>','&gt;')
            out.append('<pre><code>' + body + '</code></pre>'); continue
        if L.startswith('## '):
            t = L[3:].strip()
            if t in ('Daftar isi', 'Contents'):
                skip_toc = True; i += 1; continue
            skip_toc = False
            out.append('<h2 id="%s">%s</h2>' % (slug(t), inline(t))); i += 1; continue
        if skip_toc: i += 1; continue
        if L.startswith('### '):
            t = L[4:].strip()
            out.append('<h3 id="%s">%s</h3>' % (slug(t), inline(t))); i += 1; continue
        if L.startswith('# '):
            out.append('<h1>%s</h1>' % inline(L[2:].strip())); i += 1; continue
        if L.startswith('!['):
            m = re.match(r'!\[([^\]]*)\]\(([^)]+)\)', L.strip())
            if m:
                out.append('<figure><img alt="%s" src="%s"><figcaption>%s</figcaption></figure>'
                           % (m.group(1), m.group(2), m.group(1)))
                i += 1; continue
        if L.startswith('|'):
            rows = []
            while i < len(lines) and lines[i].startswith('|'):
                rows.append(lines[i]); i += 1
            cells = [[c.strip() for c in r.strip().strip('|').split('|')] for r in rows]
            html = ['<table><thead><tr>']
            html += ['<th>%s</th>' % inline(h) for h in cells[0]]
            html.append('</tr></thead><tbody>')
            for r in cells[2:]:
                html.append('<tr>' + ''.join('<td>%s</td>' % inline(c) for c in r) + '</tr>')
            html.append('</tbody></table>')
            out.append(''.join(html)); continue
        if L.startswith('> '):
            buf = []
            while i < len(lines) and lines[i].startswith('>'):
                buf.append(lines[i].lstrip('>').strip()); i += 1
            text = ' '.join(buf)
            # Catatan "buka versi HTML" tidak ada gunanya DI DALAM versi HTML.
            if 'docs/index.html' in text: continue
            out.append('<blockquote><p>' + inline(text) + '</p></blockquote>'); continue
        if re.match(r'^\d+\. ', L) or L.startswith('- '):
            ordered = bool(re.match(r'^\d+\. ', L)); buf = []
            while i < len(lines) and (re.match(r'^\d+\. ', lines[i]) or lines[i].startswith('- ')):
                buf.append(re.sub(r'^(\d+\.|-)\s+', '', lines[i])); i += 1
            tag = 'ol' if ordered else 'ul'
            out.append('<%s>%s</%s>' % (tag, ''.join('<li>%s</li>' % inline(b) for b in buf), tag))
            continue
        if L.strip() == '---':
            out.append('<hr>'); i += 1; continue
        if L.strip():
            buf = [L]; i += 1
            while i < len(lines) and lines[i].strip() and not re.match(r'^(#|\||>|-\s|\d+\.\s|```|---|!\[)', lines[i]):
                buf.append(lines[i]); i += 1
            out.append('<p>%s</p>' % inline(' '.join(buf))); continue
        i += 1
    return '\n'.join(out)

BUILDS = [
    ('README.md', 'index.html', 'en', 'English'),
    ('README.id.md', 'id.html', 'id', 'Bahasa Indonesia'),
]

missing = []
for src, out_name, lang, _label in BUILDS:
    md = io.open(os.path.join(ROOT, src), encoding='utf-8').read()

    # Baris pemilih bahasa di README menunjuk ke file markdown; di halaman HTML
    # yang berguna adalah halaman HTML-nya, dan itu sudah ada di sidebar.
    md = '\n'.join(l for l in md.split('\n')
                   if not (l.startswith('>') and ('README.id.md' in l or 'README.md](README.md' in l)))

    switch = []
    for _s, other_out, other_lang, other_label in BUILDS:
        if other_lang == lang:
            switch.append('<span>%s</span>' % other_label)
        else:
            switch.append('<a href="%s">%s</a>' % (other_out, other_label))

    html = HEAD.replace('__LANGSWITCH__', ''.join(switch)) + convert(md) + FOOT
    # Gambar relatif terhadap docs/, bukan terhadap akar repo.
    html = html.replace('src="docs/img/', 'src="img/')
    io.open(os.path.join(ROOT, 'docs', out_name), 'w', encoding='utf-8').write(html)
    print('docs/%s dibangun dari %s — %d karakter' % (out_name, src, len(html)))

    for m in re.finditer(r'src="img/([^"]+)"', html):
        if not os.path.exists(os.path.join(ROOT, 'docs', 'img', m.group(1))):
            missing.append(out_name + ' -> ' + m.group(1))

if missing:
    print('GAMBAR HILANG: ' + ', '.join(missing), file=sys.stderr)
    sys.exit(1)
