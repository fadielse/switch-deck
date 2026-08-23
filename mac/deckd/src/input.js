import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

/// Owns the deckd-input child process. Everything platform-specific lives on
/// the far side of this pipe (decision K10), so this file never learns what a
/// CGEvent is.
export class InputBridge {
  constructor(binaryPath, { onStatus, onFront, onEdge } = {}) {
    this.binaryPath = binaryPath;
    this.onStatus = onStatus ?? (() => {});
    this.onFront = onFront ?? (() => {});
    this.onEdge = onEdge ?? (() => {});
    this.child = null;
    this.trusted = null;
    this.refreshHz = 60;
    this.restarts = 0;
  }

  start() {
    this.child = spawn(this.binaryPath, [], { stdio: ['pipe', 'pipe', 'inherit'] });

    createInterface({ input: this.child.stdout }).on('line', (line) => {
      let frame;
      try {
        frame = JSON.parse(line);
      } catch {
        return;
      }
      if (frame.t === 'ready') {
        this.trusted = frame.trusted;
        if (frame.refreshHz > 0) this.refreshHz = frame.refreshHz;
        this.onStatus(frame);
      } else if (frame.t === 'front') {
        this.front = { app: frame.app, bundle: frame.bundle };
        this.onFront(this.front);
      } else if (frame.t === 'edge') {
        // The cursor is pressed against an edge and motion is being thrown
        // away. Only the tablet knows what is next to this machine, so it
        // decides what that means.
        this.onEdge({ side: frame.side, over: frame.over, ry: frame.ry });
      } else if (frame.t === 'err') {
        console.error('[deckd-input]', frame.msg, frame.raw ?? '');
      }
    });

    this.child.on('exit', (code) => {
      console.error(`[deckd-input] keluar dengan code ${code}`);
      // One retry: a crash loop should be loud, not silently papered over.
      if (this.restarts < 1) {
        this.restarts += 1;
        console.error('[deckd-input] mencoba start ulang sekali...');
        this.start();
      } else {
        console.error('[deckd-input] menyerah — jalankan `make selftest` untuk mendiagnosis');
      }
    });
  }

  send(frame) {
    if (!this.child?.stdin.writable) return false;
    this.child.stdin.write(JSON.stringify(frame) + '\n');
    return true;
  }
}
