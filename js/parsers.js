'use strict';

import * as THREE from 'three';

export function parseSTL(buffer) {
  const view = new DataView(buffer);
  const faceCount = view.getUint32(80, true);
  const positions = new Float32Array(faceCount * 9);
  let idx = 0;

  for (let i = 0; i < faceCount; i++) {
    const off = 80 + i * 50;
    for (let v = 0; v < 3; v++) {
      positions[idx++] = view.getFloat32(off + 12 + v * 12, true);
      positions[idx++] = view.getFloat32(off + 12 + v * 12 + 4, true);
      positions[idx++] = view.getFloat32(off + 12 + v * 12 + 8, true);
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return geom;
}

export function parseSTLASCII(text) {
  const lines = text.split('\n');
  const positions = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim().toLowerCase();
    if (line.startsWith('vertex')) {
      const parts = line.split(/\s+/);
      positions.push(parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3]));
    }
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return geom;
}

export function parseOBJ(text) {
  const lines = text.split('\n');
  const positions = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('v ')) {
      const parts = line.split(/\s+/);
      positions.push(parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3]));
    } else if (line.startsWith('v')) {
      const parts = line.split(/\s+/);
      if (parts.length >= 4) positions.push(parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3]));
    }
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return geom;
}

export function parsePLY(buffer) {
  const view = new DataView(buffer);
  let offset = 0;
  const header = {};
  let line = '';
  const readLine = () => {
    line = '';
    while (offset < buffer.byteLength) {
      const c = String.fromCharCode(view.getUint8(offset++));
      if (c === '\n') break;
      line += c;
    }
    return line.trim();
  };
  while (offset < buffer.byteLength) {
    const l = readLine();
    if (l === 'end_header') break;
    const parts = l.split(/\s+/);
    if (parts[0] === 'element' && parts[1] === 'vertex') header.vertexCount = parseInt(parts[2]);
    else if (parts[0] === 'property') {
      if (parts[2] === 'x') header.hasX = true;
      else if (parts[2] === 'y') header.hasY = true;
      else if (parts[2] === 'z') header.hasZ = true;
    }
  }
  const positions = [];
  for (let i = 0; i < (header.vertexCount || 0); i++) {
    if (header.hasX) positions.push(view.getFloat32(offset, true));
    offset += 4;
    if (header.hasY) positions.push(view.getFloat32(offset, true));
    offset += 4;
    if (header.hasZ) positions.push(view.getFloat32(offset, true));
    offset += 4;
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return geom;
}

export function parse3MF(buffer) {
  try {
    const text = new TextDecoder().decode(buffer);
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, 'application/xml');
    const vertices = doc.querySelectorAll('vertex');
    const positions = [];
    vertices.forEach(v => {
      const x = parseFloat(v.getAttribute('x'));
      const y = parseFloat(v.getAttribute('y'));
      const z = parseFloat(v.getAttribute('z'));
      if (!isNaN(x) && !isNaN(y) && !isNaN(z)) positions.push(x, y, z);
    });
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    return geom;
  } catch (e) {
    throw new Error('3MF parsing failed: ' + e.message);
  }
}

export function detectSTLType(buffer) {
  const view = new DataView(buffer, 80, 4);
  const faceCount = view.getUint32(0, true);
  return faceCount < 100000000 ? 'binary' : 'ascii';
}

export function loadGeometry(file) {
  const ext = file.name.toLowerCase().split('.').pop();
  return new Promise((resolve, reject) => {
    try {
      if (ext === 'stl') {
        const reader = new FileReader();
        reader.onload = () => {
          try {
            const type = detectSTLType(reader.result);
            const geom = type === 'binary' ? parseSTL(reader.result) : parseSTLASCII(new TextDecoder().decode(reader.result));
            resolve({ geometry: geom, name: file.name });
          } catch (e) { reject(e); }
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(file);
      } else if (ext === 'obj') {
        const reader = new FileReader();
        reader.onload = () => {
          try { resolve({ geometry: parseOBJ(reader.result), name: file.name }); }
          catch (e) { reject(e); }
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsText(file);
      } else if (ext === 'ply') {
        const reader = new FileReader();
        reader.onload = () => {
          try { resolve({ geometry: parsePLY(reader.result), name: file.name }); }
          catch (e) { reject(e); }
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(file);
      } else if (ext === '3mf') {
        const reader = new FileReader();
        reader.onload = () => {
          try { resolve({ geometry: parse3MF(reader.result), name: file.name }); }
          catch (e) { reject(e); }
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(file);
      } else {
        reject(new Error('Unsupported format: ' + ext));
      }
    } catch (e) { reject(e); }
  });
}
