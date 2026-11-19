import { decompressBounded, MAX_STATE_BYTES } from './linux-checkpoint.mjs';
let vm, output = [], timer, initialized = false;
const flush = () => { if (output.length) { const bytes = Uint8Array.from(output); output = []; postMessage({ type: 'output', bytes }, [bytes.buffer]); } };
const hash = async blob => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())), b => b.toString(16).padStart(2, '0')).join('');
const ready = emulator => new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('Linux assets took too long to load. Check the connection and retry.')), 90000);
  emulator.add_listener('emulator-ready', () => { clearTimeout(timeout); resolve(); });
  emulator.add_listener('download-error', event => { clearTimeout(timeout); reject(new Error(`Could not load a Linux asset: ${event.file_name}`)); });
});
async function handle(data) {
  if (data.type === 'init') {
    const { V86 } = await import(/* @vite-ignore */ `${data.base}libv86.mjs`);
    vm = new V86({ wasm_path: `${data.base}v86.wasm`, memory_size: data.vm.memoryMiB * 1024 * 1024, vga_memory_size: data.vm.vgaMiB * 1024 * 1024,
      bios: { url: `${data.base}seabios.bin` }, vga_bios: { url: `${data.base}vgabios.bin` },
      filesystem: { baseurl: `${data.base}rootfs/`, basefs: `${data.base}fs.json` }, bzimage_initrd_from_filesystem: true,
      cmdline: data.vm.cmdline,
      autostart: false, disable_keyboard: true, disable_mouse: true });
    vm.add_listener('serial0-output-byte', byte => { output.push(byte); if (output.length >= 8192) flush(); });
    timer = setInterval(flush, 20);
    await ready(vm); initialized = true;
    if (data.checkpoint) {
      const { header, payload } = data.checkpoint;
      if (await hash(payload) !== header.sha256) throw new Error('Checkpoint checksum failed. Your current session is unchanged.');
      const state = await decompressBounded(payload, header.rawBytes);
      await vm.restore_state(state);
    }
    postMessage({ type: 'initialized' });
  } else if (!initialized) throw new Error('Linux is not ready.');
  else if (data.type === 'input') vm.serial_send_bytes(0, new TextEncoder().encode(data.text));
  else if (data.type === 'run') { vm.run(); postMessage({ type: 'running', id: data.id }); }
  else if (data.type === 'pause') { await vm.stop(); flush(); postMessage({ type: 'paused', id: data.id }); }
  else if (data.type === 'save') {
    await vm.stop(); flush();
    const state = await vm.save_state();
    if (state.byteLength > MAX_STATE_BYTES) throw new Error('VM checkpoint exceeds the supported memory limit.');
    const payload = await new Response(new Blob([state]).stream().pipeThrough(new CompressionStream('gzip'))).blob();
    const sha256 = await hash(payload);
    postMessage({ type: 'saved', id: data.id, payload, sha256, rawBytes: state.byteLength });
    // Caller decides when to resume, after terminal output has drained and storage completes.
  }
}
onmessage = ({ data }) => handle(data).catch(error => postMessage({ type: 'error', id: data.id, message: error.message || String(error) }));
self.addEventListener('unhandledrejection', event => { event.preventDefault(); postMessage({ type: 'error', message: event.reason?.message || 'The Linux worker failed.' }); });
