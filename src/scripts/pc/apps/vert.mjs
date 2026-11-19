import {setupApp} from './common.mjs';
const frame=document.getElementById('vert-frame'),loading=document.getElementById('vert-loading'),status=document.getElementById('vert-status'),error=document.getElementById('vert-error');
const stop=document.getElementById('vert-stop'),retry=document.getElementById('vert-retry');
const source='/pc/vendor/vert/';let ready=false,closedBeforeReady=false,timer;
const api=()=>{try{return frame.contentWindow?.webpcVERT}catch{return undefined}};
const report=message=>{error.textContent=message;error.hidden=!message};
function theme(){if(ready)frame.contentWindow.postMessage({type:'pc:theme',theme:document.documentElement.dataset.theme??'dark'},location.origin)}
function open(){clearTimeout(timer);ready=false;closedBeforeReady=false;report('');loading.hidden=false;loading.querySelector('h1').textContent='Opening VERT';retry.hidden=true;stop.disabled=true;status.textContent='Opening local converter…';frame.src=source;timer=setTimeout(()=>fail('VERT did not finish opening. Retry to reload its local assets.'),90000)}
function fail(message){ready=false;clearTimeout(timer);loading.hidden=false;loading.querySelector('h1').textContent='VERT could not open';retry.hidden=false;status.textContent='Could not open';report(message)}
window.addEventListener('message',event=>{
 if(event.origin!==location.origin||event.source!==frame.contentWindow)return;
 if(event.data?.type==='vert:ready'&&api()?.ready){ready=true;clearTimeout(timer);loading.hidden=true;status.textContent='Local conversion · download results to keep them';theme();}
 if(event.data?.type==='vert:focus')parent.postMessage({type:'pc:focus',appId:'vert'},location.origin);
});
frame.addEventListener('load',()=>{try{if(frame.contentDocument?.URL!=='about:blank'&&!frame.contentDocument?.querySelector('meta[name=webpc-vert]'))fail('VERT returned an incomplete page. Retry to load the converter.')}catch{fail('VERT could not load its local page.')}});
frame.addEventListener('error',()=>fail('VERT assets failed to load. Your other apps are unchanged.'));
retry.addEventListener('click',open);
document.getElementById('vert-reload').addEventListener('click',()=>{if(api()?.fileCount&&!confirm('Reload VERT and discard this conversion session? Download results first.'))return;open()});
stop.addEventListener('click',async()=>{stop.disabled=true;status.textContent='Stopping conversions…';try{await api()?.stop();report('');status.textContent='Stopped. Files remain available to retry.'}catch(err){report(`Could not stop: ${err.message}`)}});
document.getElementById('vert-help').addEventListener('click',()=>document.getElementById('vert-help-dialog').showModal());
window.pcBeforeClose=()=>{
 if(api()?.active){report('A conversion is still running. Use Stop conversions before closing VERT.');return false}
 if(!ready){closedBeforeReady=true;clearTimeout(timer);frame.src='about:blank';status.textContent='Closed before loading finished';}
 return true;
};
// The shell caches closed frames. Restart only an interrupted initial load when it is shown again.
new ResizeObserver(()=>{if(closedBeforeReady&&document.body.getBoundingClientRect().width&&frame.getBoundingClientRect().height)open()}).observe(document.body);
const poll=setInterval(()=>{stop.disabled=!(ready&&api()?.active);if(ready&&api()?.active)status.textContent='Converting locally…';else if(ready&&status.textContent==='Converting locally…')status.textContent='Local conversion · download results to keep them'},300);
window.addEventListener('pagehide',()=>{clearInterval(poll);clearTimeout(timer)});
setupApp('vert',theme);open();
