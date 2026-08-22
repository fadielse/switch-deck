import { existsSync, readFileSync } from 'node:fs';
import { createServer as createHttp } from 'node:http';
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

/// The front door has to speak plain HTTP, because a browser given a bare
/// "host:port" tries http:// first — so putting TLS on the port people type
/// breaks the link they already have, with an error that explains nothing.
///
/// So this sits on the well-known port and does three things: hands out the CA,
/// explains what to do with it, and points at the HTTPS port. HTTPS itself
/// moves one port up.
export function serveFrontDoor({ port, httpsPort, caPath, address }) {
  const secureUrl = `https://${address}:${httpsPort}/`;

  const page = `<!doctype html><meta charset="utf-8">
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
<h1>SwitchDeck</h1>
<p>Sekali saja: pasang sertifikat supaya layar tablet berhenti tidur sendiri
   dan SwitchDeck bisa dipasang ke home screen.</p>
<a class="btn p" href="/ca.crt">1 — Unduh sertifikat</a>
<ol>
  <li>Buka <code>Settings → Security → Install certificate → CA certificate</code></li>
  <li>Pilih berkas yang barusan diunduh</li>
</ol>
<a class="btn s" href="${secureUrl}">2 — Lanjut ke SwitchDeck</a>
<p>Sudah pernah pasang? Langsung pakai tombol kedua.</p>`;

  const server = createHttp((req, res) => {
    const path = (req.url || '/').split('?')[0];

    if (path === '/ca.crt' && caPath) {
      res.writeHead(200, {
        'content-type': 'application/x-x509-ca-cert',
        'content-disposition': 'attachment; filename="switchdeck-ca.crt"'
      });
      res.end(readFileSync(caPath));
      return;
    }
    if (path === '/go') {
      res.writeHead(302, { location: secureUrl });
      res.end();
      return;
    }
    // Not a redirect: sending them straight to HTTPS before the certificate is
    // installed produces a security warning that explains none of this.
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(page);
  });
  server.listen(port);
  return server;
}
