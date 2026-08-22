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

/// The tablet has to fetch the CA before it can trust anything, which it cannot
/// do over the connection the CA is meant to secure. So a small plain server
/// sits alongside, handing out the CA and pointing everything else at HTTPS.
export function serveCaAndRedirect({ port, httpsPort, caPath, address }) {
  const server = createHttp((req, res) => {
    if (req.url === '/ca.crt' && caPath) {
      res.writeHead(200, {
        'content-type': 'application/x-x509-ca-cert',
        'content-disposition': 'attachment; filename="switchdeck-ca.crt"'
      });
      res.end(readFileSync(caPath));
      return;
    }
    res.writeHead(302, { location: `https://${address}:${httpsPort}/` });
    res.end();
  });
  server.listen(port);
  return server;
}
