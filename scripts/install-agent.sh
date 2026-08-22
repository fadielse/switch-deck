#!/bin/bash
# Installs deckd as a LaunchAgent so it starts at login and comes back if it
# dies. No single binary: that was for handing the thing to other people, which
# the design notes list as an anti-goal. A plist pointing at node is enough, and
# it dissolves the "Bun is not installed" blocker along with it.
set -euo pipefail

LABEL="com.switchdeck.deckd"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE="$(command -v node)"
LOGDIR="$HOME/.config/switchdeck"

mkdir -p "$HOME/Library/LaunchAgents" "$LOGDIR"

cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$REPO/mac/deckd/src/server.js</string>
  </array>
  <key>WorkingDirectory</key><string>$REPO/mac/deckd</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOGDIR/deckd.log</string>
  <key>StandardErrorPath</key><string>$LOGDIR/deckd.log</string>
</dict>
</plist>
PLIST_EOF

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"

echo ""
echo "  Terpasang: $PLIST"
echo "  Log      : $LOGDIR/deckd.log"
echo ""
echo "  deckd sekarang nyala saat login dan hidup lagi kalau mati."
echo ""
echo "  PENTING — izin Accessibility:"
echo "  Dijalankan launchd, tidak ada aplikasi induk yang bisa 'meminjamkan'"
echo "  izinnya seperti waktu dijalankan dari terminal. Cek dengan:"
echo ""
echo "      make doctor"
echo ""
echo "  Kalau merah, tambahkan binary ini di System Settings > Privacy &"
echo "  Security > Accessibility:"
echo "      $REPO/mac/deckd-input/.build/release/deckd-input"
echo ""
echo "  Kode pairing:  make code"
echo ""
