'use strict';

import * as THREE from 'three';
import { init as initViewer, addToScene, clearGroup, fitCameraToObjects, disposeMesh, getPreviewGroup, getGrid, getAxes } from './viewer.js';
import { loadGeometry } from './parsers.js';
import { sliceModels } from './slicer.js';
import { generateGcode } from './gcode.js';

const STATE = {
  mode: 'fdm',
  models: [],
  selectedId: null,
  nextId: 1,
  layers: [],
  sliced: false,
  undoStack: [],
  redoStack: [],
  contextTarget: null
};

const MODE_COLORS = { fdm: 0xb8b8b8, laser: 0xb5451b, cnc: 0x858585 };

let appCamera = null;
let contextMenu = null;

export function initApp() {
  const viewer = initViewer('viewer3d');
  appCamera = viewer.camera;
  contextMenu = document.getElementById('contextMenu');

  setupEventListeners();
  setupDragDrop();
  setupCollapsibles();
  setupKeyboardShortcuts();
  setupContextMenu();
  updateModelList();
}

function setupEventListeners() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => setMode(tab.dataset.mode));
  });

  document.getElementById('btnAddFiles').addEventListener('click', () => document.getElementById('fileInput').click());
  document.getElementById('btnLoadViewer').addEventListener('click', () => document.getElementById('fileInput').click());
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
  document.getElementById('btnUndo').addEventListener('click', undoTransform);
  document.getElementById('btnRedo').addEventListener('click', redoTransform);
  document.getElementById('btnShowLayer').addEventListener('click', showCurrentLayer);
  document.getElementById('layerSlider').addEventListener('input', e => showLayer(parseInt(e.target.value)));
  document.getElementById('modelScale').addEventListener('input', e => document.getElementById('scaleVal').textContent = e.target.value + '%');
  document.getElementById('infill').addEventListener('input', e => document.getElementById('infillVal').textContent = e.target.value + '%');
  document.getElementById('supportDensity').addEventListener('input', e => document.getElementById('supportDensityVal').textContent = e.target.value + '%');

  document.getElementById('btnDuplicate').addEventListener('click', duplicateSelected);
  document.getElementById('btnArrange').addEventListener('click', arrangeModels);

  document.getElementById('viewTop').addEventListener('click', () => navigateCamera([0, 500, 0.01], [0, 0, 0]));
  document.getElementById('viewFront').addEventListener('click', () => navigateCamera([0, 0, 500], [0, 0, 0]));
  document.getElementById('viewSide').addEventListener('click', () => navigateCamera([500, 0, 0.01], [0, 0, 0]));
  document.getElementById('viewIso').addEventListener('click', fitView);
  document.getElementById('toggleGrid').addEventListener('click', function() { getGrid().visible = !getGrid().visible; this.classList.toggle('active'); });
  document.getElementById('toggleAxes').addEventListener('click', function() { getAxes().visible = !getAxes().visible; this.classList.toggle('active'); });
  document.getElementById('toggleWireframe').addEventListener('click', toggleWireframe);
  document.getElementById('centerModel').addEventListener('click', centerSelected);

  setupViewerInteraction();
}

function setupCollapsibles() {
  document.querySelectorAll('.section-title').forEach(title => {
    title.addEventListener('click', () => {
      const section = title.dataset.section;
      const content = document.getElementById(section + 'Content');
      if (!content) return;
      title.classList.toggle('collapsed');
      content.classList.toggle('collapsed');
    });
  });
}

function setupKeyboardShortcuts() {
  window.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey) {
      switch(e.key.toLowerCase()) {
        case 'z': e.preventDefault(); undoTransform(); break;
        case 'y': e.preventDefault(); redoTransform(); break;
        case 'd': e.preventDefault(); duplicateSelected(); break;
        case 'a': e.preventDefault(); arrangeModels(); break;
        case 's': e.preventDefault(); if (STATE.sliced) downloadGcode(); break;
      }
    } else {
      switch(e.key.toLowerCase()) {
        case 'g': toggleGrid(); break;
        case 'w': toggleWireframe(); break;
        case 'f': fitView(); break;
        case 'escape': clearSelection(); break;
      }
    }
  });
}

function setupContextMenu() {
  document.getElementById('viewer3d').addEventListener('contextmenu', e => {
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY, [
      { label: 'Center View', action: fitView },
      { label: 'Toggle Grid', action: toggleGrid },
      { label: 'Toggle Wireframe', action: toggleWireframe },
      { label: 'Separator', action: null },
      { label: 'Duplicate Selected', action: duplicateSelected },
      { label: 'Delete Selected', action: deleteSelected },
      { label: 'Separator', action: null },
      { label: 'Slice All', action: sliceCurrent },
      { label: 'Download G-code', action: downloadGcode }
    ]);
  });

  document.addEventListener('click', () => { contextMenu.style.display = 'none'; });
}

function showContextMenu(x, y, items) {
  contextMenu.innerHTML = '';
  items.forEach(item => {
    if (item.label === 'Separator') {
      const sep = document.createElement('div');
      sep.className = 'context-menu-separator';
      contextMenu.appendChild(sep);
    } else {
      const div = document.createElement('div');
      div.className = 'context-menu-item';
      div.textContent = item.label;
      div.addEventListener('click', () => { contextMenu.style.display = 'none'; item.action(); });
      contextMenu.appendChild(div);
    }
  });
  contextMenu.style.display = 'block';
  contextMenu.style.left = x + 'px';
  contextMenu.style.top = y + 'px';
}

function navigateCamera(pos, target) {
  appCamera.position.set(pos[0], pos[1], pos[2]);
  appCamera.lookAt(target[0], target[1], target[2]);
}

function fitView() {
  const visible = STATE.models.filter(m => m.visible).map(m => m.mesh);
  fitCameraToObjects(visible);
  showToast('View fitted to models', 'info');
}

function toggleGrid() {
  const grid = getGrid();
  grid.visible = !grid.visible;
  document.getElementById('toggleGrid').classList.toggle('active');
}

function toggleWireframe() {
  const m = getSelected();
  if (m && m.mesh && m.mesh.material) {
    m.mesh.material.wireframe = !m.mesh.material.wireframe;
    document.getElementById('toggleWireframe').classList.toggle('active');
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
    appCamera.position.multiplyScalar(factor);
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
  const badge = document.getElementById('modeBadge');
  badge.textContent = mode === 'fdm' ? '3D PRINT' : mode === 'laser' ? 'LASER' : 'CNC';
  badge.className = 'menu-mode ' + mode;

  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.mode === mode));
  document.getElementById('printSection').classList.toggle('hidden', mode !== 'fdm');
  document.getElementById('supportSection').classList.toggle('hidden', mode !== 'fdm');
  document.getElementById('adhesionSection').classList.toggle('hidden', mode !== 'fdm');
  document.getElementById('advancedSection').classList.toggle('hidden', mode !== 'fdm');
  document.getElementById('laserSection').classList.toggle('hidden', mode !== 'laser');
  document.getElementById('cncSection').classList.toggle('hidden', mode !== 'cnc');

  const statusMode = document.getElementById('statusMode');
  statusMode.textContent = mode === 'fdm' ? 'FDM' : mode === 'laser' ? 'LASER' : 'CNC';

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
    showToast('Failed to load ' + file.name + ': ' + err.message, 'error');
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
  showToast('Loaded ' + name + ' (' + size.x.toFixed(1) + '×' + size.y.toFixed(1) + '×' + size.z.toFixed(1) + ' mm)', 'success');
  updateModelList();
  updateInfo();
  enableActions();
  fitView();
}

function updateModelList() {
  const list = document.getElementById('modelList');
  list.innerHTML = '';
  list.classList.toggle('hidden', !STATE.models.length);
  STATE.models.forEach(m => {
    const item = document.createElement('div');
    item.className = 'model-item' + (m.id === STATE.selectedId ? ' selected' : '');
    item.innerHTML = '<button class="vis" data-id="' + m.id + '">' + (m.visible ? '◉' : '○') + '</button>' +
      '<span class="name" data-id="' + m.id + '">' + m.name + '</span>' +
      '<button class="rm" data-id="' + m.id + '">×</button>';

    item.querySelector('.vis').addEventListener('click', e => { e.stopPropagation(); toggleVisibility(m.id); });
    item.querySelector('.name').addEventListener('click', () => selectModel(m.id));
    item.querySelector('.rm').addEventListener('click', e => { e.stopPropagation(); removeModel(m.id); });
    list.appendChild(item);
  });
  updateInfo();
}

function toggleVisibility(id) {
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

function clearSelection() {
  STATE.selectedId = null;
  updateModelList();
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

function deleteSelected() {
  if (STATE.selectedId) removeModel(STATE.selectedId);
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

function duplicateSelected() {
  const m = getSelected();
  if (!m) return;
  saveUndoState();
  const clone = m.mesh.clone();
  clone.position.x += 20;
  clone.updateMatrixWorld(true);
  const newId = STATE.nextId++;
  const model = { id: newId, mesh: clone, name: m.name + ' (copy)', visible: true };
  STATE.models.push(model);
  addToScene(clone);
  STATE.selectedId = newId;
  updateModelList();
  fitView();
  showToast('Model duplicated', 'success');
}

function arrangeModels() {
  if (!STATE.models.length) return;
  const spacing = 30;
  STATE.models.forEach((m, i) => {
    m.mesh.position.x = (i % 5) * spacing;
    m.mesh.position.y = Math.floor(i / 5) * spacing;
    m.mesh.position.z = 0;
    m.mesh.rotation.set(0, 0, 0);
    m.mesh.scale.set(1, 1, 1);
    m.mesh.updateMatrixWorld(true);
  });
  syncTransformUI(getSelected());
  fitView();
  showToast('Models arranged', 'success');
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

function saveUndoState() {
  STATE.undoStack.push(STATE.models.map(m => ({
    id: m.id, name: m.name, visible: m.visible,
    pos: m.mesh.position.clone(),
    rot: m.mesh.rotation.clone(),
    scale: m.mesh.scale.clone()
  })));
  if (STATE.undoStack.length > 50) STATE.undoStack.shift();
  STATE.redoStack = [];
  updateUndoRedoButtons();
}

function undoTransform() {
  if (!STATE.undoStack.length) return;
  saveRedoState();
  const state = STATE.undoStack.pop();
  restoreState(state);
  showToast('Undo', 'info');
}

function redoTransform() {
  if (!STATE.redoStack.length) return;
  saveUndoState();
  const state = STATE.redoStack.pop();
  restoreState(state);
  showToast('Redo', 'info');
}

function saveRedoState() {
  STATE.redoStack.push(STATE.models.map(m => ({
    id: m.id, name: m.name, visible: m.visible,
    pos: m.mesh.position.clone(),
    rot: m.mesh.rotation.clone(),
    scale: m.mesh.scale.clone()
  })));
}

function restoreState(state) {
  state.forEach(s => {
    const m = STATE.models.find(x => x.id === s.id);
    if (!m) return;
    m.mesh.position.copy(s.pos);
    m.mesh.rotation.copy(s.rot);
    m.mesh.scale.copy(s.scale);
    m.mesh.visible = s.visible;
    m.mesh.updateMatrixWorld(true);
  });
  syncTransformUI(getSelected());
  updateModelList();
  updateUndoRedoButtons();
}

function updateUndoRedoButtons() {
  document.getElementById('btnUndo').disabled = !STATE.undoStack.length;
  document.getElementById('btnRedo').disabled = !STATE.redoStack.length;
}

function applyTransform() {
  const m = getSelected();
  if (!m) return;
  saveUndoState();
  const scale = parseFloat(document.getElementById('modelScale').value) / 100;
  const rx = THREE.MathUtils.degToRad(parseFloat(document.getElementById('rotX').value) || 0);
  const rz = THREE.MathUtils.degToRad(parseFloat(document.getElementById('rotZ').value) || 0);
  const px = parseFloat(document.getElementById('posX').value) || 0;
  const py = parseFloat(document.getElementById('posY').value) || 0;
  m.mesh.scale.set(scale, scale, scale);
  m.mesh.rotation.set(rx, 0, rz);
  m.mesh.position.set(px, py, 0);
  m.mesh.updateMatrixWorld(true);
  if (STATE.sliced) { showToast('Re-slice needed', 'warn'); STATE.sliced = false; clearPreview(); }
}

function sliceCurrent() {
  if (!STATE.models.length) return;
  clearPreview();
  showToast('Slicing ' + STATE.models.length + ' model(s)...', 'info');
  setProgress(5);
  const lh = parseFloat(document.getElementById('layerHeight').value) || 0.2;
  STATE.layers = sliceModels(STATE.models, lh, pct => setProgress(pct));
  STATE.sliced = true;
  document.getElementById('layerSlider').max = STATE.layers.length;
  document.getElementById('layerSlider').value = 0;
  document.getElementById('btnShowLayer').disabled = false;
  setProgress(100);
  const totalContours = STATE.layers.reduce((s, l) => s + l.polygons.length, 0);
  showToast('Slice complete: ' + STATE.layers.length + ' layers, ' + totalContours + ' contours', 'success');
  updateInfo();
  updateStats();
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
    const mat = new THREE.LineBasicMaterial({ color: 0xff9d00 });
    getPreviewGroup().add(new THREE.Line(geom, mat));
  });
  document.getElementById('layerLabel').textContent = (idx + 1) + '/' + STATE.layers.length;
}

function showCurrentLayer() { showLayer(parseInt(document.getElementById('layerSlider').value)); }

function downloadGcode() {
  if (!STATE.sliced || !STATE.layers.length) { showToast('Slice first', 'warn'); return; }
  const s = readSettings();
  const gcode = generateGcode(STATE.mode, STATE.layers, s, STATE.models.length);
  const blob = new Blob([gcode], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'ferroworker_' + STATE.mode + '_' + Date.now() + '.gcode';
  a.click();
  URL.revokeObjectURL(url);
  showToast('G-code downloaded', 'success');

  const preview = document.getElementById('gcodePreview');
  preview.style.display = 'block';
  preview.textContent = gcode.slice(0, 6000) + (gcode.length > 6000 ? '\n; ... truncated ...' : '');

  document.getElementById('gcodeSize').textContent = (gcode.length / 1024).toFixed(1) + ' KB';
  document.getElementById('gcodeCmds').textContent = gcode.split('\n').length.toLocaleString();
}

function readSettings() {
  return {
    layerHeight: parseFloat(document.getElementById('layerHeight').value) || 0.2,
    lineWidth: parseFloat(document.getElementById('lineWidth').value) || 0.4,
    infill: parseFloat(document.getElementById('infill').value) || 20,
    infillPattern: document.getElementById('infillPattern').value,
    infillAnchor: document.getElementById('infillAnchor').value,
    printSpeed: parseFloat(document.getElementById('printSpeed').value) || 60,
    travelSpeed: parseFloat(document.getElementById('travelSpeed').value) || 120,
    nozzleTemp: parseFloat(document.getElementById('nozzleTemp').value) || 200,
    bedTemp: parseFloat(document.getElementById('bedTemp').value) || 60,
    chamberTemp: parseFloat(document.getElementById('chamberTemp').value) || 0,
    fanSpeed: parseFloat(document.getElementById('fanSpeed').value) || 100,
    perimeters: parseInt(document.getElementById('perimeters').value) || 2,
    bottomLayers: parseInt(document.getElementById('bottomLayers').value) || 3,
    topLayers: parseInt(document.getElementById('topLayers').value) || 3,
    retraction: parseFloat(document.getElementById('retraction').value) || 6,
    retractSpeed: parseFloat(document.getElementById('retractSpeed').value) || 40,
    zHop: parseFloat(document.getElementById('zHop').value) || 0,
    extraRestart: parseFloat(document.getElementById('extraRestart').value) || 0,
    pressureAdv: parseFloat(document.getElementById('pressureAdv').value) || 0,
    flowRate: parseFloat(document.getElementById('flowRate').value) || 100,
    maxVolumetric: parseFloat(document.getElementById('maxVolumetric').value) || 12,
    varLayerMin: parseFloat(document.getElementById('varLayerMin').value) || 0.1,
    varLayerMax: parseFloat(document.getElementById('varLayerMax').value) || 0.3,
    varLayerMode: document.getElementById('varLayerMode').value,
    fanMin: parseFloat(document.getElementById('fanMin').value) || 0,
    fanMax: parseFloat(document.getElementById('fanMax').value) || 100,
    fanThreshold: parseFloat(document.getElementById('fanThreshold').value) || 100,
    supportMode: document.getElementById('supportMode').value,
    supportDensity: parseFloat(document.getElementById('supportDensity').value) || 15,
    supportPattern: document.getElementById('supportPattern').value,
    supportAngle: parseFloat(document.getElementById('supportAngle').value) || 50,
    supportZ: parseFloat(document.getElementById('supportZ').value) || 0.2,
    supportXY: parseFloat(document.getElementById('supportXY').value) || 0.8,
    adhesionType: document.getElementById('adhesionType').value,
    brimWidth: parseFloat(document.getElementById('brimWidth').value) || 5,
    skirtCount: parseInt(document.getElementById('skirtCount').value) || 2,
    skirtDist: parseFloat(document.getElementById('skirtDist').value) || 4,
    laserPower: parseFloat(document.getElementById('laserPower').value) || 10,
    laserSpeed: parseFloat(document.getElementById('laserSpeed').value) || 1000,
    laserPasses: parseInt(document.getElementById('laserPasses').value) || 1,
    laserMode: document.getElementById('laserMode').value,
    laserPWM: parseInt(document.getElementById('laserPWM').value) || 255,
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

function updateStats() {
  if (!STATE.layers.length) return;
  document.getElementById('statLayers').textContent = STATE.layers.length.toLocaleString();

  let totalTris = 0;
  STATE.models.forEach(m => {
    if (m.mesh && m.mesh.geometry) {
      totalTris += m.mesh.geometry.attributes.position.count / 3;
    }
  });
  document.getElementById('statTris').textContent = Math.round(totalTris).toLocaleString();

  const s = readSettings();
  const estMinutes = estimatePrintTime(STATE.layers, s);
  document.getElementById('statTime').textContent = formatTime(estMinutes);
  document.getElementById('estTime').textContent = formatTime(estMinutes);

  const filament = estimateFilament(STATE.layers, s);
  document.getElementById('statFilament').textContent = filament.toFixed(1) + ' m';
}

function estimatePrintTime(layers, s) {
  let totalTime = 0;
  layers.forEach(layer => {
    layer.polygons.forEach(poly => {
      for (let i = 0; i < poly.length - 1; i++) {
        const dist = Math.sqrt((poly[i+1].x - poly[i].x) ** 2 + (poly[i+1].y - poly[i].y) ** 2);
        totalTime += (dist / s.printSpeed) / 60;
      }
    });
  });
  return Math.round(totalTime);
}

function estimateFilament(layers, s) {
  let totalLength = 0;
  layers.forEach(layer => {
    layer.polygons.forEach(poly => {
      for (let i = 0; i < poly.length - 1; i++) {
        const dist = Math.sqrt((poly[i+1].x - poly[i].x) ** 2 + (poly[i+1].y - poly[i].y) ** 2);
        totalLength += dist;
      }
    });
  });
  return totalLength / 10;
}

function formatTime(minutes) {
  if (minutes < 60) return minutes + ' min';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h + 'h ' + m + 'm';
}

function enableActions() {
  ['btnSlice', 'btnPreview', 'btnDownload'].forEach(id => document.getElementById(id).disabled = false);
}
function disableActions() {
  ['btnSlice', 'btnPreview', 'btnDownload', 'btnShowLayer'].forEach(id => document.getElementById(id).disabled = true);
}
function clearPreview() {
  clearGroup(getPreviewGroup());
  STATE.layers = [];
  STATE.sliced = false;
  document.getElementById('layerSlider').max = 0;
  document.getElementById('layerSlider').value = 0;
  document.getElementById('layerLabel').textContent = '0/0';
  document.getElementById('gcodePreview').style.display = 'none';
  updateInfo();
}

function showToast(msg, type) {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = 'toast ' + (type || '');
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => { toast.remove(); }, 3000);
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
  const overlay = document.getElementById('progressOverlay');
  const percent = document.getElementById('progressPercent');
  const text = document.getElementById('progressText');

  wrap.style.display = 'block';
  bar.style.width = pct + '%';
  percent.textContent = Math.round(pct) + '%';
  text.textContent = pct < 100 ? 'Slicing...' : 'Done!';

  if (pct >= 100) {
    setTimeout(() => {
      wrap.style.display = 'none';
      overlay.classList.remove('active');
    }, 500);
  } else {
    overlay.classList.add('active');
  }
}
