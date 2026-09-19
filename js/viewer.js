'use strict';

import * as THREE from 'three';

let scene, camera, renderer, gridHelper, axesHelper;
let sliceGroup, previewGroup;
let animationId;
let onResizeCb = null;

export function init(containerId, callbacks = {}) {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1a1a);

  camera = new THREE.PerspectiveCamera(45, 1, 1, 5000);
  camera.position.set(300, 250, 400);
  camera.lookAt(0, 0, 0);

  const container = document.getElementById(containerId);
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setClearColor(0x1a1a1a);
  container.appendChild(renderer.domElement);

  gridHelper = new THREE.GridHelper(1000, 20, 0x3e3e42, 0x2d2d30);
  gridHelper.position.y = 0;
  scene.add(gridHelper);

  axesHelper = new THREE.AxesHelper(120);
  scene.add(axesHelper);

  const ambient = new THREE.AmbientLight(0xffffff, 0.65);
  scene.add(ambient);
  const dir = new THREE.DirectionalLight(0xffffff, 0.5);
  dir.position.set(1, 2, 3);
  scene.add(dir);
  const dir2 = new THREE.DirectionalLight(0xffffff, 0.2);
  dir2.position.set(-1, -1, -1);
  scene.add(dir2);

  sliceGroup = new THREE.Group();
  scene.add(sliceGroup);
  previewGroup = new THREE.Group();
  scene.add(previewGroup);

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
