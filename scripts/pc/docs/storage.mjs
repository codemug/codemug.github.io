// Lossless JSON for document packages containing Maps and binary OOXML parts.
export function encode(value) {
  return JSON.stringify(value, (_, item) => {
    if (item instanceof Map) return { $webpc: 'map', value: [...item] };
    if (item instanceof Set) return { $webpc: 'set', value: [...item] };
    if (item instanceof ArrayBuffer) return { $webpc: 'buffer', value: [...new Uint8Array(item)] };
    if (item instanceof Uint8Array) return { $webpc: 'bytes', value: [...item] };
    return item;
  });
}
export function decode(text) {
  return JSON.parse(text, (key, value) => {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Unsupported backup property.');
    if (value?.$webpc) {
      if (!Array.isArray(value.value)) throw new Error('Invalid backup data.');
      if (value.$webpc === 'map') return new Map(value.value);
      if (value.$webpc === 'set') return new Set(value.value);
      if (['buffer', 'bytes'].includes(value.$webpc)) {
        if (value.value.some(n => !Number.isInteger(n) || n < 0 || n > 255)) throw new Error('Invalid binary backup data.');
        const bytes = new Uint8Array(value.value);
        return value.$webpc === 'buffer' ? bytes.buffer : bytes;
      }
      throw new Error('Unknown backup encoding.');
    }
    return value;
  });
}
export function validateDocument(doc) {
  if (!doc?.package || !Array.isArray(doc.package.document?.content)) throw new Error('This is not a valid document.');
  function nodes(items, depth = 0) {
    if (depth > 100 || !Array.isArray(items)) throw new Error('Invalid document content.');
    for (const node of items) {
      if (!node || typeof node !== 'object' || typeof node.type !== 'string') throw new Error('Invalid document node.');
      if ('content' in node) nodes(node.content, depth + 1);
      if (node.type === 'text' && typeof node.text !== 'string') throw new Error('Invalid document text.');
      if ('rows' in node) {
        if (!Array.isArray(node.rows)) throw new Error('Invalid table rows.');
        for (const row of node.rows) {
          if (!Array.isArray(row?.cells)) throw new Error('Invalid table cells.');
          for (const cell of row.cells) nodes(cell?.content, depth + 1);
        }
      }
    }
  }
  nodes(doc.package.document.content);
  return doc;
}
export function documentBackup(name, document) {
  return encode({ format: 'webpc-docs', version: 1, name, document: validateDocument(document) });
}
export function readDocument(text) {
  const data = decode(text);
  if (data?.format !== 'webpc-docs' || data.version !== 1 || typeof data.name !== 'string') throw new Error('Choose a Docs JSON backup from WebPC.');
  validateDocument(data.document);
  return data;
}
