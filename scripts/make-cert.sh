#!/bin/bash
# Issues a local CA and a server certificate for deckd.
#
# Not Tailscale's cert, deliberately: that one is bound to the .ts.net hostname,
# and reaching the Mac by that name routes over Tailscale — which is what was
# adding 40ms to every packet through a relay in another country. The point of
# HTTPS here is a secure context on the LAN, so the certificate has to cover the
# LAN address.
#
# A secure context buys: Wake Lock (the tablet screen stops sleeping mid-use),
# service workers, and install-to-homescreen.
set -euo pipefail

DIR="$HOME/.config/switchdeck/tls"
DAYS_CA=3650
DAYS_LEAF=825          # browsers reject leaf certs valid much longer than this
mkdir -p "$DIR"
chmod 700 "$DIR"

# Every address this Mac answers on, so the certificate is valid however the
# tablet reaches it.
IPS=$(ipconfig getiflist 2>/dev/null | tr ' ' '\n' | while read -r i; do
        ipconfig getifaddr "$i" 2>/dev/null || true
      done | sort -u)
NAME=$(scutil --get LocalHostName 2>/dev/null || hostname)

SAN="DNS:localhost,DNS:$NAME,DNS:$NAME.local,IP:127.0.0.1"
for ip in $IPS; do SAN="$SAN,IP:$ip"; done

if [ ! -f "$DIR/ca.crt" ]; then
  openssl req -x509 -newkey rsa:2048 -sha256 -days "$DAYS_CA" -nodes \
    -keyout "$DIR/ca.key" -out "$DIR/ca.crt" \
    -subj "/CN=SwitchDeck Local CA" \
    -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
    -addext "keyUsage=critical,keyCertSign,cRLSign" 2>/dev/null
  echo "  CA dibuat: $DIR/ca.crt"
else
  echo "  CA sudah ada, dipakai ulang (jadi tablet tidak perlu install ulang)"
fi

openssl req -newkey rsa:2048 -sha256 -nodes \
  -keyout "$DIR/server.key" -out "$DIR/server.csr" \
  -subj "/CN=$NAME" 2>/dev/null

openssl x509 -req -in "$DIR/server.csr" -sha256 -days "$DAYS_LEAF" \
  -CA "$DIR/ca.crt" -CAkey "$DIR/ca.key" -CAcreateserial \
  -out "$DIR/server.crt" \
  -extfile <(printf "subjectAltName=%s\nextendedKeyUsage=serverAuth\n" "$SAN") 2>/dev/null

rm -f "$DIR/server.csr"
chmod 600 "$DIR"/*.key

echo "  Sertifikat server berlaku untuk:"
echo "    $SAN" | tr ',' '\n' | sed 's/^/      /'
echo ""
echo "  Selanjutnya, di tablet:"
echo "    1. Buka  http://<alamat-LAN-mac>:8777/ca.crt  lalu unduh"
echo "    2. Settings > Security > Install certificate > CA certificate"
echo "    3. Balik ke SwitchDeck lewat https://<alamat-LAN-mac>:8777/"
echo ""
echo "  Restart deckd supaya HTTPS-nya kepakai."
