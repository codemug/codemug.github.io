// WebPC audio guard, injected before an app's own scripts: records every
// AudioContext this page creates so the WebPC wrapper can suspend them when
// its window closes (closing a WebPC window only hides the iframe). It also
// tracks which contexts WebPC itself suspended, so the gesture resume can skip
// contexts the app suspended on purpose. Never blocks the app: its own
// Play/Resume still works after a suspend, because this only wraps the
// constructors and exposes controls.
(() => {
  const contexts = new Set();
  const webpcSuspended = new Set();
  for (const name of ['AudioContext', 'webkitAudioContext']) {
    const Native = window[name];
    if (!Native) continue;
    class Tracked extends Native {
      constructor(...args) { super(...args); contexts.add(this); }
    }
    window[name] = Tracked;
  }
  const live = () => [...contexts].filter(c => c.state !== 'closed');
  window.webpcAudio = {
    // Suspend every live context (the WebPC window is about to be hidden).
    suspend() {
      const running = live().filter(c => c.state === 'running');
      for (const c of running) webpcSuspended.add(c);
      return Promise.all(running.map(c => c.suspend()));
    },
    // Resume everything (the wrapper's explicit Enable audio). Resolves true
    // when at least one live context exists and all of them are running.
    resume() {
      const liveNow = live();
      return Promise.all(liveNow.map(c => c.resume())).then(() => liveNow.length > 0 && liveNow.every(c => c.state === 'running'));
    },
    // Resume only the contexts WebPC itself suspended (generic gesture resume),
    // never ones the app suspended on purpose.
    // Each WebPC suspend is undone at most once, so a later suspend by the app itself stays.
    resumeGuarded() {
      const targets = [...webpcSuspended];
      webpcSuspended.clear();
      return Promise.all(targets.filter(c => c.state === 'suspended').map(c => c.resume()));
    },
    states() { return [...contexts].map(c => c.state); },
  };
})();
