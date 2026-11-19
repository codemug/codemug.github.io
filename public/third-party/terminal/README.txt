WebPC Linux Terminal -- third-party software and source provenance

v86 0.5.473 (source commit 315b2b0b758703ef0e6cc7b4088d6068f83f3c20)
https://github.com/copy/v86/tree/315b2b0b758703ef0e6cc7b4088d6068f83f3c20
BSD-2-Clause; see v86-LICENSE.txt. The runtime also includes dependencies
with their own notices in the upstream source (including SoftFloat and zstd).
https://github.com/copy/v86/tree/315b2b0b758703ef0e6cc7b4088d6068f83f3c20
See also v86-LICENSE.MIT.txt, softfloat-NOTICES.txt, zstddeclib-NOTICES.txt
and zstd-LICENSE.txt (Zstandard 1.4.5).

SeaBIOS and VGA BIOS are the unmodified binaries at that same v86 commit.
The upstream build recipe pins SeaBIOS rel-1.16.2 and its config files:
https://github.com/copy/v86/blob/315b2b0b758703ef0e6cc7b4088d6068f83f3c20/bios/fetch-and-build-seabios.sh
https://git.seabios.org/seabios.git/tag/?h=rel-1.16.2
SeaBIOS LGPL-3.0 (some files GPL-3.0 and BSD/MIT); upstream COPYING,
COPYING.LESSER, source notices and configs govern their respective files.
See SeaBIOS-COPYING.txt and SeaBIOS-COPYING.LESSER.txt.

Alpine Linux 3.22 x86 guest
Base: i386/alpine@sha256:b9932cfb425cd3dcccdc6c954227ffc6289693b1460dc10f7874299615bb6cda
https://hub.docker.com/r/i386/alpine
All 84 installed packages, exact versions, SPDX license expressions,
upstream URLs and Alpine source-build commits are in packages.lock.json.
This is not one uniformly licensed program: examples include Linux/BusyBox
GPL-2.0-only, Bash/coreutils GPL-3.0-or-later, Python PSF-2.0, Node.js MIT,
and musl MIT. License texts in the guest are retained where packaged.
The WebPC recipe does not alter their program binaries.

For each package, use its sourceCommit and origin from packages.lock.json:
https://gitlab.alpinelinux.org/alpine/aports/-/tree/<sourceCommit>/main/<origin>
or the community/<origin> directory where that origin lives. Each APKBUILD
contains the source archive URLs/checksums, patches, build configuration and
license details for that exact package revision. The pinned aports mirror:
https://github.com/alpinelinux/aports/tree/<sourceCommit>/main/<origin>
Alpine's source archive mirror: https://distfiles.alpinelinux.org/distfiles/
Package browser: https://pkgs.alpinelinux.org/packages?branch=v3.22&arch=x86

WebPC guest modifications and generation instructions are maintained in the
repository's scripts/pc/linux/{Dockerfile,flatten.py,packages.lock.json}
and scripts/pc/prepare-terminal.mjs. docs/webpc/linux-terminal.md describes
reproduction, checkpoint compatibility and hosting limitations. Retain these
source references and all applicable notices with redistributed images;
source-distribution obligations for copyleft components still apply.

xterm.js 5.5.0, addon-fit 0.10.0, addon-serialize 0.13.0
https://github.com/xtermjs/xterm.js -- MIT, see xterm-LICENSE.txt.
