// Minimal starfield generator used by `Globe.tsx` import.
// Returns a THREE.Group or THREE.Points that can be added as a primitive.

import * as THREE from 'three';

// Try to use the project's starfield image if available (src/assets/9078.jpg).
// Fallback: procedural points starfield.
export default function getStarfield(options = {}) {
  const group = new THREE.Group();
  const useImage = true;

  try {
    // Path relative to this file to reach project src/assets/9078.jpg
    // getStarfield.js lives in 3d-globe-with-threejs/src/, so '../../src/assets/9078.jpg' points to the app's asset
    const imgUrl = new URL('../../src/assets/9078.jpg', import.meta.url).href;
    const loader = new THREE.TextureLoader();
    const tex = loader.load(
      imgUrl,
      // onLoad
      () => {},
      undefined,
      () => {}
    );

    // Create a large sphere with the texture mapped inward (BackSide)
    const radius = options.radius || 60;
    const geo = new THREE.SphereGeometry(radius, 48, 32);
    const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, toneMapped: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    group.add(mesh);
    return group;
  } catch (e) {
    // fall through to procedural starfield
  }

  // Procedural fallback
  const numStars = options.numStars || 1500;
  const size = options.size || 1.0;
  const radiusFallback = options.radius || 50;
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(numStars * 3);
  const colors = new Float32Array(numStars * 3);

  for (let i = 0; i < numStars; i++) {
    const u = Math.random();
    const v = Math.random();
    const theta = 2 * Math.PI * u;
    const phi = Math.acos(2 * v - 1);
    const r = radiusFallback * (0.9 + Math.random() * 0.2);
    const x = r * Math.sin(phi) * Math.cos(theta);
    const y = r * Math.sin(phi) * Math.sin(theta);
    const z = r * Math.cos(phi);
    positions[i * 3 + 0] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;

    const c = 0.8 + Math.random() * 0.4;
    colors[i * 3 + 0] = c;
    colors[i * 3 + 1] = c;
    colors[i * 3 + 2] = c;
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const material = new THREE.PointsMaterial({ size: size, vertexColors: true, sizeAttenuation: true, depthWrite: false });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  group.add(points);
  return group;
}
