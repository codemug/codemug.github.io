#!/usr/bin/env python3
"""Convert a Docker rootfs tar to deterministic v86 filesystem-v3 + SHA256 files.

Same documented format as v86/tools/fs2json.py; use full hashes, normalized times,
and no Docker marker, devices, sockets, or ephemeral host mounts.
"""
import hashlib
import gzip
import json
import pathlib
import stat
import sys
import tarfile

archive, destination, epoch = sys.argv[1], pathlib.Path(sys.argv[2]), int(sys.argv[3])
files = destination / 'rootfs'
files.mkdir(parents=True, exist_ok=True)
nodes = {}
def normalize_initramfs(data):
    # mkinitfs normalizes timestamps/inodes, but cpio records the Docker
    # filesystem's device major/minor. They must not change checkpoint IDs.
    archive = bytearray(gzip.decompress(data))
    offset = 0
    while archive[offset:offset + 6] == b'070701':
        fields = [int(archive[offset + 6 + i * 8:offset + 14 + i * 8], 16) for i in range(13)]
        archive[offset + 6 + 7 * 8:offset + 6 + 9 * 8] = b'0000000000000000'
        offset = (offset + 110 + fields[11] + 3) & ~3
        offset = (offset + fields[6] + 3) & ~3
    compressed = bytearray(gzip.compress(archive, compresslevel=9, mtime=0))
    compressed[9] = 255  # No build-host OS in the gzip header.
    return bytes(compressed)
with tarfile.open(archive) as source:
    for member in source.getmembers():
        path = pathlib.PurePosixPath(member.name)
        if path.is_absolute() or '..' in path.parts:
            raise ValueError('Unsafe archive path: ' + member.name)
        name = str(path)
        if name in ('.', '.dockerenv') or path.parts[0] in ('proc', 'sys', 'dev'):
            continue
        node = [path.name, 0, epoch, member.mode, member.uid, member.gid]
        if member.isdir():
            node[3] |= stat.S_IFDIR
            node.append([])
        elif member.issym():
            node[3] |= stat.S_IFLNK
            node.append(member.linkname)
        elif member.isfile() or member.islnk():
            overrides = {'etc/hostname': b'webpc\n', 'etc/hosts': b'127.0.0.1 localhost webpc\n', 'etc/resolv.conf': b'# Offline guest: no network relay configured.\n'}
            data = overrides.get(name)
            if data is None:
                data = source.extractfile(member).read()
            if name == 'boot/initramfs-virt':
                data = normalize_initramfs(data)
            digest = hashlib.sha256(data).hexdigest()
            (files / (digest + '.bin')).write_bytes(data)
            node[1] = len(data)
            node[3] |= stat.S_IFREG
            node.append(digest + '.bin')
        else:
            continue
        nodes[name] = node
for name in ('dev', 'proc', 'sys'):
    nodes[name] = [name, 0, epoch, stat.S_IFDIR | 0o755, 0, 0, []]
root = []
for path, node in sorted(nodes.items()):
    parent = str(pathlib.PurePosixPath(path).parent)
    (root if parent == '.' else nodes[parent][6]).append(node)
manifest = {'version': 3, 'size': sum(n[1] for n in nodes.values()), 'fsroot': root}
(destination / 'fs.json').write_text(json.dumps(manifest, separators=(',', ':')))
print('Guest files:', len(nodes), '| logical bytes:', manifest['size'])
