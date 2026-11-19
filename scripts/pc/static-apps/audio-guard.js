// WebPC audio guard, injected before a static app's own scripts: records every AudioContext
// this page creates so the WebPC wrapper can suspend them when its window closes (closing a
// WebPC window only hides the iframe). Never blocks resume: the app's own Play/Resume still
// works after a suspend, because this only wraps the constructors and exposes controls.
(() => {
  const contexts = new Set();
  for (const name of ['AudioContext', 'webkitAudioContext']) {
    const Native = window[name];
    if (!Native) continue;
    class Tracked extends Native {
      constructor(...args) { super(...args); contexts.add(this); }
    }
    window[name] = Tracked;
  }
  window.webpcAudio = {
    suspend() { return Promise.all([...contexts].filter(ctx => ctx.state === 'running').map(ctx => ctx.suspend())); },
    states() { return [...contexts].map(ctx => ctx.state); },
  };
})();
