import { setupApp } from './common.mjs';
const frame = document.querySelector('#cyberchef-frame');
const loading = document.querySelector('#cyberchef-loading');
const status = document.querySelector('#cyberchef-status');
const retry = document.querySelector('#cyberchef-retry');
let poll, timeout;
const pane = document.querySelector('#cyberchef-pane');
pane.addEventListener('change', () => { if (frame.contentDocument) { frame.contentDocument.documentElement.dataset.webpcPane = pane.value; frame.contentWindow.dispatchEvent(new Event('resize')); } });
function adaptSmallScreen(doc) {
  // Isolated wrapper stylesheet; upstream release files remain unmodified.
  doc.documentElement.dataset.webpcPane = pane.value;
  const style = doc.createElement('style');
  style.textContent = `@media(max-width:639px){
    #workspace-wrapper{display:block!important}
    .popover{display:none!important}
    #workspace-wrapper>.gutter,#IO>.gutter{display:none!important}
    #operations,#recipe,#IO{display:none!important;width:100%!important;height:100%!important;float:none!important}
    html[data-webpc-pane=operations] #operations,html[data-webpc-pane=recipe] #recipe,
    html[data-webpc-pane=input] #IO,html[data-webpc-pane=output] #IO{display:block!important}
    #IO>#input,#IO>#output{display:none!important;height:100%!important;width:100%!important}
    html[data-webpc-pane=input] #IO>#input,html[data-webpc-pane=output] #IO>#output{display:block!important}
    #banner{display:flex!important;flex-wrap:nowrap!important;height:30px!important;overflow:auto;white-space:nowrap}
    #banner>.col{flex:0 0 auto!important;width:auto!important}
    #notice-wrapper{display:none!important}
  }`;
  doc.head.append(style);
}

function failed() { clearInterval(poll); clearTimeout(timeout); loading.hidden = false; status.textContent = 'CyberChef could not load. Retry or open the full page.'; retry.hidden = false; }
function monitor() {
  clearInterval(poll); clearTimeout(timeout);
  poll = setInterval(() => {
    try {
      const doc = frame.contentDocument;
      if (!doc || /404|not found/i.test(doc.title)) return;
      const input = doc.querySelector('#input-text');
      if (!input || doc.querySelector('#preloader')) return;
      clearInterval(poll); clearTimeout(timeout); adaptSmallScreen(doc); loading.hidden = true;
      doc.addEventListener('pointerdown', () => parent.postMessage({type:'pc:focus',appId:'cyberchef'},location.origin), true);
      setupApp('cyberchef');
    } catch { failed(); }
  }, 150);
  timeout = setTimeout(failed, 45000);
}
retry.addEventListener('click', () => { retry.hidden=true; status.textContent='Loading CyberChef…'; frame.src=frame.src; monitor(); });
frame.addEventListener('error', failed);
monitor();
