#!/usr/bin/env python3
"""Bounded-memory, append-only ASAR overlay. Never extracts archive paths."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import struct
import sys

MAX_HEADER = 64 * 1024 * 1024
BLOCK = 4 * 1024 * 1024

def unique_object(pairs):
    out = {}
    for key, value in pairs:
        if key in out:
            raise ValueError('Duplicate JSON key')
        out[key] = value
    return out

def encode_header(header):
    raw = json.dumps(header, ensure_ascii=False, separators=(',', ':')).encode()
    if len(raw) > MAX_HEADER:
        raise ValueError('Header too large')
    padded = (len(raw) + 3) & ~3
    total = 8 + padded
    return struct.pack('<IIII', 4, total, total - 4, len(raw)) + raw + b'\0' * (padded-len(raw)), hashlib.sha256(raw).hexdigest()

class Archive:
    def __init__(self, filename):
        self.file = open(filename, 'rb')
        try:
            first = self.file.read(16)
            if len(first) != 16:
                raise ValueError('Truncated ASAR header')
            size_payload, size, payload, length = struct.unpack('<IIII', first)
            if size_payload != 4 or length > MAX_HEADER or size != 8 + ((length+3)&~3) or payload != size-4:
                raise ValueError('Invalid ASAR header dimensions')
            raw = self.file.read(length)
            if len(raw) != length:
                raise ValueError('Truncated ASAR JSON')
            self.header = json.loads(raw, object_pairs_hook=unique_object)
            if not isinstance(self.header.get('files'), dict):
                raise ValueError('Missing file table')
            self.header_hash = hashlib.sha256(raw).hexdigest()
            self.data_offset = 8 + size
            self.data_size = os.fstat(self.file.fileno()).st_size - self.data_offset
            if self.data_size < 0:
                raise ValueError('Truncated payload')
        except BaseException:
            self.file.close()
            raise
    def close(self): self.file.close()
    def read(self, name, limit=BLOCK):
        path = PurePosixPath(name)
        if not name or path.is_absolute() or '..' in path.parts or '\\' in name:
            raise ValueError('Unsafe archive path')
        entry = self.header
        for part in path.parts:
            entry = entry['files'][part]
        if 'link' in entry or entry.get('unpacked') or 'files' in entry:
            raise ValueError('Entry must be an inline regular file')
        size = entry['size']
        offset = int(entry['offset'])
        if not isinstance(size, int) or isinstance(size, bool) or size < 0 or size > limit or offset < 0 or offset + size > self.data_size:
            raise ValueError('Invalid entry range')
        self.file.seek(self.data_offset + offset)
        value = self.file.read(size)
        if len(value) != size:
            raise ValueError('Truncated entry')
        return value

def patch(source, destination):
    source, destination = Path(source), Path(destination)
    if source.resolve() == destination.resolve() or destination.exists():
        raise ValueError('A new destination is required')
    archive = Archive(source)
    try:
        package = json.loads(archive.read('package.json'), object_pairs_hook=unique_object)
        if 'communityOriginalMain' in package or '.community-bootstrap.cjs' in archive.header['files']:
            raise ValueError('Already patched; rebuild from official input')
        main = package.get('main')
        if not isinstance(main, str) or not main.endswith(('.js', '.cjs')) or package.get('type') == 'module':
            raise ValueError('Unknown upstream entry contract')
        archive.read(main)  # Validate the actual entry, not a guessed filename.
        package['communityOriginalMain'] = main
        package['main'] = '.community-bootstrap.cjs'
        bootstrap = (
            "'use strict';\n"
            "const path=require('node:path');\n"
            "require(path.join(process.resourcesPath,'community/runtime.cjs')).install();\n"
            "require(path.join(__dirname,require('./package.json').communityOriginalMain));\n"
        ).encode()
        additions = {'package.json': json.dumps(package, ensure_ascii=False, separators=(',', ':')).encode(),
                     '.community-bootstrap.cjs': bootstrap}
        offset = archive.data_size
        for name, data in additions.items():
            archive.header['files'][name] = {'size':len(data), 'offset':str(offset), 'integrity': {
                'algorithm':'SHA256', 'hash':hashlib.sha256(data).hexdigest(), 'blockSize':BLOCK,
                'blocks':[hashlib.sha256(data[i:i+BLOCK]).hexdigest() for i in range(0,len(data),BLOCK)]}}
            offset += len(data)
        encoded, digest = encode_header(archive.header)
        with open(destination, 'xb') as output:
            output.write(encoded)
            archive.file.seek(archive.data_offset)
            shutil.copyfileobj(archive.file, output, BLOCK)
            for data in additions.values(): output.write(data)
            output.flush(); os.fsync(output.fileno())
        return digest
    finally:
        archive.close()

if __name__ == '__main__':
    if len(sys.argv) == 3:
        print(patch(sys.argv[1], sys.argv[2]))
    else:
        raise SystemExit('usage: asar.py SOURCE NEW_DESTINATION')
