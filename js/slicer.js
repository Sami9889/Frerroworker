'use strict';

import * as THREE from 'three';

export function sliceModels(models, layerHeight, onProgress) {
  const triangles = [];
  models.forEach(m => {
    if (!m.visible || !m.mesh) return;
    const geom = m.mesh.geometry;
    const pos = geom.attributes.position.array;
    for (let i = 0; i < pos.length; i += 9) {
      const v0 = new THREE.Vector3(pos[i], pos[i+1], pos[i+2]);
      const v1 = new THREE.Vector3(pos[i+3], pos[i+4], pos[i+5]);
      const v2 = new THREE.Vector3(pos[i+6], pos[i+7], pos[i+8]);
      v0.applyMatrix4(m.mesh.matrixWorld);
      v1.applyMatrix4(m.mesh.matrixWorld);
      v2.applyMatrix4(m.mesh.matrixWorld);
      triangles.push([v0, v1, v2]);
    }
  });

  if (!triangles.length) return [];

  let minZ = Infinity, maxZ = -Infinity;
  triangles.forEach(tri => {
    tri.forEach(v => {
      if (v.z < minZ) minZ = v.z;
      if (v.z < maxZ) maxZ = v.z;
    });
  });

  const numLayers = Math.max(1, Math.ceil((maxZ - minZ) / layerHeight));
  const layers = [];
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

  for (let l = 0; l < numLayers; l++) {
    if (onProgress) onProgress(5 + (l / numLayers) * 80);
    const z = minZ + l * layerHeight + layerHeight * 0.5;
    plane.constant = -z;
    const segments = [];

    for (let t = 0; t < triangles.length; t++) {
      const tri = triangles[t];
      const d0 = plane.distanceToPoint(tri[0]);
      const d1 = plane.distanceToPoint(tri[1]);
      const d2 = plane.distanceToPoint(tri[2]);
      const sides = [Math.sign(d0), Math.sign(d1), Math.sign(d2)];
      if (sides[0] === 0 && sides[1] === 0 && sides[2] === 0) continue;
      if (sides[0] === sides[1] && sides[1] === sides[2]) continue;

      let p1 = null, p2 = null;
      for (let e = 0; e < 3; e++) {
        const a = tri[e], b = tri[(e + 1) % 3];
        const da = plane.distanceToPoint(a), db = plane.distanceToPoint(b);
        if ((da <= 0 && db >= 0) || (da >= 0 && db <= 0)) {
          const t = Math.abs(da) / (Math.abs(da) + Math.abs(db) || 1);
          const pt = new THREE.Vector3().lerpVectors(a, b, t);
          if (!p1) p1 = pt; else p2 = pt;
        }
      }
      if (p1 && p2) segments.push([p1.clone(), p2.clone()]);
    }

    const polygons = stitchSegments(segments);
    layers.push({ z, polygons });
  }

  return layers;
}

function stitchSegments(segments) {
  if (!segments.length) return [];
  const used = new Array(segments.length).fill(false);
  const polygons = [];

  for (let start = 0; start < segments.length; start++) {
    if (used[start]) continue;
    const poly = [];
    let cur = start, prevEnd = null;
    while (!used[cur]) {
      used[cur] = true;
      const seg = segments[cur];
      let add;
      if (!prevEnd) { add = seg[0].clone(); prevEnd = seg[1].clone(); }
      else {
        const d0 = prevEnd.distanceToSquared(seg[0]), d1 = prevEnd.distanceToSquared(seg[1]);
        if (d0 < d1) { add = seg[0].clone(); prevEnd = seg[1].clone(); }
        else { add = seg[1].clone(); prevEnd = seg[0].clone(); }
      }
      poly.push(add);
      if (poly.length > 2 && prevEnd.distanceToSquared(poly[0]) < 0.01) { poly.push(poly[0].clone()); break; }
      let next = -1;
      for (let i = 0; i < segments.length; i++) {
        if (used[i]) continue;
        const s = segments[i];
        if (prevEnd.distanceToSquared(s[0]) < 0.01 || prevEnd.distanceToSquared(s[1]) < 0.01) { next = i; break; }
      }
      if (next === -1) break;
      cur = next;
    }
    if (poly.length >= 3) polygons.push(poly);
  }
  return polygons;
}

export function generateInfill(poly, lineWidth, density, pattern) {
  if (density <= 0) return [];
  const bb = new THREE.Box2().setFromPoints(poly.map(p => new THREE.Vector2(p.x, p.y)));
  const spacing = lineWidth / Math.max(density, 0.01);
  const lines = [];

  if (pattern === 'lines' || pattern === 'zigzag') {
    for (let x = bb.min.x; x <= bb.max.x; x += spacing) {
      const segs = clipLineToPoly(new THREE.Vector2(x, bb.min.y - 10), new THREE.Vector2(x, bb.max.y + 10), poly);
      segs.forEach(s => lines.push(s));
    }
    if (pattern === 'zigzag') {
      for (let i = 0; i < lines.length - 1; i++) {
        if (i % 2 === 0 && lines[i][1].y < lines[i+1][0].y) lines[i] = [lines[i][0], lines[i+1][1]];
      }
    }
  } else if (pattern === 'grid') {
    for (let x = bb.min.x; x <= bb.max.x; x += spacing) {
      const segs = clipLineToPoly(new THREE.Vector2(x, bb.min.y - 10), new THREE.Vector2(x, bb.max.y + 10), poly);
      segs.forEach(s => lines.push(s));
    }
    for (let y = bb.min.y; y <= bb.max.y; y += spacing) {
      const segs = clipLineToPoly(new THREE.Vector2(bb.min.x - 10, y), new THREE.Vector2(bb.max.x + 10, y), poly);
      segs.forEach(s => lines.push(s));
    }
  } else if (pattern === 'triangles') {
    const h = bb.max.y - bb.min.y;
    for (let row = 0; row * spacing < h + spacing; row++) {
      const y0 = bb.min.y + row * spacing;
      const y1 = bb.min.y + (row + 0.5) * spacing;
      const y2 = bb.min.y + (row + 1) * spacing;
      clipLineToPoly(new THREE.Vector2(bb.min.x - 10, y0), new THREE.Vector2(bb.max.x + 10, y0), poly).forEach(s => lines.push(s));
      clipLineToPoly(new THREE.Vector2(bb.min.x - 10 + spacing/2, y1), new THREE.Vector2(bb.max.x + 10 + spacing/2, y1), poly).forEach(s => lines.push(s));
      clipLineToPoly(new THREE.Vector2(bb.min.x - 10, y2), new THREE.Vector2(bb.max.x + 10, y2), poly).forEach(s => lines.push(s));
    }
  } else if (pattern === 'honeycomb') {
    const h = bb.max.y - bb.min.y;
    for (let row = -1; row * spacing * 0.866 < h + spacing; row++) {
      const y0 = bb.min.y + row * spacing * 0.866;
      const xOff = (row % 2) * spacing * 0.5;
      clipLineToPoly(new THREE.Vector2(bb.min.x - 10 + xOff, y0), new THREE.Vector2(bb.max.x + 10 + xOff, y0), poly).forEach(s => lines.push(s));
    }
  } else if (pattern === 'cubic') {
    const h = bb.max.y - bb.min.y;
    for (let row = 0; row * spacing < h + spacing; row++) {
      const y0 = bb.min.y + row * spacing;
      const y1 = bb.min.y + (row + 0.5) * spacing;
      clipLineToPoly(new THREE.Vector2(bb.min.x - 10, y0), new THREE.Vector2(bb.max.x + 10, y0), poly).forEach(s => lines.push(s));
      clipLineToPoly(new THREE.Vector2(bb.min.x - 10 + spacing/2, y1), new THREE.Vector2(bb.max.x + 10 + spacing/2, y1), poly).forEach(s => lines.push(s));
    }
  } else if (pattern === 'octet') {
    const h = bb.max.y - bb.min.y;
    for (let row = 0; row * spacing * 0.866 < h + spacing; row++) {
      const y0 = bb.min.y + row * spacing * 0.866;
      const xOff = (row % 2) * spacing * 0.5;
      clipLineToPoly(new THREE.Vector2(bb.min.x - 10 + xOff, y0), new THREE.Vector2(bb.max.x + 10 + xOff, y0), poly).forEach(s => lines.push(s));
      clipLineToPoly(new THREE.Vector2(bb.min.x - 10 + xOff + spacing/2, y0 + spacing * 0.433), new THREE.Vector2(bb.max.x + 10 + xOff + spacing/2, y0 + spacing * 0.433), poly).forEach(s => lines.push(s));
    }
  } else if (pattern === 'gyroid') {
    const w = bb.max.x - bb.min.x;
    const h = bb.max.y - bb.min.y;
    const step = spacing;
    for (let x = bb.min.x; x <= bb.max.x; x += step) {
      const yOff = Math.sin(x * 0.5) * step * 0.5;
      clipLineToPoly(new THREE.Vector2(x, bb.min.y - 10 + yOff), new THREE.Vector2(x, bb.max.y + 10 + yOff), poly).forEach(s => lines.push(s));
    }
    for (let y = bb.min.y; y <= bb.max.y; y += step) {
      const xOff = Math.sin(y * 0.5) * step * 0.5;
      clipLineToPoly(new THREE.Vector2(bb.min.x - 10 + xOff, y), new THREE.Vector2(bb.max.x + 10 + xOff, y), poly).forEach(s => lines.push(s));
    }
  }
  return lines;
}

function clipLineToPoly(a, b, poly) {
  const result = [];
  const dx = b.x - a.x, dy = b.y - a.y;
  const pts = [];
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    const ex = poly[j].x - poly[i].x, ey = poly[j].y - poly[i].y;
    const denom = dx * ey - dy * ex;
    if (Math.abs(denom) < 1e-10) continue;
    const t = ((poly[i].x - a.x) * ey - (poly[i].y - a.y) * ex) / denom;
    const u = ((poly[i].x - a.x) * dy - (poly[i].y - a.y) * dx) / (-denom);
    if (t >= -1e-9 && t <= 1 + 1e-9 && u >= -1e-9 && u <= 1 + 1e-9) pts.push(Math.max(0, Math.min(1, t)));
  }
  pts.sort((a, b) => a - b);
  const unique = [];
  for (const p of pts) { if (!unique.length || Math.abs(p - unique[unique.length-1]) > 1e-6) unique.push(p); }
  if (pointInPoly(a, poly) && pointInPoly(b, poly)) { result.push([a.clone(), b.clone()]); }
  else { for (let i = 0; i < unique.length - 1; i += 2) result.push([new THREE.Vector2(a.x + dx*unique[i], a.y + dy*unique[i]), new THREE.Vector2(a.x + dx*unique[i+1], a.y + dy*unique[i+1])]); }
  return result;
}

function pointInPoly(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if ((yi > p.y) !== (yj > p.y) && p.x < (xj - xi) * (p.y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
