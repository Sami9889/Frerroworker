'use strict';

import * as THREE from 'three';
import { init as initViewer, addToScene, removeFromScene, clearGroup, fitCameraToObjects, disposeMesh, getSliceGroup, getPreviewGroup, getGrid, getAxes } from './viewer.js';
import { loadGeometry } from './parsers.js';
import { sliceModels, offsetPolygon, generateInfill } from './slicer.js';
import { generateGcode } from './gcode.js';

const STATE = {
  mode: 'fdm',
  models: [],
  selectedId: null,
  nextId: 1,
  layers: [],
  sliced: false,
  settings: {}
};

const MODE_COLORS = { fdm: 0xcccccc, laser: 0xb5451b, cnc: 0x858585 };

let appCamera = null;

export function initApp() {
  const viewer = initViewer('viewer3d');
  appCamera = viewer.camera;

  STATE.settings = getSettingsFromDOM();

  setupEventListeners();
  setupDragDrop();
  updateModelList();
}

function getSettingsFromDOM() {
  return {
    layerHeight: 0.2, lineWidth: 0.4, infill: 20, infillPattern: 'lines',
    printSpeed: 60, travelSpeed: 120, nozzleTemp: 200, bedTemp: 60,
    perimeters: 2, bottomLayers: 3, topLayers: 3, fanSpeed: 100, retraction: 6,
    laserPower: 10, laserSpeed: 1000, laserPasses: 1, laserMode: 'engrave',
    spindleSpeed: 12000, feedRate: 800, plungeRate: 200, depthPerPass: 1.5, toolDiameter: 3.175, cncOp: 'contour'
  };
}

function setupEventListeners() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => setMode(tab.dataset.mode));
  });

  document.getElementById('btnAddFiles').addEventListener('click', () => document.getElementById('fileInput').click());
  document.getElementById('fileInput').addEventListener('change', e => {
    Array.from(e.target.files).forEach(file => loadFile(file));
    e.target.value = '';
  });

  document.getElementById('btnClearAll').addEventListener('click', () => {
    if (STATE.models.length && confirm('Remove all models?')) clearAllModels();
  });

  document.getElementById('btnSlice').addEventListener('click', sliceCurrent);
  document.getElementById('btnPreview').addEventListener('click', previewLayers);
  document.getElementById('btnDownload').addEventListener('click', downloadGcode);
  document.getElementById('btnApplyTransform').addEventListener('click', applyTransform);
  document.getElementById('btnShowLayer').addEventListener('click', showCurrentLayer);
  document.getElementById('layerSlider').addEventListener('input', e => showLayer(parseInt(e.target.value)));
  document.getElementById('modelScale').addEventListener('input', e => document.getElementById('scaleVal').textContent = e.target.value + '%');
  document.getElementById('infill').addEventListener('input', e => document.getElementById('infillVal').textContent = e.target.value + '%');

  document.getElementById('viewTop').addEventListener('click', () => { viewerNavigate([0, 500, 0.01], [0, 0, 0]); });
  document.getElementById('viewFront').addEventListener('click', () => { viewerNavigate([0, 0, 500], [0, 0, 0]); });
  document.getElementById('viewSide').addEventListener('click', () => { viewerNavigate([500, 0, 0.01], [0, 0, 0]); });
  document.getElementById('viewIso').addEventListener('click', fitView);
  document.getElementById('toggleGrid').addEventListener('click', function() { getGrid().visible = !getGrid().visible; this.classList.toggle('active'); });
  document.getElementById('toggleAxes').addEventListener('click', function() { getAxes().visible = !getAxes().visible; this.classList.toggle('active'); });
  document.getElementById('toggleWireframe').addEventListener('click', toggleWireframe);
  document.getElementById('centerModel').addEventListener('click', centerSelected);

  setupViewerInteraction();
}

function viewerNavigate(pos, target) {
  appCamera.position.set(pos[0], pos[1], pos[2]);
  appCamera.lookAt(target[0], target[1], target[2]);
}

function fitView() {
  const visible = STATE.models.filter(m => m.visible).map(m => m.mesh);
  fitCameraToObjects(visible);
}

function toggleWireframe() {
  const m = getSelected();
  if (m && m.mesh && m.mesh.material) {
    m.mesh.material.wireframe = !m.mesh.material.wireframe;
    this.classList.toggle('active');
  }
}

function centerSelected() {
  const m = getSelected();
  if (!m) return;
  m.mesh.position.set(0, 0, 0);
  m.mesh.rotation.set(0, 0, 0);
  m.mesh.scale.set(1, 1, 1);
  syncTransformUI(m);
  fitView();
}

function setupViewerInteraction() {
  const el = document.getElementById('viewer3d');
  let dragging = false, prev = { x: 0, y: 0 };

  el.addEventListener('mousedown', e => { dragging = true; prev = { x: e.clientX, y: e.clientY }; });
  window.addEventListener('mouseup', () => dragging = false);
  window.addEventListener('mousemove', e => {
    if (!dragging) return;
    const m = getSelected();
    if (m && m.mesh) {
      m.mesh.rotation.y += (e.clientX - prev.x) * 0.01;
      m.mesh.rotation.x += (e.clientY - prev.y) * 0.01;
    }
    prev = { x: e.clientX, y: e.clientY };
  });
  el.addEventListener('wheel', e => {
    e.preventDefault();
    const factor = 1 + e.deltaY * 0.001;
    window.appCamera.position.multiplyScalar(factor);
  }, { passive: false });
}

function setupDragDrop() {
  const dz = document.getElementById('dropZone');
  document.body.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('active'); });
  document.body.addEventListener('dragleave', e => { if (e.relatedTarget === null) dz.classList.remove('active'); });
  document.body.addEventListener('drop', e => {
    e.preventDefault(); dz.classList.remove('active');
    if (e.dataTransfer.files.length) Array.from(e.dataTransfer.files).forEach(f => loadFile(f));
  });
}

function setMode(mode) {
  STATE.mode = mode;
  document.getElementById('modeBadge').textContent = mode === 'fdm' ? '3D PRINT' : mode === 'laser' ? 'LASER' : 'CNC';
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.mode === mode));
  document.getElementById('laserSection').style.display = mode === 'laser' ? 'block' : 'none';
  document.getElementById('cncSection').style.display = mode === 'cnc' ? 'block' : 'none';
  STATE.models.forEach(m => { if (m.mesh && m.mesh.material) m.mesh.material.color.setHex(MODE_COLORS[mode] || MODE_COLORS.fdm); });
}

function getSelected() {
  return STATE.models.find(m => m.id === STATE.selectedId) || STATE.models[0] || null;
}

async function loadFile(file) {
  try {
    const { geometry, name } = await loadGeometry(file);
    addModelToScene(geometry, name);
  } catch (err) {
    log('Failed to load ' + file.name + ': ' + err.message, 'error');
  }
}

function addModelToScene(geometry, name) {
  geometry.computeBoundingBox();
  geometry.computeVertexNormals();
  geometry.center();
  const bb = geometry.boundingBox;
  geometry.translate(0, -bb.min.y, 0);
  geometry.computeBoundingBox();

  const material = new THREE.MeshPhongMaterial({
    color: MODE_COLORS[STATE.mode], specular: 0x222222, shininess: 30,
    flatShading: false, side: THREE.DoubleSide, transparent: true, opacity: 0.9
  });
  const mesh = new THREE.Mesh(geometry, material);
  const id = STATE.nextId++;
  const model = { id, mesh, name, visible: true };
  STATE.models.push(model);
  addToScene(mesh);
  if (STATE.models.length === 1) STATE.selectedId = id;

  const size = new THREE.Vector3();
  geometry.boundingBox.getSize(size);
  log('Loaded ' + name + ' (' + size.x.toFixed(1) + ' x ' + size.y.toFixed(1) + ' x ' + size.z.toFixed(1) + ' mm)', 'info');
  updateModelList();
  updateInfo();
  enableActions();
  fitView();
  log(STATE.models.length + ' model(s) in scene', 'info');
}

function updateModelList() {
  const list = document.getElementById('modelList');
  list.innerHTML = '';
  list.style.display = STATE.models.length ? 'block' : 'none';
  STATE.models.forEach(m => {
    const item = document.createElement('div');
    item.className = 'model-item' + (m.id === STATE.selectedId ? ' selected' : '');
    item.innerHTML = '<button class="vis" data-id="' + m.id + '">' + (m.visible ? '◉' : '○') + '</button>' +
      '<span class="name" data-id="' + m.id + '">' + m.name + '</span>' +
      '<button class="rm" data-id="' + m.id + '">×</button>';

    item.querySelector('.vis').addEventListener('click', e => { e.stopPropagation(); toggleModelVisibility(m.id); });
    item.querySelector('.name').addEventListener('click', () => selectModel(m.id));
    item.querySelector('.rm').addEventListener('click', e => { e.stopPropagation(); removeModel(m.id); });
    list.appendChild(item);
  });
  updateInfo();
}

function toggleModelVisibility(id) {
  const m = STATE.models.find(x => x.id === id);
  if (!m) return;
  m.visible = !m.visible;
  m.mesh.visible = m.visible;
  updateModelList();
}

function selectModel(id) {
  STATE.selectedId = id;
  updateModelList();
  const m = getSelected();
  if (m) syncTransformUI(m);
}

function removeModel(id) {
  const idx = STATE.models.findIndex(m => m.id === id);
  if (idx === -1) return;
  disposeMesh(STATE.models[idx].mesh);
  STATE.models.splice(idx, 1);
  if (STATE.selectedId === id) STATE.selectedId = STATE.models.length ? STATE.models[0].id : null;
  updateModelList();
  if (!STATE.models.length) { disableActions(); clearPreview(); }
  fitView();
}

function clearAllModels() {
  STATE.models.forEach(m => disposeMesh(m.mesh));
  STATE.models = [];
  STATE.selectedId = null;
  disableActions();
  clearPreview();
  updateModelList();
  fitView();
}

function syncTransformUI(m) {
  if (!m) return;
  document.getElementById('modelScale').value = Math.round(m.mesh.scale.x * 100);
  document.getElementById('scaleVal').textContent = Math.round(m.mesh.scale.x * 100) + '%';
  document.getElementById('rotX').value = Math.round(THREE.MathUtils.radToDeg(m.mesh.rotation.x));
  document.getElementById('rotZ').value = Math.round(THREE.MathUtils.radToDeg(m.mesh.rotation.z));
  document.getElementById('posX').value = Math.round(m.mesh.position.x);
  document.getElementById('posY').value = Math.round(m.mesh.position.y);
}

function applyTransform() {
  const m = getSelected();
  if (!m) return;
  const scale = parseFloat(document.getElementById('modelScale').value) / 100;
  const rx = THREE.MathUtils.degToRad(parseFloat(document.getElementById('rotX').value) || 0);
  const rz = THREE.MathUtils.degToRad(parseFloat(document.getElementById('rotZ').value) || 0);
  const px = parseFloat(document.getElementById('posX').value) || 0;
  const py = parseFloat(document.getElementById('posY').value) || 0;
  m.mesh.scale.set(scale, scale, scale);
  m.mesh.rotation.set(rx, 0, rz);
  m.mesh.position.set(px, py, 0);
  m.mesh.updateMatrixWorld(true);
  if (STATE.sliced) { log('Re-slice needed after transform', 'warn'); STATE.sliced = false; clearPreview(); }
}

function sliceCurrent() {
  if (!STATE.models.length) return;
  clearPreview();
  log('Slicing ' + STATE.models.length + ' model(s)...', 'info');
  setProgress(5);
  const lh = parseFloat(document.getElementById('layerHeight').value) || 0.2;
  STATE.layers = sliceModels(STATE.models, lh, pct => setProgress(pct));
  STATE.sliced = true;
  document.getElementById('layerSlider').max = STATE.layers.length;
  document.getElementById('layerSlider').value = 0;
  document.getElementById('btnShowLayer').disabled = false;
  setProgress(100);
  const totalContours = STATE.layers.reduce((s, l) => s + l.polygons.length, 0);
  log('Slice complete: ' + STATE.layers.length + ' layers, ' + totalContours + ' contours', 'info');
  updateInfo();
}

function previewLayers() {
  if (!STATE.sliced) sliceCurrent();
  if (!STATE.layers.length) return;
  showLayer(0);
}

function showLayer(idx) {
  clearGroup(getPreviewGroup());
  if (idx < 0 || idx >= STATE.layers.length) return;
  const layer = STATE.layers[idx];
  layer.polygons.forEach(poly => {
    if (poly.length < 2) return;
    const pts = poly.map(p => new THREE.Vector3(p.x, p.y, layer.z));
    const geom = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({ color: 0xb5451b });
    getPreviewGroup().add(new THREE.Line(geom, mat));
  });
  document.getElementById('layerLabel').textContent = (idx + 1) + '/' + STATE.layers.length;
}

function showCurrentLayer() { showLayer(parseInt(document.getElementById('layerSlider').value)); }

function downloadGcode() {
  if (!STATE.sliced || !STATE.layers.length) { log('Slice first', 'warn'); return; }
  const s = readSettings();
  const gcode = generateGcode(STATE.mode, STATE.layers, s, STATE.models.length);
  const blob = new Blob([gcode], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'ferroworker_' + STATE.mode + '_' + Date.now() + '.gcode';
  a.click();
  URL.revokeObjectURL(url);
  log('G-code downloaded', 'info');
  const preview = document.getElementById('gcodePreview');
  preview.style.display = 'block';
  preview.textContent = gcode.slice(0, 6000) + (gcode.length > 6000 ? '\n; ... truncated ...' : '');
}

function readSettings() {
  return {
    layerHeight: parseFloat(document.getElementById('layerHeight').value) || 0.2,
    lineWidth: parseFloat(document.getElementById('lineWidth').value) || 0.4,
    infill: parseFloat(document.getElementById('infill').value) || 20,
    infillPattern: document.getElementById('infillPattern').value,
    printSpeed: parseFloat(document.getElementById('printSpeed').value) || 60,
    travelSpeed: parseFloat(document.getElementById('travelSpeed').value) || 120,
    nozzleTemp: parseFloat(document.getElementById('nozzleTemp').value) || 200,
    bedTemp: parseFloat(document.getElementById('bedTemp').value) || 60,
    perimeters: parseInt(document.getElementById('perimeters').value) || 2,
    bottomLayers: parseInt(document.getElementById('bottomLayers').value) || 3,
    topLayers: parseInt(document.getElementById('topLayers').value) || 3,
    fanSpeed: parseFloat(document.getElementById('fanSpeed').value) || 100,
    retraction: parseFloat(document.getElementById('retraction').value) || 6,
    laserPower: parseFloat(document.getElementById('laserPower').value) || 10,
    laserSpeed: parseFloat(document.getElementById('laserSpeed').value) || 1000,
    laserPasses: parseInt(document.getElementById('laserPasses').value) || 1,
    laserMode: document.getElementById('laserMode').value,
    spindleSpeed: parseFloat(document.getElementById('spindleSpeed').value) || 12000,
    feedRate: parseFloat(document.getElementById('feedRate').value) || 800,
    plungeRate: parseFloat(document.getElementById('plungeRate').value) || 200,
    depthPerPass: parseFloat(document.getElementById('depthPerPass').value) || 1.5,
    toolDiameter: parseFloat(document.getElementById('toolDiameter').value) || 3.175,
    cncOp: document.getElementById('cncOp').value
  };
}

function updateInfo() {
  document.getElementById('modelCount').textContent = STATE.models.length;
  const sel = getSelected();
  document.getElementById('selectedName').textContent = sel ? sel.name : 'None';
  document.getElementById('layerCount').textContent = STATE.layers.length;
}

function enableActions() {
  ['btnSlice', 'btnPreview', 'btnDownload'].forEach(id => document.getElementById(id).disabled = false);
}
function disableActions() {
  ['btnSlice', 'btnPreview', 'btnDownload', 'btnShowLayer'].forEach(id => document.getElementById(id).disabled = true);
}
function clearPreview() {
  clearGroup(getSliceGroup());
  clearGroup(getPreviewGroup());
  STATE.layers = [];
  STATE.sliced = false;
  document.getElementById('layerSlider').max = 0;
  document.getElementById('layerSlider').value = 0;
  document.getElementById('layerLabel').textContent = '0/0';
  document.getElementById('gcodePreview').style.display = 'none';
  updateInfo();
}

function log(msg, type) {
  const el = document.getElementById('log');
  el.style.display = 'block';
  const line = document.createElement('div');
  line.className = 'log-line ' + (type || '');
  line.textContent = '[' + new Date().toLocaleTimeString() + '] ' + msg;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}

function setProgress(pct) {
  const wrap = document.getElementById('progress');
  const bar = document.getElementById('progressBar');
  wrap.style.display = 'block';
  bar.style.width = pct + '%';
  if (pct >= 100) setTimeout(() => wrap.style.display = 'none', 400);
}
