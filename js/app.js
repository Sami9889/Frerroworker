'use strict';

import * as THREE from 'three';
import { init as initViewer, addToScene, clearGroup, fitCameraToObjects, disposeMesh, getPreviewGroup, getGrid, getAxes, getScene } from './viewer.js';
import { loadGeometry } from './parsers.js';
import { sliceModels } from './slicer.js';
import { generateGcode } from './gcode.js';

const STATE = {
  mode: 'fdm',
  models: [],
  selectedIds: new Set(),
  nextId: 1,
  layers: [],
  sliced: false,
  undoStack: [],
  redoStack: [],
  isOrtho: false,
  currentTool: 'select',
  workspace: 'layout',
  frame: 1,
  fps: 24,
  isPlaying: false,
  playInterval: null,
  snapping: { enabled: false, type: 'increment', increment: 1.0 },
  pivot: 'median',
  xray: false,
  outline: true,
  collections: [{ name: 'Scene Collection', objects: [] }],
  activeCollection: 0,
  modifiers: new Map()
};

const MODE_COLORS = { fdm: 0xb8b8b8, laser: 0xb5451b, cnc: 0x858585 };

let appCamera = null;
let contextMenu = null;
let gizmo = null;
let raycaster = null;
let mouse = null;

export function initApp() {
  const viewer = initViewer('viewer3d');
  appCamera = viewer.camera;
  contextMenu = document.getElementById('contextMenu');
  raycaster = new THREE.Raycaster();
  mouse = new THREE.Vector2();

  setupEventListeners();
  setupDragDrop();
  setupKeyboardShortcuts();
  setupContextMenu();
  setupRightTabs();
  setupWorkspaces();
  setupTimeline();
  setupToolShelf();
  setupOutliner();
  setupPropertiesPanel();
  setupSnapping();
  updateModelList();
  updateOutliner();
  updateInfo();
  startFPSCounter();
}

function setupEventListeners() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => setMode(tab.dataset.mode));
  });

  document.querySelectorAll('.menu-item').forEach(item => {
    item.addEventListener('click', () => handleMenuAction(item.dataset.action));
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
  document.getElementById('btnUndo').addEventListener('click', undo);
  document.getElementById('btnRedo').addEventListener('click', redo);
  document.getElementById('btnShowLayer').addEventListener('click', showCurrentLayer);
  document.getElementById('layerSlider').addEventListener('input', e => showLayer(parseInt(e.target.value)));
  document.getElementById('modelScale').addEventListener('input', e => document.getElementById('scaleVal').textContent = e.target.value + '%');
  document.getElementById('infill').addEventListener('input', e => document.getElementById('infillVal').textContent = e.target.value + '%');
  document.getElementById('supportDensity').addEventListener('input', e => document.getElementById('supportDensityVal').textContent = e.target.value + '%');

  document.getElementById('btnDuplicate').addEventListener('click', duplicateSelected);
  document.getElementById('btnArrange').addEventListener('click', arrangeModels);
  document.getElementById('btnCenterModel').addEventListener('click', centerSelected);
  document.getElementById('btnResetTransform').addEventListener('click', resetTransform);
  document.getElementById('btnDeleteSelected').addEventListener('click', deleteSelected);
  document.getElementById('btnCopyGcode').addEventListener('click', copyGcodeToClipboard);
  document.getElementById('btnExportSettings').addEventListener('click', exportSettings);
  document.getElementById('btnImportSettings').addEventListener('click', () => document.getElementById('settingsInput').click());
  document.getElementById('settingsInput').addEventListener('change', importSettings);
  document.getElementById('presetSelect').addEventListener('change', applyPreset);

  document.getElementById('viewTop').addEventListener('click', () => navigateCamera([0, 500, 0.01], [0, 0, 0]));
  document.getElementById('viewFront').addEventListener('click', () => navigateCamera([0, 0, 500], [0, 0, 0]));
  document.getElementById('viewSide').addEventListener('click', () => navigateCamera([500, 0, 0.01], [0, 0, 0]));
  document.getElementById('viewIso').addEventListener('click', fitView);
  document.getElementById('toggleGrid').addEventListener('click', toggleGrid);
  document.getElementById('toggleAxes').addEventListener('click', toggleAxes);
  document.getElementById('toggleWireframe').addEventListener('click', toggleWireframe);
  document.getElementById('toggleOrtho').addEventListener('click', toggleOrtho);
  document.getElementById('toggleXray').addEventListener('click', toggleXray);
  document.getElementById('toggleOutline').addEventListener('click', toggleOutline);

  document.getElementById('layerOpacity').addEventListener('input', e => {
    document.getElementById('layerOpacityVal').textContent = e.target.value + '%';
    updateLayerPreviewStyle();
  });
  document.getElementById('layerLineWidth').addEventListener('input', e => {
    document.getElementById('layerLineWidthVal').textContent = e.target.value;
    updateLayerPreviewStyle();
  });
  document.getElementById('layerColorMode').addEventListener('change', updateLayerPreviewStyle);

  setupViewerInteraction();
}

function handleMenuAction(action) {
  const menus = {
    file: () => document.getElementById('fileInput').click(),
    edit: () => { if (document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') undo(); },
    add: () => document.getElementById('fileInput').click(),
    object: () => showToast('Object menu: Duplicate (Shift+D), Delete (X)', 'info'),
    view: () => fitView(),
    render: () => showToast('Render: Blender-style viewport shading', 'info'),
    window: () => showToast('Window management: Fullscreen (F11)', 'info'),
    help: () => showToast('FERROWORKER Advanced Editor\n\nTools: V=Select, G=Move, R=Rotate, S=Scale, E=Extrude, K=Knife\nView: Numpad 1/3/7/5, C=Center, Z=X-Ray\nTransform: Ctrl+A=Apply, Ctrl+D=Duplicate, X=Delete\nUndo/Redo: Ctrl+Z/Y\nFile: Ctrl+O=Open, Ctrl+S=Save', 'info')
  };
  if (menus[action]) menus[action]();
}

function setupToolShelf() {
  document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tool = btn.dataset.tool;
      if (!tool) return;
      setTool(tool);
    });
  });
}

function setTool(tool) {
  STATE.currentTool = tool;
  document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
  const btn = document.querySelector(`.tool-btn[data-tool="${tool}"]`);
  if (btn) btn.classList.add('active');
  document.getElementById('statusTool').textContent = tool.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  document.getElementById('statusMode').textContent = tool === 'select' ? 'OBJECT MODE' : tool.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).toUpperCase();
  showToast('Tool: ' + tool.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), 'info');
}

function setupRightTabs() {
  document.querySelectorAll('.right-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.right-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      const panel = document.getElementById('ptab-' + tab.dataset.ptab);
      if (panel) panel.classList.add('active');
    });
  });
}

function setupWorkspaces() {
  document.querySelectorAll('.workspace-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.workspace-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      STATE.workspace = tab.dataset.workspace;
      applyWorkspace(tab.dataset.workspace);
    });
  });
}

function applyWorkspace(ws) {
  const layouts = {
    layout: { toolShelf: true, outliner: true, properties: true, timeline: true },
    modeling: { toolShelf: true, outliner: true, properties: true, timeline: true },
    sculpt: { toolShelf: true, outliner: false, properties: true, timeline: false },
    uv: { toolShelf: false, outliner: true, properties: true, timeline: false },
    texture: { toolShelf: false, outliner: true, properties: false, timeline: false },
    shader: { toolShelf: false, outliner: true, properties: true, timeline: false },
    animation: { toolShelf: true, outliner: true, properties: true, timeline: true },
    scripting: { toolShelf: false, outliner: false, properties: false, timeline: false }
  };
  const l = layouts[ws] || layouts.layout;
  document.getElementById('toolShelf').style.display = l.toolShelf ? '' : 'none';
  document.getElementById('outliner').style.display = l.outliner ? '' : 'none';
  document.getElementById('propertiesPanel').style.display = l.properties ? '' : 'none';
  document.getElementById('timeline').style.display = l.timeline ? '' : 'none';
  showToast('Workspace: ' + ws.charAt(0).toUpperCase() + ws.slice(1), 'info');
}

function setupTimeline() {
  const track = document.getElementById('timelineTrack');
  for (let i = 0; i <= 250; i++) {
    const frame = document.createElement('div');
    frame.className = 'timeline-frame';
    frame.style.left = (i * 10) + 'px';
    track.appendChild(frame);
  }

  track.addEventListener('click', e => {
    const rect = track.getBoundingClientRect();
    const x = e.clientX - rect.left + track.parentElement.scrollLeft;
    const frame = Math.round(x / 10) + 1;
    setFrame(Math.max(1, Math.min(250, frame)));
  });

  document.getElementById('btnPlay').addEventListener('click', togglePlay);
  document.getElementById('btnPrevFrame').addEventListener('click', () => setFrame(STATE.frame - 1));
  document.getElementById('btnNextFrame').addEventListener('click', () => setFrame(STATE.frame + 1));
  document.getElementById('btnJumpStart').addEventListener('click', () => setFrame(1));
  document.getElementById('btnJumpEnd').addEventListener('click', () => setFrame(250));
  document.getElementById('fpsInput').addEventListener('change', e => {
    STATE.fps = parseInt(e.target.value) || 24;
  });
}

function setFrame(f) {
  STATE.frame = f;
  document.getElementById('currentFrame').textContent = f;
  const playhead = document.getElementById('timelinePlayhead');
  playhead.style.left = ((f - 1) * 10 + 5) + 'px';
}

function togglePlay() {
  STATE.isPlaying = !STATE.isPlaying;
  document.getElementById('btnPlay').textContent = STATE.isPlaying ? '⏸' : '▶';
  if (STATE.isPlaying) {
    STATE.playInterval = setInterval(() => {
      STATE.frame++;
      if (STATE.frame > 250) STATE.frame = 1;
      setFrame(STATE.frame);
    }, 1000 / STATE.fps);
  } else {
    clearInterval(STATE.playInterval);
  }
}

function setupSnapping() {
  const snapBtn = document.getElementById('statusSnapping');
  snapBtn.style.cursor = 'pointer';
  snapBtn.addEventListener('click', () => {
    STATE.snapping.enabled = !STATE.snapping.enabled;
    snapBtn.textContent = 'Snap: ' + (STATE.snapping.enabled ? 'Increment (' + STATE.snapping.increment + ')' : 'Off');
  });
}

function setupOutliner() {
  document.getElementById('btnOutlinerAdd').addEventListener('click', () => document.getElementById('fileInput').click());
}

function setupPropertiesPanel() {
  ['locX', 'locY', 'locZ', 'rotX', 'rotY', 'rotZ', 'scaleX', 'scaleY', 'scaleZ'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', () => {
        const m = getSelected();
        if (!m) return;
        const v = parseFloat(el.value) || 0;
        if (id.startsWith('loc')) m.mesh.position[id[3].toLowerCase()] = v;
        else if (id.startsWith('rot')) m.mesh.rotation[id[3].toLowerCase()] = THREE.MathUtils.degToRad(v);
        else if (id.startsWith('scale')) m.mesh.scale[id[3].toLowerCase()] = v;
        m.mesh.updateMatrixWorld(true);
        updateDimensions();
      });
    }
  });

  document.getElementById('matColor').addEventListener('input', e => {
    const m = getSelected();
    if (m && m.mesh.material) m.mesh.material.color.set(e.target.value);
  });
  document.getElementById('matMetallic').addEventListener('input', e => {
    document.getElementById('matMetallicVal').textContent = e.target.value + '%';
    const m = getSelected();
    if (m && m.mesh.material) m.mesh.material.metalness = parseInt(e.target.value) / 100;
  });
  document.getElementById('matRoughness').addEventListener('input', e => {
    document.getElementById('matRoughnessVal').textContent = e.target.value + '%';
    const m = getSelected();
    if (m && m.mesh.material) m.mesh.material.roughness = parseInt(e.target.value) / 100;
  });
  document.getElementById('matAlpha').addEventListener('input', e => {
    document.getElementById('matAlphaVal').textContent = e.target.value + '%';
    const m = getSelected();
    if (m && m.mesh.material) {
      m.mesh.material.opacity = parseInt(e.target.value) / 100;
      m.mesh.material.transparent = parseInt(e.target.value) < 100;
    }
  });

  document.getElementById('shadeMode').addEventListener('change', e => {
    applyShadeMode(e.target.value);
  });

  document.getElementById('btnBackface').addEventListener('click', function() {
    this.classList.toggle('active');
    const m = getSelected();
    if (m && m.mesh.material) m.mesh.material.side = this.classList.contains('active') ? THREE.FrontSide : THREE.DoubleSide;
  });
  document.getElementById('btnXray').addEventListener('click', function() {
    this.classList.toggle('active');
    const m = getSelected();
    if (m && m.mesh.material) m.mesh.material.depthWrite = !this.classList.contains('active');
  });
  document.getElementById('btnShowFront').addEventListener('click', function() {
    this.classList.toggle('active');
    const m = getSelected();
    if (m) m.mesh.renderOrder = this.classList.contains('active') ? 999 : 0;
  });
  document.getElementById('btnSelectable').addEventListener('click', function() {
    this.classList.toggle('active');
    const m = getSelected();
    if (m) m.mesh.raycast = () => {};
  });
  document.getElementById('btnRenderable').addEventListener('click', function() {
    this.classList.toggle('active');
    const m = getSelected();
    if (m) m.mesh.visible = this.classList.contains('active') ? m.visible : false;
  });

  document.getElementById('btnAddModifier').addEventListener('click', showAddModifierMenu);
  document.getElementById('objName').addEventListener('input', e => {
    const m = getSelected();
    if (m) { m.name = e.target.value; updateOutliner(); }
  });
}

function applyShadeMode(mode) {
  STATE.models.forEach(m => {
    if (!m.mesh.material) return;
    switch (mode) {
      case 'solid':
        m.mesh.material = new THREE.MeshPhongMaterial({ color: m.mesh.material.color, flatShading: false, side: THREE.DoubleSide });
        break;
      case 'material':
        m.mesh.material = new THREE.MeshStandardMaterial({ color: m.mesh.material.color, metalness: 0.3, roughness: 0.5 });
        break;
      case 'rendered':
        m.mesh.material = new THREE.MeshStandardMaterial({ color: m.mesh.material.color, metalness: 0.1, roughness: 0.4, envMapIntensity: 1 });
        break;
      case 'wireframe':
        m.mesh.material = new THREE.MeshBasicMaterial({ color: m.mesh.material.color, wireframe: true });
        break;
    }
  });
}

function showAddModifierMenu(e) {
  const m = getSelected();
  if (!m) { showToast('Select an object first', 'warn'); return; }
  const items = [
    { label: 'Mirror', action: () => addModifier(m.id, 'Mirror', { axis: 'X', merge: false }) },
    { label: 'Array', action: () => addModifier(m.id, 'Array', { count: 3, offset: 10 }) },
    { label: 'Solidify', action: () => addModifier(m.id, 'Solidify', { thickness: 0.5 }) },
    { label: 'Bevel', action: () => addModifier(m.id, 'Bevel', { width: 0.1, segments: 2 }) },
    { label: 'Boolean', action: () => showToast('Boolean: Select two objects', 'info') },
    { label: 'Subdivision', action: () => addModifier(m.id, 'Subdivision', { levels: 2 }) },
    { label: 'Displace', action: () => addModifier(m.id, 'Displace', { strength: 0.5 }) }
  ];
  showContextMenu(e.clientX, e.clientY, items);
}

function addModifier(modelId, type, props) {
  const m = STATE.models.find(x => x.id === modelId);
  if (!m) return;
  const mod = { id: Date.now(), type, props, enabled: true };
  if (!STATE.modifiers.has(modelId)) STATE.modifiers.set(modelId, []);
  STATE.modifiers.get(modelId).push(mod);
  updateModifierList(modelId);
  showToast('Added ' + type + ' modifier', 'success');
}

function updateModifierList(modelId) {
  const list = document.getElementById('modifierList');
  list.innerHTML = '';
  const mods = STATE.modifiers.get(modelId) || [];
  mods.forEach(mod => {
    const div = document.createElement('div');
    div.style.cssText = 'background:var(--bg-base);border:1px solid var(--border);padding:4px 6px;border-radius:2px;display:flex;justify-content:space-between;align-items:center';
    div.innerHTML = '<span style="font-size:10px;text-transform:uppercase;letter-spacing:0.05em">' + mod.type + '</span><button class="danger small" data-mod="' + mod.id + '">×</button>';
    div.querySelector('button').addEventListener('click', () => removeModifier(modelId, mod.id));
    list.appendChild(div);
  });
}

function removeModifier(modelId, modId) {
  const mods = STATE.modifiers.get(modelId) || [];
  const idx = mods.findIndex(m => m.id === modId);
  if (idx >= 0) mods.splice(idx, 1);
  updateModifierList(modelId);
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
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

    if (e.ctrlKey || e.metaKey) {
      switch (e.key.toLowerCase()) {
        case 'z': e.preventDefault(); undo(); break;
        case 'y': e.preventDefault(); redo(); break;
        case 'd': e.preventDefault(); duplicateSelected(); break;
        case 'a': e.preventDefault(); selectAll(); break;
        case 's': e.preventDefault(); if (STATE.sliced) downloadGcode(); break;
        case 'o': e.preventDefault(); document.getElementById('fileInput').click(); break;
        case 'shift': break;
      }
      return;
    }

  if (e.shiftKey) {
    switch (e.key.toLowerCase()) {
      case 'd': e.preventDefault(); duplicateSelected(); break;
      case 's': e.preventDefault(); snapMenu(e); break;
    }
    return;
  }

    switch (e.key.toLowerCase()) {
      case 'v': setTool('select'); break;
      case 'g': setTool('move'); break;
      case 'r': setTool('rotate'); break;
      case 's': setTool('scale'); break;
      case 'b': setTool('box_select'); break;
      case 'c': setTool('circle_select'); break;
      case 'l': setTool('lasso'); break;
      case 'e': setTool('extrude'); break;
      case 'k': setTool('knife'); break;
      case 'm': setTool('measure'); break;
      case 'x': case 'delete': deleteSelected(); break;
      case 'f': fitView(); break;
      case 'c': if (!e.ctrlKey && !e.metaKey) centerSelected(); break;
      case 'a': selectAll(); break;
      case 'escape': clearSelection(); break;
      case 'g': setTool('move'); break;
      case 'numpad7': navigateCamera([0, 500, 0.01], [0, 0, 0]); break;
      case 'numpad1': navigateCamera([0, 0, 500], [0, 0, 0]); break;
      case 'numpad3': navigateCamera([500, 0, 0.01], [0, 0, 0]); break;
      case 'numpad5': toggleOrtho(); break;
      case 'tab':
        e.preventDefault();
        const modes = ['OBJECT', 'EDIT', 'SCULPT'];
        const current = document.getElementById('statusMode').textContent;
        const next = modes[(modes.indexOf(current) + 1) % modes.length];
        document.getElementById('statusMode').textContent = next + ' MODE';
        break;
    }
  });
}

function snapMenu(e) {
  showContextMenu(e.clientX, e.clientY, [
    { label: 'Increment (1.0)', action: () => setSnap('increment', 1.0) },
    { label: 'Increment (0.5)', action: () => setSnap('increment', 0.5) },
    { label: 'Increment (0.1)', action: () => setSnap('increment', 0.1) },
    { label: 'Vertex', action: () => setSnap('vertex', 0) },
    { label: 'Edge', action: () => setSnap('edge', 0) },
    { label: 'Face', action: () => setSnap('face', 0) },
    { label: 'Grid', action: () => setSnap('grid', 1.0) }
  ]);
}

function setSnap(type, increment) {
  STATE.snapping = { enabled: true, type, increment };
  document.getElementById('statusSnapping').textContent = 'Snap: ' + type + (increment ? ' (' + increment + ')' : '');
  showToast('Snap: ' + type, 'info');
}

function setupContextMenu() {
  document.getElementById('viewer3d').addEventListener('contextmenu', e => {
    e.preventDefault();
    const items = [
      { label: 'Transform', submenu: [
        { label: 'Move (G)', action: () => setTool('move') },
        { label: 'Rotate (R)', action: () => setTool('rotate') },
        { label: 'Scale (S)', action: () => setTool('scale') },
        { label: 'Apply All (Ctrl+A)', action: applyTransform }
      ]},
      { label: 'View', submenu: [
        { label: 'Top (7)', action: () => navigateCamera([0, 500, 0.01], [0, 0, 0]) },
        { label: 'Front (1)', action: () => navigateCamera([0, 0, 500], [0, 0, 0]) },
        { label: 'Side (3)', action: () => navigateCamera([500, 0, 0.01], [0, 0, 0]) },
        { label: 'Center (C)', action: fitView }
      ]},
      { label: 'Separator', action: null },
      { label: 'Duplicate (Ctrl+D)', action: duplicateSelected },
      { label: 'Delete (X)', action: deleteSelected },
      { label: 'Separator', action: null },
      { label: 'Select All (A)', action: selectAll },
      { label: 'Invert Selection', action: invertSelection },
      { label: 'Separator', action: null },
      { label: 'Add Object', action: () => document.getElementById('fileInput').click() },
      { label: 'Slice All', action: sliceCurrent },
      { label: 'Download G-code', action: downloadGcode }
    ];
    showContextMenu(e.clientX, e.clientY, items);
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
    } else if (item.submenu) {
      const div = document.createElement('div');
      div.className = 'context-menu-item';
      div.innerHTML = item.label + ' <span class="shortcut">▶</span>';
      div.addEventListener('mouseenter', e => {
        let sub = contextMenu.querySelector('.context-submenu');
        if (sub) sub.remove();
        sub = document.createElement('div');
        sub.className = 'context-submenu';
        sub.style.cssText = 'position:absolute;left:100%;top:0;background:var(--bg-panel);border:1px solid var(--border);border-radius:2px;min-width:140px;padding:2px;box-shadow:0 2px 8px rgba(0,0,0,0.3)';
        item.submenu.forEach(subItem => {
          const subDiv = document.createElement('div');
          subDiv.className = 'context-menu-item';
          subDiv.textContent = subItem.label;
          subDiv.addEventListener('click', () => { contextMenu.style.display = 'none'; subItem.action(); });
          sub.appendChild(subDiv);
        });
        div.appendChild(sub);
      });
      contextMenu.appendChild(div);
    } else {
      const div = document.createElement('div');
      div.className = 'context-menu-item';
      div.textContent = item.label;
      div.addEventListener('click', () => { contextMenu.style.display = 'none'; if (item.action) item.action(); });
      contextMenu.appendChild(div);
    }
  });
  contextMenu.style.display = 'block';
  contextMenu.style.left = x + 'px';
  contextMenu.style.top = y + 'px';
}

function setupViewerInteraction() {
  const el = document.getElementById('viewer3d');
  let isDragging = false, prev = { x: 0, y: 0 };
  let orbit = { theta: Math.PI / 4, phi: Math.PI / 3, radius: 200 };
  let target = new THREE.Vector3();

  el.addEventListener('mousedown', e => {
    if (e.button === 0 && STATE.currentTool === 'select') {
      mouse.x = (e.clientX / el.clientWidth) * 2 - 1;
      mouse.y = -(e.clientY / el.clientHeight) * 2 + 1;
      raycaster.setFromCamera(mouse, appCamera);
      const intersects = raycaster.intersectObjects(STATE.models.filter(m => m.visible).map(m => m.mesh), false);
      if (intersects.length > 0) {
        const obj = intersects[0].object;
        const model = STATE.models.find(m => m.mesh === obj);
        if (model) {
          if (e.shiftKey) {
            if (STATE.selectedIds.has(model.id)) STATE.selectedIds.delete(model.id);
            else STATE.selectedIds.add(model.id);
          } else {
            STATE.selectedIds.clear();
            STATE.selectedIds.add(model.id);
          }
          STATE.selectedId = [...STATE.selectedIds][0];
          updateOutliner();
          updatePropertiesPanel();
          updateInfo();
        }
      } else {
        clearSelection();
      }
    }
    isDragging = true;
    prev = { x: e.clientX, y: e.clientY };
  });

  window.addEventListener('mouseup', () => isDragging = false);
  window.addEventListener('mousemove', e => {
    if (!isDragging) return;
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    const m = getSelected();

    if (STATE.currentTool === 'move' && m) {
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(appCamera.quaternion).normalize();
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(appCamera.quaternion).normalize();
      const moveVec = right.multiplyScalar(dx * 0.1).add(up.multiplyScalar(-dy * 0.1));
      m.mesh.position.add(moveVec);
      m.mesh.updateMatrixWorld(true);
      updatePropertiesPanel();
    } else if (STATE.currentTool === 'rotate' && m) {
      m.mesh.rotation.y += dx * 0.01;
      m.mesh.rotation.x += dy * 0.01;
      m.mesh.updateMatrixWorld(true);
      updatePropertiesPanel();
    } else if (STATE.currentTool === 'scale' && m) {
      const s = 1 + (dx + dy) * 0.005;
      m.mesh.scale.multiplyScalar(s);
      m.mesh.updateMatrixWorld(true);
      updatePropertiesPanel();
    } else if (STATE.currentTool === 'select') {
      orbit.theta -= dx * 0.01;
      orbit.phi = Math.max(0.1, Math.min(Math.PI - 0.1, orbit.phi - dy * 0.01));
      updateCameraFromOrbit(orbit, target);
    }

    prev = { x: e.clientX, y: e.clientY };
  });

  el.addEventListener('wheel', e => {
    e.preventDefault();
    orbit.radius *= (1 + e.deltaY * 0.001);
    orbit.radius = Math.max(5, Math.min(2000, orbit.radius));
    updateCameraFromOrbit(orbit, target);
  }, { passive: false });

  el.addEventListener('dblclick', e => {
    mouse.x = (e.clientX / el.clientWidth) * 2 - 1;
    mouse.y = -(e.clientY / el.clientHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, appCamera);
    const intersects = raycaster.intersectObjects(STATE.models.filter(m => m.visible).map(m => m.mesh), false);
    if (intersects.length > 0) fitCameraToObjects([intersects[0].object]);
  });
}

function updateCameraFromOrbit(orbit, target) {
  appCamera.position.set(
    target.x + orbit.radius * Math.sin(orbit.phi) * Math.cos(orbit.theta),
    target.y + orbit.radius * Math.cos(orbit.phi),
    target.z + orbit.radius * Math.sin(orbit.phi) * Math.sin(orbit.theta)
  );
  appCamera.lookAt(target);
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
  document.getElementById('statusMode').textContent = mode === 'fdm' ? 'FDM' : mode === 'laser' ? 'LASER' : 'CNC';
  STATE.models.forEach(m => { if (m.mesh && m.mesh.material) m.mesh.material.color.setHex(MODE_COLORS[mode] || MODE_COLORS.fdm); });
}

function getSelected() {
  return STATE.selectedIds.size === 1 ? STATE.models.find(m => m.id === [...STATE.selectedIds][0]) || null : null;
}

function getSelectedIds() {
  return [...STATE.selectedIds];
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

  const material = new THREE.MeshStandardMaterial({
    color: MODE_COLORS[STATE.mode], metalness: 0.3, roughness: 0.5,
    side: THREE.DoubleSide, transparent: true, opacity: 0.9
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const id = STATE.nextId++;
  const model = { id, mesh, name, visible: true, type: 'MESH', selectable: true };
  STATE.models.push(model);
  addToScene(mesh);
  STATE.collections[STATE.activeCollection].objects.push(id);
  if (STATE.models.length === 1) { STATE.selectedIds.clear(); STATE.selectedIds.add(id); }

  const size = new THREE.Vector3();
  geometry.boundingBox.getSize(size);
  showToast('Loaded ' + name + ' (' + size.x.toFixed(1) + '×' + size.y.toFixed(1) + '×' + size.z.toFixed(1) + ' mm)', 'success');
  updateModelList();
  updateOutliner();
  updateInfo();
  updatePropertiesPanel();
  enableActions();
  fitView();
}

function updateModelList() {
  const list = document.getElementById('modelList');
  list.innerHTML = '';
  list.classList.toggle('hidden', !STATE.models.length);
  STATE.models.forEach(m => {
    const item = document.createElement('div');
    item.className = 'model-item' + (STATE.selectedIds.has(m.id) ? ' selected' : '');
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

function updateOutliner() {
  const list = document.getElementById('outlinerList');
  list.innerHTML = '';
  const icons = { MESH: '◇', EMPTY: '○', LIGHT: '☀', CAMERA: '▷' };
  STATE.models.forEach(m => {
    const item = document.createElement('div');
    item.className = 'outliner-item' + (STATE.selectedIds.has(m.id) ? ' selected' : '');
    item.innerHTML = '<span class="icon">' + (icons[m.type] || '◇') + '</span><span class="name">' + m.name + '</span>';
    item.addEventListener('click', () => selectModel(m.id));
    item.addEventListener('dblclick', () => {
      const scene = getScene();
      scene.getObjectByProperty('uuid', m.mesh.uuid) && fitCameraToObjects([m.mesh]);
    });
    list.appendChild(item);
  });
}

function toggleVisibility(id) {
  const m = STATE.models.find(x => x.id === id);
  if (!m) return;
  m.visible = !m.visible;
  m.mesh.visible = m.visible;
  updateModelList();
  updateOutliner();
}

function selectModel(id) {
  if (event && event.shiftKey) {
    if (STATE.selectedIds.has(id)) STATE.selectedIds.delete(id);
    else STATE.selectedIds.add(id);
  } else {
    STATE.selectedIds.clear();
    STATE.selectedIds.add(id);
  }
  STATE.selectedId = id;
  updateModelList();
  updateOutliner();
  updatePropertiesPanel();
  const m = getSelected();
  if (m) syncTransformUI(m);
}

function clearSelection() {
  STATE.selectedIds.clear();
  STATE.selectedId = null;
  updateModelList();
  updateOutliner();
  updatePropertiesPanel();
}

function selectAll() {
  STATE.models.forEach(m => STATE.selectedIds.add(m.id));
  updateModelList();
  updateOutliner();
}

function invertSelection() {
  STATE.models.forEach(m => {
    if (STATE.selectedIds.has(m.id)) STATE.selectedIds.delete(m.id);
    else STATE.selectedIds.add(m.id);
  });
  updateModelList();
  updateOutliner();
}

function removeModel(id) {
  const idx = STATE.models.findIndex(m => m.id === id);
  if (idx === -1) return;
  saveUndoState();
  disposeMesh(STATE.models[idx].mesh);
  STATE.models.splice(idx, 1);
  STATE.selectedIds.delete(id);
  STATE.modifiers.delete(id);
  if (!STATE.models.length) disableActions();
  updateModelList();
  updateOutliner();
  updatePropertiesPanel();
  fitView();
}

function deleteSelected() {
  getSelectedIds().forEach(id => removeModel(id));
}

function clearAllModels() {
  saveUndoState();
  STATE.models.forEach(m => disposeMesh(m.mesh));
  STATE.models = [];
  STATE.selectedIds.clear();
  STATE.modifiers.clear();
  disableActions();
  clearPreview();
  updateModelList();
  updateOutliner();
  updatePropertiesPanel();
  fitView();
}

function duplicateSelected() {
  const selected = getSelectedIds();
  if (!selected.length) return;
  saveUndoState();
  const newIds = [];
  selected.forEach(id => {
    const m = STATE.models.find(x => x.id === id);
    if (!m) return;
    const clone = m.mesh.clone();
    clone.position.x += 10;
    clone.updateMatrixWorld(true);
    const newId = STATE.nextId++;
    const model = { id: newId, mesh: clone, name: m.name + ' (copy)', visible: true, type: m.type };
    STATE.models.push(model);
    STATE.selectedIds.add(newId);
    newIds.push(newId);
    addToScene(clone);
  });
  updateModelList();
  updateOutliner();
  updatePropertiesPanel();
  fitView();
  showToast('Duplicated ' + newIds.length + ' object(s)', 'success');
}

function arrangeModels() {
  if (!STATE.models.length) return;
  saveUndoState();
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

function centerSelected() {
  const selected = getSelectedIds();
  selected.forEach(id => {
    const m = STATE.models.find(x => x.id === id);
    if (!m) return;
    const box = new THREE.Box3().setFromObject(m.mesh);
    const center = box.getCenter(new THREE.Vector3());
    m.mesh.position.sub(center);
    m.mesh.updateMatrixWorld(true);
  });
  updatePropertiesPanel();
  fitView();
}

function resetTransform() {
  const selected = getSelectedIds();
  if (!selected.length) return;
  saveUndoState();
  selected.forEach(id => {
    const m = STATE.models.find(x => x.id === id);
    if (!m) return;
    m.mesh.position.set(0, 0, 0);
    m.mesh.rotation.set(0, 0, 0);
    m.mesh.scale.set(1, 1, 1);
    m.mesh.updateMatrixWorld(true);
  });
  syncTransformUI(getSelected());
  showToast('Transform reset', 'info');
}

function updatePropertiesPanel() {
  const m = getSelected();
  if (!m) return;
  document.getElementById('objName').value = m.name;
  document.getElementById('locX').value = m.mesh.position.x.toFixed(2);
  document.getElementById('locY').value = m.mesh.position.y.toFixed(2);
  document.getElementById('locZ').value = m.mesh.position.z.toFixed(2);
  document.getElementById('rotX').value = THREE.MathUtils.radToDeg(m.mesh.rotation.x).toFixed(1);
  document.getElementById('rotY').value = THREE.MathUtils.radToDeg(m.mesh.rotation.y).toFixed(1);
  document.getElementById('rotZ').value = THREE.MathUtils.radToDeg(m.mesh.rotation.z).toFixed(1);
  document.getElementById('scaleX').value = m.mesh.scale.x.toFixed(2);
  document.getElementById('scaleY').value = m.mesh.scale.y.toFixed(2);
  document.getElementById('scaleZ').value = m.mesh.scale.z.toFixed(2);
  updateDimensions();
  if (m.mesh.material) {
    document.getElementById('matColor').value = '#' + m.mesh.material.color.getHexString();
    if (m.mesh.material.metalness !== undefined) document.getElementById('matMetallic').value = Math.round(m.mesh.material.metalness * 100);
    if (m.mesh.material.roughness !== undefined) document.getElementById('matRoughness').value = Math.round(m.mesh.material.roughness * 100);
    if (m.mesh.material.opacity !== undefined) document.getElementById('matAlpha').value = Math.round(m.mesh.material.opacity * 100);
  }
  updateModifierList(m.id);
}

function updateDimensions() {
  const m = getSelected();
  if (!m) return;
  const box = new THREE.Box3().setFromObject(m.mesh);
  const size = box.getSize(new THREE.Vector3());
  document.getElementById('dimX').value = size.x.toFixed(2);
  document.getElementById('dimY').value = size.y.toFixed(2);
  document.getElementById('dimZ').value = size.z.toFixed(2);
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
  STATE.undoStack.push({
    models: STATE.models.map(m => ({
      id: m.id, name: m.name, visible: m.visible,
      pos: m.mesh.position.clone(),
      rot: m.mesh.rotation.clone(),
      scale: m.mesh.scale.clone()
    })),
    selectedIds: [...STATE.selectedIds]
  });
  if (STATE.undoStack.length > 50) STATE.undoStack.shift();
  STATE.redoStack = [];
  updateUndoRedoButtons();
}

function undo() {
  if (!STATE.undoStack.length) return;
  STATE.redoStack.push({
    models: STATE.models.map(m => ({
      id: m.id, name: m.name, visible: m.visible,
      pos: m.mesh.position.clone(),
      rot: m.mesh.rotation.clone(),
      scale: m.mesh.scale.clone()
    })),
    selectedIds: [...STATE.selectedIds]
  });
  const state = STATE.undoStack.pop();
  restoreState(state);
  showToast('Undo', 'info');
}

function redo() {
  if (!STATE.redoStack.length) return;
  STATE.undoStack.push({
    models: STATE.models.map(m => ({
      id: m.id, name: m.name, visible: m.visible,
      pos: m.mesh.position.clone(),
      rot: m.mesh.rotation.clone(),
      scale: m.mesh.scale.clone()
    })),
    selectedIds: [...STATE.selectedIds]
  });
  const state = STATE.redoStack.pop();
  restoreState(state);
  showToast('Redo', 'info');
}

function restoreState(state) {
  state.models.forEach(s => {
    const m = STATE.models.find(x => x.id === s.id);
    if (!m) return;
    m.mesh.position.copy(s.pos);
    m.mesh.rotation.copy(s.rot);
    m.mesh.scale.copy(s.scale);
    m.mesh.visible = s.visible;
    m.mesh.updateMatrixWorld(true);
  });
  STATE.selectedIds = new Set(state.selectedIds || []);
  STATE.selectedId = STATE.selectedIds.size ? [...STATE.selectedIds][0] : null;
  updateModelList();
  updateOutliner();
  updatePropertiesPanel();
  updateUndoRedoButtons();
}

function updateUndoRedoButtons() {
  const undoBtn = document.getElementById('btnUndo');
  const redoBtn = document.getElementById('btnRedo');
  if (undoBtn) undoBtn.disabled = !STATE.undoStack.length;
  if (redoBtn) redoBtn.disabled = !STATE.redoStack.length;
}

function applyTransform() {
  const m = getSelected();
  if (!m) return;
  saveUndoState();
  const scale = parseFloat(document.getElementById('modelScale').value) / 100;
  const rx = THREE.MathUtils.degToRad(parseFloat(document.getElementById('rotX').value) || 0);
  const ry = THREE.MathUtils.degToRad(parseFloat(document.getElementById('rotY').value) || 0);
  const rz = THREE.MathUtils.degToRad(parseFloat(document.getElementById('rotZ').value) || 0);
  const px = parseFloat(document.getElementById('posX').value) || 0;
  const py = parseFloat(document.getElementById('locY').value) || 0;
  const pz = parseFloat(document.getElementById('locZ').value) || 0;
  m.mesh.scale.set(scale, scale, scale);
  m.mesh.rotation.set(rx, ry, rz);
  m.mesh.position.set(px, py, pz);
  m.mesh.updateMatrixWorld(true);
  if (STATE.sliced) { showToast('Re-slice needed', 'warn'); STATE.sliced = false; clearPreview(); }
  syncTransformUI(m);
  updatePropertiesPanel();
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
  updateLayerPreviewStyle();
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
  const colorMode = document.getElementById('layerColorMode')?.value || 'single';
  layer.polygons.forEach((poly, polyIdx) => {
    if (poly.length < 2) return;
    const pts = poly.map(p => new THREE.Vector3(p.x, p.y, layer.z));
    const geom = new THREE.BufferGeometry().setFromPoints(pts);
    let color = 0xff9d00;
    if (colorMode === 'height') {
      const t = STATE.layers.length > 1 ? idx / (STATE.layers.length - 1) : 0;
      color = new THREE.Color().setHSL(0.6 - t * 0.6, 1, 0.5).getHex();
    } else if (colorMode === 'speed') {
      const colors = [0x00ff00, 0xffff00, 0xff0000];
      color = colors[polyIdx % colors.length];
    } else if (colorMode === 'type') {
      const colors = [0xff9d00, 0x00aaff, 0xff00ff];
      color = colors[polyIdx % colors.length];
    }
    const mat = new THREE.LineBasicMaterial({ color, linewidth: parseFloat(document.getElementById('layerLineWidth')?.value || 2) });
    getPreviewGroup().add(new THREE.Line(geom, mat));
  });
  document.getElementById('layerLabel').textContent = (idx + 1) + '/' + STATE.layers.length;
}

function updateLayerPreviewStyle() {
  if (!STATE.sliced) return;
  const idx = parseInt(document.getElementById('layerSlider').value);
  if (idx >= 0 && idx < STATE.layers.length) showLayer(idx);
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
  const emptyMsg = document.getElementById('gcodeEmpty');
  if (emptyMsg) emptyMsg.style.display = 'none';
  updateGcodeStats(gcode);
}

function copyGcodeToClipboard() {
  const preview = document.getElementById('gcodePreview');
  if (!preview.textContent) { showToast('No G-code to copy', 'warn'); return; }
  navigator.clipboard.writeText(preview.textContent).then(() => showToast('G-code copied to clipboard', 'success'));
}

function updateGcodeStats(gcode) {
  document.getElementById('gcodeSize').textContent = (gcode.length / 1024).toFixed(1) + ' KB';
  document.getElementById('gcodeCmds').textContent = gcode.split('\n').length.toLocaleString();
  const s = readSettings();
  const estMinutes = estimatePrintTime(STATE.layers, s);
  document.getElementById('gcodeTime').textContent = formatTime(estMinutes);
  const filament = estimateFilament(STATE.layers, s);
  document.getElementById('gcodeWeight').textContent = (filament * 1.24 / 1000).toFixed(2) + ' g';
}

function readSettings() {
  return {
    layerHeight: parseFloat(document.getElementById('layerHeight').value) || 0.2,
    lineWidth: parseFloat(document.getElementById('lineWidth').value) || 0.4,
    infill: parseFloat(document.getElementById('infill').value) || 20,
    infillPattern: document.getElementById('infillPattern').value,
    infillAnchor: document.getElementById('infillAnchor').value,
    printSpeed: parseFloat(document.getElementById('printSpeed')?.value) || 60,
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
  const visibleModels = STATE.models.filter(m => m.visible);
  let totalVerts = 0, totalEdges = 0, totalFaces = 0, totalTris = 0;
  visibleModels.forEach(m => {
    if (m.mesh && m.mesh.geometry) {
      const pos = m.mesh.geometry.attributes.position;
      if (pos) {
        totalVerts += pos.count;
        totalTris += Math.floor(pos.count / 3);
      }
      if (m.mesh.geometry.index) totalEdges += m.mesh.geometry.index.count / 3;
      if (m.mesh.geometry.groups) totalFaces += m.mesh.geometry.groups.length;
    }
  });
  document.getElementById('vertCount').textContent = totalVerts.toLocaleString();
  document.getElementById('edgeCount').textContent = totalEdges.toLocaleString();
  document.getElementById('faceCount').textContent = totalFaces.toLocaleString();
  document.getElementById('triCount').textContent = totalTris.toLocaleString();
  document.getElementById('modelCount').textContent = STATE.models.length;
  document.getElementById('selectedName').textContent = getSelected() ? getSelected().name : 'None';
  document.getElementById('selMode').textContent = STATE.currentTool === 'select' ? 'Object' : STATE.currentTool.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  document.getElementById('layerCount').textContent = STATE.layers.length;
  document.getElementById('statusVerts').textContent = totalVerts.toLocaleString();
  document.getElementById('statusEdges').textContent = totalEdges.toLocaleString();
  document.getElementById('statusFaces').textContent = totalFaces.toLocaleString();
  document.getElementById('statusTris').textContent = totalTris.toLocaleString();
}

function startFPSCounter() {
  let lastTime = performance.now(), frames = 0;
  const update = () => {
    frames++;
    const now = performance.now();
    if (now - lastTime >= 1000) {
      document.getElementById('statusFPS').textContent = frames;
      frames = 0;
      lastTime = now;
      updateInfo();
    }
    requestAnimationFrame(update);
  };
  requestAnimationFrame(update);
}

function updateStats() {
  if (!STATE.layers.length) return;
  document.getElementById('statLayers').textContent = STATE.layers.length.toLocaleString();
  let totalTris = 0;
  STATE.models.forEach(m => {
    if (m.mesh && m.mesh.geometry) totalTris += m.mesh.geometry.attributes.position.count / 3;
  });
  document.getElementById('statTris').textContent = Math.round(totalTris).toLocaleString();
  const s = readSettings();
  const estMinutes = estimatePrintTime(STATE.layers, s);
  document.getElementById('statTime').textContent = formatTime(estMinutes);
  document.getElementById('estTime').textContent = formatTime(estMinutes);
  const filament = estimateFilament(STATE.layers, s);
  document.getElementById('statFilament').textContent = filament.toFixed(1) + ' m';
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  STATE.models.forEach(m => {
    if (!m.mesh) return;
    const box = new THREE.Box3().setFromObject(m.mesh);
    if (box.min.x < minX) minX = box.min.x;
    if (box.max.x > maxX) maxX = box.max.x;
    if (box.min.y < minY) minY = box.min.y;
    if (box.max.y > maxY) maxY = box.max.y;
    if (box.min.z < minZ) minZ = box.min.z;
    if (box.max.z > maxZ) maxZ = box.max.z;
  });
  if (isFinite(minX)) {
    const w = (maxX - minX).toFixed(1), d = (maxY - minY).toFixed(1), h = (maxZ - minZ).toFixed(1);
    document.getElementById('statBBox').textContent = w + '×' + d + '×' + h + ' mm';
    document.getElementById('statHeight').textContent = h + ' mm';
  }
}

function estimatePrintTime(layers, s) {
  let totalTime = 0;
  const speedOuter = parseFloat(document.getElementById('speedOuter')?.value) || s.printSpeed;
  const speedInner = parseFloat(document.getElementById('speedInner')?.value) || s.printSpeed;
  const speedInfill = parseFloat(document.getElementById('speedInfill')?.value) || s.printSpeed;
  const speedTop = parseFloat(document.getElementById('speedTop')?.value) || s.printSpeed;
  const speedFirst = parseFloat(document.getElementById('speedFirst')?.value) || s.printSpeed;
  layers.forEach((layer, lIdx) => {
    const isFirst = lIdx === 0;
    layer.polygons.forEach((poly, pIdx) => {
      const isPerimeter = pIdx === 0;
      let speed = s.printSpeed;
      if (isFirst) speed = speedFirst;
      else if (isPerimeter) speed = speedOuter;
      else speed = speedInfill;
      for (let i = 0; i < poly.length - 1; i++) {
        const dist = Math.sqrt((poly[i+1].x - poly[i].x) ** 2 + (poly[i+1].y - poly[i].y) ** 2);
        totalTime += (dist / speed) / 60;
      }
    });
  });
  return Math.max(1, Math.round(totalTime));
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
  ['btnSlice', 'btnPreview', 'btnDownload'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = false;
  });
  const copyBtn = document.getElementById('btnCopyGcode');
  if (copyBtn) copyBtn.disabled = false;
}

function disableActions() {
  ['btnSlice', 'btnPreview', 'btnDownload', 'btnShowLayer'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = true;
  });
  const copyBtn = document.getElementById('btnCopyGcode');
  if (copyBtn) copyBtn.disabled = true;
}

function clearPreview() {
  clearGroup(getPreviewGroup());
  STATE.layers = [];
  STATE.sliced = false;
  const slider = document.getElementById('layerSlider');
  if (slider) { slider.max = 0; slider.value = 0; }
  const layerLabel = document.getElementById('layerLabel');
  if (layerLabel) layerLabel.textContent = '0/0';
  const gcodePreview = document.getElementById('gcodePreview');
  if (gcodePreview) gcodePreview.style.display = 'none';
  const gcodeEmpty = document.getElementById('gcodeEmpty');
  if (gcodeEmpty) gcodeEmpty.style.display = 'block';
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
    setTimeout(() => { wrap.style.display = 'none'; overlay.classList.remove('active'); }, 500);
  } else {
    overlay.classList.add('active');
  }
}

function exportSettings() {
  const settings = readSettings();
  const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'ferroworker_settings.json';
  a.click();
  URL.revokeObjectURL(url);
  showToast('Settings exported', 'success');
}

function importSettings(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const settings = JSON.parse(ev.target.result);
      Object.keys(settings).forEach(key => {
        const el = document.getElementById(key);
        if (el && el.value !== undefined) el.value = settings[key];
      });
      showToast('Settings imported', 'success');
    } catch (err) {
      showToast('Invalid settings file', 'error');
    }
  };
  reader.readAsText(file);
}

function applyPreset() {
  const preset = document.getElementById('presetSelect').value;
  const presets = {
    draft: { layerHeight: 0.3, lineWidth: 0.4, infill: 10, infillPattern: 'lines', perimeters: 1, bottomLayers: 2, topLayers: 2, printSpeed: 80, travelSpeed: 150 },
    normal: { layerHeight: 0.2, lineWidth: 0.4, infill: 20, infillPattern: 'grid', perimeters: 2, bottomLayers: 3, topLayers: 3, printSpeed: 60, travelSpeed: 120 },
    fine: { layerHeight: 0.1, lineWidth: 0.4, infill: 15, infillPattern: 'gyroid', perimeters: 3, bottomLayers: 4, topLayers: 4, printSpeed: 40, travelSpeed: 100 },
    raft: { layerHeight: 0.2, lineWidth: 0.4, infill: 20, infillPattern: 'grid', perimeters: 2, bottomLayers: 3, topLayers: 3, adhesionType: 'raft', supportMode: 'everywhere' }
  };
  if (preset === 'custom') return;
  const p = presets[preset];
  if (!p) return;
  Object.keys(p).forEach(key => {
    const el = document.getElementById(key);
    if (el && el.value !== undefined) el.value = p[key];
  });
  const infillVal = document.getElementById('infillVal');
  if (infillVal && p.infill !== undefined) infillVal.textContent = p.infill + '%';
  showToast('Preset applied: ' + preset, 'success');
}
