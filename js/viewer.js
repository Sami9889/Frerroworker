'use strict';

import * as THREE from 'three';

let scene, camera, renderer, gridHelper, axesHelper;
let sliceGroup, previewGroup, helperGroup;
let animationId;
let onResizeCb = null;
let selectionOutline = null;
let selectionBox = null;
let cursor3D = null;

export function init(containerId, callbacks = {}) {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1a1a);
  scene.fog = new THREE.Fog(0x1a1a1a, 800, 2000);

  camera = new THREE.PerspectiveCamera(45, 1, 0.1, 5000);
  camera.position.set(300, 250, 400);
  camera.lookAt(0, 0, 0);

  const container = document.getElementById(containerId);
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setClearColor(0x1a1a1a);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  container.appendChild(renderer.domElement);

  gridHelper = new THREE.GridHelper(1000, 20, 0x4a4a4a, 0x3a3a3a);
  gridHelper.position.y = 0;
  scene.add(gridHelper);

  axesHelper = new THREE.AxesHelper(120);
  scene.add(axesHelper);

  const ambient = new THREE.AmbientLight(0xffffff, 0.5);
  scene.add(ambient);

  const hemi = new THREE.HemisphereLight(0xffeedd, 0x223344, 0.6);
  scene.add(hemi);

  const dir = new THREE.DirectionalLight(0xffffff, 0.8);
  dir.position.set(5, 10, 7);
  dir.castShadow = true;
  dir.shadow.mapSize.width = 2048;
  dir.shadow.mapSize.height = 2048;
  dir.shadow.camera.near = 0.1;
  dir.shadow.camera.far = 50;
  dir.shadow.camera.left = -20;
  dir.shadow.camera.right = 20;
  dir.shadow.camera.top = 20;
  dir.shadow.camera.bottom = -20;
  scene.add(dir);

  const dir2 = new THREE.DirectionalLight(0x8899ff, 0.3);
  dir2.position.set(-5, 5, -5);
  scene.add(dir2);

  sliceGroup = new THREE.Group();
  scene.add(sliceGroup);
  previewGroup = new THREE.Group();
  scene.add(previewGroup);
  helperGroup = new THREE.Group();
  scene.add(helperGroup);

  selectionBox = new THREE.BoxHelper(new THREE.Object3D(), 0xff9d00);
  selectionBox.visible = false;
  scene.add(selectionBox);

  cursor3D = new THREE.Mesh(
    new THREE.SphereGeometry(0.5, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0.5 })
  );
  cursor3D.visible = false;
  scene.add(cursor3D);

  onResizeCb = callbacks.onResize;

  window.addEventListener('resize', () => {
    onResize();
    if (onResizeCb) onResizeCb();
  });
  onResize();
  animate();

  return { scene, camera, renderer };
}

function onResize() {
  const el = renderer.domElement;
  const parent = el.parentElement;
  if (!parent) return;
  const w = parent.clientWidth;
  const h = parent.clientHeight;
  if (w === 0 || h === 0) return;
  camera.aspect = w / Math.max(h, 1);
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}

export function animate() {
  animationId = requestAnimationFrame(animate);
  renderer.render(scene, camera);
}

export function addToScene(obj) { scene.add(obj); }
export function removeFromScene(obj) { scene.remove(obj); }
export function clearGroup(group) { while (group.children.length) group.remove(group.children[0]); }
export function getScene() { return scene; }
export function getCamera() { return camera; }
export function getSliceGroup() { return sliceGroup; }
export function getPreviewGroup() { return previewGroup; }
export function getGrid() { return gridHelper; }
export function getAxes() { return axesHelper; }
export function getRenderer() { return renderer; }

export function fitCameraToObjects(objects) {
  if (!objects || !objects.length) return;
  const box = new THREE.Box3();
  objects.forEach(o => { if (o) box.expandByObject(o); });
  if (box.isEmpty()) return;
  const size = new THREE.Vector3();
  box.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z, 1);
  const dist = maxDim * 1.8;
  camera.position.set(dist * 0.7, dist * 0.6, dist * 0.8);
  camera.lookAt(box.getCenter(new THREE.Vector3()));
}

export function disposeMesh(mesh) {
  if (!mesh) return;
  scene.remove(mesh);
  if (mesh.geometry) mesh.geometry.dispose();
  if (mesh.material) {
    if (Array.isArray(mesh.material)) mesh.material.forEach(m => m.dispose());
    else mesh.material.dispose();
  }
}

export function setSelectionOutline(mesh) {
  if (selectionBox) {
    if (mesh) {
      selectionBox.setFromObject(mesh);
      selectionBox.visible = true;
    } else {
      selectionBox.visible = false;
    }
  }
}

export function get3DCursor() { return cursor3D; }
export function getSelectionBox() { return selectionBox; }
export function getHelperGroup() { return helperGroup; }
