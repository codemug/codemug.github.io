# Browser-local Linux Terminal

`/pc/apps/terminal/` boots a real 32-bit Alpine Linux guest in v86 0.5.473, inside a dedicated module Worker. xterm.js renders its serial console. This replaces the previous JavaScript command simulator. Bash 5.2.37, GNU coreutils 9.7, Python 3.12.16, Node.js 22.23.5, nano, grep/sed/gawk/findutils and Linux 6.12.117 are pinned in `scripts/pc/linux/packages.lock.json`.

The user explicitly starts the VM. It has 512 MiB guest memory plus emulator/browser overhead; the root filesystem is approximately 154 MB and its content-addressed files load on demand. The initial kernel/initramfs and shell boot normally take tens of seconds. Opening the desktop does not load this guest. Small/mobile devices may run out of memory on large workloads or checkpoints.

## Reproduction and static deployment

`npm ci --ignore-scripts && npm run assets:pc` runs `scripts/pc/prepare-terminal.mjs`. On a clean machine this needs a running Docker daemon supporting `linux/386`, Python 3, and Internet access to Docker Hub, Alpine package repositories, and GitHub. GitHub Actions' Ubuntu runner supplies Docker/Python. Docker runs **only during preparation**; the deployed site is static and needs neither Docker nor a server process. No COOP/COEP headers or cross-origin isolation are required by this v86 configuration.

The recipe uses a pinned Alpine base digest and every installed package's exact version, including transitive packages. APK verifies repository signatures. The pinned BIOS downloads are SHA-256 checked; the installed v86 version is checked before accepting cached output. `flatten.py` removes the Docker marker and ephemeral host/device mounts, normalizes timestamps, and generates a filesystem-v3 manifest with full SHA-256 filenames. The initramfs uses a fixed `SOURCE_DATE_EPOCH`; its cpio build-device fields and gzip metadata are normalized too. The VM image identity hashes this manifest, BIOS digests, WASM **and JavaScript** runtime bytes, memory configuration and kernel command line. Two clean Docker builds/exports produced the same filesystem manifest during implementation.

Generated output lives in ignored `public/pc/vendor/terminal/`; build caches live in `node_modules/.cache/webpc/linux/`. Keep both the manifest and all `rootfs/` files. No single full disk image or network relay is required at runtime. A clean build fails if an exact historical Alpine package is no longer available; it never silently upgrades it. Archive the verified build assets/package sources when distributing a long-lived release. An intentional package/runtime upgrade must regenerate and retest the image and may invalidate older checkpoints. Keep an old deployment with its old assets to recover an old checkpoint; do not spoof the identity guard.

The approximately 154 MB guest adds to the existing office/CyberChef bundles; check the final `dist/` total against GitHub Pages' site limit. Static hosting does not make the VM usable without a connection before the needed guest files have loaded: this is an **offline guest network**, not a service-worker offline-install promise.

## Emulator/kernel compatibility

The pinned command line includes `slub_debug=F`. With the default allocator fast path, repeated immediate Ctrl+C during process startup followed by nano caused an intermittent Linux `__kmalloc_noprof`/9p kernel fault. The same guest with SLUB consistency checking passed repeated early-interrupt/editor cycles. [Linux's SLUB implementation](https://github.com/torvalds/linux/blob/v6.12/mm/slub.c) disables the CMPXCHG allocator fast path for this flag; this is a tested compatibility workaround, not a claim that the upstream emulator/kernel root cause is fully diagnosed. It trades some allocation performance for stability. Keep it with this pinned kernel/runtime and rerun the early-interrupt regression before changing it. The richer userspace is unchanged.

## State, recovery and keyboard behavior

Save session explicitly pauses the VM, captures v86 state (CPU, guest memory, devices and modified 9p inode buffers), compresses it in the worker, and transactionally stores one checkpoint in IndexedDB database `pc-linux-v1`. It resumes if it was running. Guest files already backed by the immutable HTTP filesystem are read again by hash when needed. This is why the exact original guest assets remain necessary after restore. New files and changes to base files are included in checkpoints, not only CPU registers or terminal output. xterm screen/modes/cursor are serialized alongside the VM.

Export session captures the current VM as a `.webpcvm` file. Restore saved/import checks the envelope, image identity, dimensions, declared memory size and gzip payload checksum. Decompression has a hard bound; imported files are at most 256 MiB and raw checkpoint state at most 768 MiB. A candidate worker restores before replacing the existing guest; failed imports preserve the current guest and the previous saved checkpoint. A failed IndexedDB write keeps the previous checkpoint; the current guest can still be exported. The latest browser save is shared across tabs (last successful explicit save wins), and is not a cloud backup. Pausing keeps RAM only; refreshing requires an explicit save/export first.

The old `pc:terminal:v1` localStorage entry is never modified or deleted. Help exposes Export legacy files when it exists, including unreadable raw data. It is a separate JSON backup, not convertible to a VM checkpoint by relabeling it.

Keyboard input goes directly to the guest serial port: Ctrl+C, pipes, job control and interactive editors are Linux behavior. Touch buttons expose Ctrl+C, Tab and Escape. xterm fits desktop resize/maximize, but a serial console cannot infer guest tty dimensions automatically. **Fit guest** explicitly asks for an idle shell and visibly sends `stty rows … cols …`. It never injects commands on resize while a program is running.

## Networking and alternatives

This VM has **no configured network relay**. Its programs cannot automatically access Internet services, package repositories, SSH servers, or host files. A general network requires a separately operated WebSocket/Wisp relay (or another supported v86 networking backend), authentication/security policy and explicit user configuration; none is included or silently connected here. Emulation supports 32-bit x86, not 64-bit Linux programs or multicore guests.

[v86's primary documentation](https://github.com/copy/v86) covers supported guests; its [filesystem](https://github.com/copy/v86/blob/master/docs/filesystem.md) and [networking](https://github.com/copy/v86/blob/master/docs/networking.md) docs explain the 9p and relay interfaces. The recipe is adapted from its [Alpine Docker example](https://github.com/copy/v86/tree/315b2b0b758703ef0e6cc7b4088d6068f83f3c20/tools/docker/alpine).

[WebVM/CheerpX](https://github.com/leaningtech/webvm#license) runs Linux userspace through an x86 JIT and Linux syscall emulation, rather than booting a Linux kernel. WebVM's app is Apache-2.0, but self-hosting CheerpX builds requires a commercial license; its free public-CDN terms differ. Its official server configuration also supplies isolation headers, and networking uses additional infrastructure such as Tailscale. It was not selected for this fully self-hosted static integration. A server-backed terminal would offer native performance and full Linux/network access but needs authenticated, isolated backend sessions; it is a separate deployment design.

## Licensing and validation

`public/third-party/terminal/` contains runtime/BIOS/xterm license texts and a complete installed-package inventory with SPDX identifiers and exact Alpine source-build commits. Linux, BusyBox, Bash and GNU tools have copyleft licenses; the guest is not uniformly BSD/MIT. The inventory links exact APKBUILD sources, patches and upstream source archives. Preserve applicable notices and source-distribution obligations when distributing the guest. No deployment or new license terms are implied by this local prototype.

DOM-free checkpoint envelope/decompression tests are in `tests/pc-utilities.test.mjs`; real Chromium VM behavior is covered in `tests/browser/pc-linux.spec.mjs`. Other utilities remain in `pc-utilities.spec.mjs`. Tests execute actual Linux commands and inspect guest file contents after restore, not only UI labels.
