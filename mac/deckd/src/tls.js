import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/// HTTPS exists here for one reason: a page served over plain http is not a
/// secure context, and without one the tablet cannot hold a Wake Lock — so its
/// screen sleeps mid-use — and cannot be installed to the home screen.
///
/// The certificate is a local CA rather than Tailscale's, on purpose. A
/// Tailscale cert is bound to the .ts.net name, and reaching the Mac by that
/// name routes over Tailscale, which is what was adding tens of milliseconds
/// per packet through a relay abroad. Secure context is wanted ON THE LAN.
export function loadTls(configPath) {
  const dir = join(dirname(configPath), 'tls');
  const key = join(dir, 'server.key');
  const cert = join(dir, 'server.crt');
  const ca = join(dir, 'ca.crt');
  if (!existsSync(key) || !existsSync(cert)) return null;
  return {
    options: { key: readFileSync(key), cert: readFileSync(cert) },
    caPath: existsSync(ca) ? ca : null
  };
}

/// Shown at /setup on either port. HTTPS is optional here — it buys Wake Lock
/// so the tablet screen stops sleeping, and install-to-homescreen — so this
/// explains rather than forces, and never redirects into a certificate warning.
export function setupPage(secureUrl) {
  return `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>SwitchDeck — pasang sertifikat</title>
<style>
 body{margin:0;padding:24px;font:16px/1.55 -apple-system,Roboto,sans-serif;
      background:#101216;color:#e6e8ec}
 h1{font-size:20px;margin:0 0 6px} p{color:#8b93a1;margin:0 0 18px;font-size:14px}
 ol{padding-left:20px;line-height:2} code{background:#181b21;padding:2px 6px;border-radius:5px}
 a.btn{display:block;text-align:center;padding:16px;margin:10px 0;border-radius:12px;
       text-decoration:none;font-weight:600}
 .p{background:#3d6fd1;color:#fff} .s{background:#1f2530;color:#cdd6e4;border:1px solid #2f3642}
</style>
<h1>SwitchDeck jalan tanpa ini</h1>
<p>Sertifikat cuma menambah dua hal: layar tablet berhenti tidur sendiri saat
   dipakai, dan SwitchDeck bisa dipasang ke home screen.</p>
<a class="btn p" href="/ca.crt">1 — Unduh sertifikat</a>
<ol>
  <li>Buka <code>Settings → Security → Install certificate → CA certificate</code></li>
  <li>Pilih berkas yang barusan diunduh</li>
</ol>
<a class="btn s" href="${secureUrl}">2 — Buka lewat HTTPS</a>
<p>Kalau langkah 2 gagal, pakai saja alamat http biasa — semua fitur lain sama.</p>`;
}
