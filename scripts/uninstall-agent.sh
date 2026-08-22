#!/bin/bash
set -euo pipefail
LABEL="com.switchdeck.deckd"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
launchctl unload "$PLIST" 2>/dev/null || true
rm -f "$PLIST"
echo "  Dicabut. deckd tidak lagi nyala saat login."
echo "  Config, device yang sudah dipasangkan, dan deck.json tidak disentuh."
