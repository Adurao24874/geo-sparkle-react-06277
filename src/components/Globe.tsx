import { useRef, useEffect, useMemo } from 'react';
import { useFrame, useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import gsap from 'gsap';

import LocationMarker from './LocationMarker';
import { TargetLocation } from './InteractiveGlobe';
import { TextureLoader } from 'three';
import getStarfield from '../../3d-globe-with-threejs/src/getStarfield.js';

interface GlobeProps {
  targetLocation?: TargetLocation;
  cameraRef: React.MutableRefObject<any>;
  controlsRef: React.MutableRefObject<any>;
  onFocusComplete?: () => void;
}

// Convert lat/lon to 3D cartesian coordinates (corrected formula matching texture orientation)
// Uses phi/theta convention to match equirectangular textures (Y-up Three.js)
const latLonToVector3 = (lat: number, lon: number, radius: number = 1): any => {
  const phi = (90 - lat) * (Math.PI / 180);
  // Shift longitude to match texture meridian origin used in this project
  const theta = (lon - 180) * (Math.PI / 180);

  const x = -(radius * Math.sin(phi) * Math.cos(theta));
  const z = radius * Math.sin(phi) * Math.sin(theta);
  const y = radius * Math.cos(phi);

  return new THREE.Vector3(x, y, z);
};

const Globe = ({ targetLocation, cameraRef, controlsRef, onFocusComplete }: GlobeProps) => {
  const globeRef = useRef<any>(null);
  const groupRef = useRef<any>(null);
  // store previous OrbitControls flags across animations so we can restore them later
  const prevControlsRef = useRef<any>(null);
  // When a location is focused we disable auto-rotation so the selected point stays centered
  const focusRef = useRef<boolean>(false);
  const atmosphereRef = useRef<any>(null);
  const cloudsRef = useRef<any>(null);
  // drag handler state stored so we can attach/detach from anywhere
  const dragStateRef = useRef<any>({ isDragging: false, lastX: 0, lastY: 0, handlers: null });
  // shared rotation helpers and attach/detach so other effects can call them
  const rotSpeed = 0.005; // tweak sensitivity
  const clampX = (v: number) => Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, v));
  // world Y axis vector for rotateOnWorldAxis
  const worldYAxis = new THREE.Vector3(0, 1, 0);

  const attachGroupDrag = () => {
    const controls = controlsRef.current;
    const dom = (controls as any)?.domElement || (controls as any)?.renderer?.domElement || window;

    const onPointerDown = (ev: any) => {
      if (ev.button !== undefined && ev.button !== 0) return;
      dragStateRef.current.isDragging = true;
      dragStateRef.current.lastX = ev.clientX;
      dragStateRef.current.lastY = ev.clientY;
      try { (dom as any).setPointerCapture?.(ev.pointerId); } catch (e) {}
    };

    const onPointerMove = (ev: any) => {
      if (!dragStateRef.current.isDragging) return;
      const dx = ev.clientX - dragStateRef.current.lastX;
      const dy = ev.clientY - dragStateRef.current.lastY;
      dragStateRef.current.lastX = ev.clientX;
      dragStateRef.current.lastY = ev.clientY;
      if (groupRef.current) {
        // rotate around world Y axis so rotation stays visually centered even with axial tilt
        groupRef.current.rotateOnWorldAxis(worldYAxis, dx * rotSpeed);
        groupRef.current.rotation.x = clampX(groupRef.current.rotation.x - dy * rotSpeed);
      }
    };

    const onPointerUp = (ev: any) => {
      dragStateRef.current.isDragging = false;
      try { (dom as any).releasePointerCapture?.(ev.pointerId); } catch (e) {}
    };

    dragStateRef.current.handlers = { onPointerDown, onPointerMove, onPointerUp, dom };
    dom.addEventListener('pointerdown', onPointerDown);
    dom.addEventListener('pointermove', onPointerMove);
    dom.addEventListener('pointerup', onPointerUp);
    dom.addEventListener('pointercancel', onPointerUp);
  };

  const detachGroupDrag = () => {
    const h = dragStateRef.current.handlers;
    if (!h) return;
    const dom = h.dom || window;
    try {
      dom.removeEventListener('pointerdown', h.onPointerDown);
      dom.removeEventListener('pointermove', h.onPointerMove);
      dom.removeEventListener('pointerup', h.onPointerUp);
      dom.removeEventListener('pointercancel', h.onPointerUp);
    } catch (e) {}
    dragStateRef.current.handlers = null;
    dragStateRef.current.isDragging = false;
  };

  // Load earth map + cloud textures
  const earthMap = useLoader(TextureLoader, new URL('../assets/earth-day.jpg', import.meta.url).href);
  const cloudMap = useLoader(TextureLoader, new URL('../assets/earth-clouds.jpg', import.meta.url).href);

  // Try to find a night/lights texture in the assets folder (e.g. earth-lights.jpg)
  // Use import.meta.globEager so we can detect presence at build time. If none found,
  // fall back to a 1x1 transparent image so the useLoader hook always runs.
  const lightsModules = (import.meta as any).globEager ? (import.meta as any).globEager('../assets/*lights*') : {};
  const firstVal: any = Object.values(lightsModules)[0];
  const lightsUrl = firstVal ? firstVal.default : null;
  const transparentDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
  const lightsMap = useLoader(TextureLoader, lightsUrl || transparentDataUrl);
  const hasLights = !!lightsUrl;

  // Ensure correct color encoding for PBR/standard materials
  try {
    // Some three/@types versions don't expose sRGBEncoding in the TS defs.
    // Do a runtime lookup and assign defensively to avoid type errors.
    const sRGB = (THREE as any).sRGBEncoding || (THREE as any).SRGBEncoding || (THREE as any).SRGBColorSpace || (THREE as any).LinearSRGBColorSpace;
    if (earthMap) {
      (earthMap as any).encoding = sRGB || (earthMap as any).encoding;
      try { earthMap.flipY = true; } catch (e) {}
    }
    if (cloudMap) (cloudMap as any).encoding = sRGB || (cloudMap as any).encoding;
    if (lightsMap && hasLights) (lightsMap as any).encoding = sRGB || (lightsMap as any).encoding;
  } catch (e) {
    // ignore if encoding not supported in this three version
  }

  // Apply an Earth's axial tilt so it looks natural
  useEffect(() => {
    if (groupRef.current) {
      // tilt ~23.4 degrees
      groupRef.current.rotation.z = -23.4 * Math.PI / 180;
    }
  }, []);

  // Use SphereGeometry so equirectangular textures map with standard UVs (matches globe_test.html)
  const icosaGeo = useMemo(() => new THREE.SphereGeometry(1, 64, 64), []);
  const icosaCloudGeo = useMemo(() => new THREE.SphereGeometry(1.003, 64, 64), []);

  // starfield from example
  const starsObj = useMemo(() => {
    try {
      return getStarfield({ numStars: 2000 });
    } catch (e) {
      return null;
    }
  }, []);

  // (debug markers removed) -- production mode

  // Auto-rotation (slower, match example feel). Disabled while a location is focused.
  useFrame((state, delta) => {
    if (!focusRef.current) {
      if (groupRef.current) groupRef.current.rotateOnWorldAxis(worldYAxis, delta * 0.002);
      if (cloudsRef.current) cloudsRef.current.rotation.y += delta * 0.0023;
    }
  });

  // Animate to target location: refine animation to include controls.target and smoother zooming
  useEffect(() => {
    if (!targetLocation || !globeRef.current || !cameraRef.current || !controlsRef.current) return;

    const group = groupRef.current as any;
    const camera = cameraRef.current as any;
    const controls = controlsRef.current;

    // Convert target location to 3D position (on globe surface in local group space)
    const localTarget = latLonToVector3(targetLocation.lat, targetLocation.lon, 1.0);

    // We'll animate the camera (position + quaternion) and controls.target rather than rotating the globe group.
    // This keeps the globe's orientation and rotation intact and makes orbiting around the focused point natural.

    // Compute the world-space surface point for the target (apply group's axial tilt via group.quaternion)
    const worldTargetPoint = localTarget.clone().applyQuaternion(group.quaternion).normalize();

    // Small north helper to compute 'north' direction in world space
    const localNorth = latLonToVector3(targetLocation.lat + 0.01, targetLocation.lon, 1.0);
    const worldNorthDir = localNorth.clone().applyQuaternion(group.quaternion).normalize();

    // Desired camera distance (zoom) - move the camera closer but don't intersect the globe
    const currentCamDistance = camera.position.length();
    const zoomInDistance = Math.max(1.3, currentCamDistance * 0.55);

    // Desired camera end position: along the same direction as the surface point but pulled back to zoomInDistance
    const cameraEndPos = worldTargetPoint.clone().multiplyScalar(zoomInDistance);

    // Compute desired camera quaternion such that camera looks at worldTargetPoint and 'north' on screen points upward.
    // Start by creating a basis where camera's forward is (target - camPos) and up is approximated by projecting worldNorthDir
    const lookDir = worldTargetPoint.clone().sub(cameraEndPos).normalize();
    // Compute a provisional quaternion to look from cameraEndPos to the target
    const m = new THREE.Matrix4();
    m.lookAt(cameraEndPos, worldTargetPoint, worldNorthDir);
    const desiredQuat = new THREE.Quaternion().setFromRotationMatrix(m);

    // Controls target should be the surface point so orbit controls revolve around that location
    const startControlsTarget = controls?.target ? (controls.target as any).clone() : new THREE.Vector3(0, 0, 0);
    const endControlsTarget = worldTargetPoint.clone().multiplyScalar(1.0);

    // mark focus so auto-rotation stops while animating/focused
    focusRef.current = true;
    // preserve relevant OrbitControls flags so we can restore them after animation
    prevControlsRef.current = {
      enableRotate: (controls as any).enableRotate ?? true,
      enableZoom: (controls as any).enableZoom ?? true,
      enablePan: (controls as any).enablePan ?? true,
      autoRotate: (controls as any).autoRotate ?? false,
      // store original controls.target so we can restore it later
      target: controls?.target ? (controls.target as any).clone() : new THREE.Vector3(0, 0, 0)
    };

    // During the animation we disable user input; after animation we'll restore zoom/pan and attach custom globe-rotate handlers
    (controls as any).enableRotate = false;
    (controls as any).enableZoom = false;
    (controls as any).enablePan = false;
    (controls as any).autoRotate = false;
    controls.enabled = false;

    // Use the shared attach/detach helpers defined at component scope

    const tl = gsap.timeline({ onComplete: () => {
      // restore zoom/pan/autorotate flags but keep rotate disabled because we'll drive group rotation instead
      (controls as any).enableRotate = false;
      (controls as any).enableZoom = prevControlsRef.current?.enableZoom ?? true;
      (controls as any).enablePan = prevControlsRef.current?.enablePan ?? true;
      (controls as any).autoRotate = prevControlsRef.current?.autoRotate ?? false;
      controls.enabled = true;
      try { controls.update(); } catch (e) {}
      // attach pointer handlers to rotate the globe itself (uses shared helper)
      attachGroupDrag();
      try { onFocusComplete && onFocusComplete(); } catch (e) {}
    } });

    // Animate camera.position to cameraEndPos
    tl.to(camera.position, {
      x: cameraEndPos.x,
      y: cameraEndPos.y,
      z: cameraEndPos.z,
      duration: 1.6,
      ease: 'power2.inOut',
      onUpdate: () => {
        // keep camera looking at controls.target as it animates below
        const lookAtPoint = controls && (controls as any).target ? (controls as any).target : endControlsTarget;
        camera.lookAt(lookAtPoint.x, lookAtPoint.y, lookAtPoint.z);
        if (controls && (controls as any).update) (controls as any).update();
      }
    }, 0);

    // Animate camera quaternion from current to desiredQuat
    const startCamQuat = camera.quaternion.clone();
    const camQuatObj = { t: 0 };
    const tmpCamQuat = new THREE.Quaternion();
    tl.to(camQuatObj, {
      t: 1,
      duration: 1.6,
      ease: 'power2.inOut',
      onUpdate: function() {
        const t = (this as any).targets()[0].t as number;
        // use instance slerpQuaternions to interpolate into a tmp quaternion, then copy to camera.quaternion
        tmpCamQuat.slerpQuaternions(startCamQuat, desiredQuat, t);
        camera.quaternion.copy(tmpCamQuat);
        if (controls && (controls as any).update) (controls as any).update();
      }
    }, 0);

    // Animate controls.target to the surface point so orbit controls now revolve around the clicked location
    if (controls && controls.target) {
      const ctl = { x: startControlsTarget.x, y: startControlsTarget.y, z: startControlsTarget.z };
      tl.to(ctl, {
        x: endControlsTarget.x,
        y: endControlsTarget.y,
        z: endControlsTarget.z,
        duration: 1.6,
        ease: 'power2.inOut',
        onUpdate: function() {
          if (controls) controls.target.set(ctl.x, ctl.y, ctl.z);
        }
      }, 0);
    }

  return () => { detachGroupDrag(); tl.kill(); };
  }, [targetLocation?.lat, targetLocation?.lon]);

  // When the user clears the target location, animate a smooth reset to center
  useEffect(() => {
    if (!targetLocation) {
      focusRef.current = false;
      // detach any custom drag handlers attached during focus
      try { detachGroupDrag(); } catch (e) {}

      const controls = controlsRef.current;
      const camera = cameraRef.current;

      if (controls && camera) {
        // prepare animation start/end values
        const startTarget = (controls as any).target ? (controls as any).target.clone() : new THREE.Vector3(0, 0, 0);
        const endTarget = new THREE.Vector3(0, 0, 0);

        const startCamPos = camera.position.clone();
        const startCamQuat = camera.quaternion.clone();

        // compute a nicer end camera position: keep same radius but point away from origin
        const radius = Math.max(startCamPos.length(), 2);
        const camDir = startCamPos.clone().normalize().multiplyScalar(radius);
        const endCamPos = camDir;

        const ctl = { x: startTarget.x, y: startTarget.y, z: startTarget.z };
        const camPosObj = { x: startCamPos.x, y: startCamPos.y, z: startCamPos.z };
        const camQuatObj = { t: 0 };

        const tmpQuat = new THREE.Quaternion();
        const m = new THREE.Matrix4();
        m.lookAt(endCamPos, endTarget, new THREE.Vector3(0, 1, 0));
        const desiredQuat = new THREE.Quaternion().setFromRotationMatrix(m);

        const tl = gsap.timeline({ onComplete: () => {
          // restore control flags after animation and enable controls
          (controls as any).enableRotate = prevControlsRef.current?.enableRotate ?? true;
          (controls as any).enableZoom = prevControlsRef.current?.enableZoom ?? true;
          (controls as any).enablePan = prevControlsRef.current?.enablePan ?? true;
          (controls as any).autoRotate = prevControlsRef.current?.autoRotate ?? false;
          controls.enabled = true;
          try { controls.update(); } catch (e) {}
          prevControlsRef.current = null;
        } });

        tl.to(ctl, {
          x: endTarget.x,
          y: endTarget.y,
          z: endTarget.z,
          duration: 0.9,
          ease: 'power2.inOut',
          onUpdate: function() {
            try { (controls as any).target.set(ctl.x, ctl.y, ctl.z); } catch (e) {}
          }
        }, 0);

        tl.to(camPosObj, {
          x: endCamPos.x,
          y: endCamPos.y,
          z: endCamPos.z,
          duration: 0.9,
          ease: 'power2.inOut',
          onUpdate: function() {
            try { camera.position.set(camPosObj.x, camPosObj.y, camPosObj.z); } catch (e) {}
            try { camera.lookAt(0,0,0); } catch (e) {}
            if (controls && (controls as any).update) try { (controls as any).update(); } catch (e) {}
          }
        }, 0);

        tl.to(camQuatObj, {
          t: 1,
          duration: 0.9,
          ease: 'power2.inOut',
          onUpdate: function() {
            const t = (this as any).targets()[0].t as number;
            tmpQuat.slerpQuaternions(startCamQuat, desiredQuat, t);
            try { camera.quaternion.copy(tmpQuat); } catch (e) {}
          }
        }, 0);

      } else if (controls) {
        // fallback: snap to origin
        try { (controls as any).target.set(0,0,0); } catch (e) {}
        (controls as any).enableRotate = prevControlsRef.current?.enableRotate ?? true;
        (controls as any).enableZoom = prevControlsRef.current?.enableZoom ?? true;
        (controls as any).enablePan = prevControlsRef.current?.enablePan ?? true;
        (controls as any).autoRotate = prevControlsRef.current?.autoRotate ?? false;
        controls.enabled = true;
        try { controls.update(); } catch (e) {}
        prevControlsRef.current = null;
      }
    }
  }, [targetLocation]);

  return (
    <group ref={groupRef}>
      {/* Main stylized globe sphere */}
      {/* Main stylized globe sphere */}
      <mesh ref={globeRef} geometry={icosaGeo} renderOrder={0}>
        <meshPhongMaterial
          map={earthMap}
          color="#ffffff"
          shininess={10}
          specular={new THREE.Color(0x222222)}
        />
      </mesh>

      {/* wireframe removed per user request */}

      {/* Inner glow layer (subtle) */}
      <mesh scale={0.98}>
        <sphereGeometry args={[1, 64, 64]} />
        <meshBasicMaterial
          color="#6366f1"
          transparent
          opacity={0.08}
          side={THREE.BackSide}
        />
      </mesh>

      {/* Cloud layer (more transparent so the base map shows through) */}
      {/* Render a location marker when a targetLocation is provided */}
      {targetLocation && (
        <LocationMarker lat={targetLocation.lat} lon={targetLocation.lon} label={targetLocation.label} />
      )}
      {cloudMap && (
        <mesh ref={cloudsRef} scale={1.003} geometry={icosaCloudGeo} renderOrder={1}>
          <meshStandardMaterial
            map={cloudMap}
            transparent
            opacity={0.25}
            depthWrite={false}
            alphaTest={0.01}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      )}

      {/* Atmosphere glow (soft additive sprite-like shell) */}
      <mesh ref={atmosphereRef} scale={1.12}>
        <sphereGeometry args={[1.12, 64, 64]} />
        <meshBasicMaterial
          color="#7c3aed"
          transparent
          opacity={0.09}
          side={THREE.BackSide}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      {/* Night lights mesh (if available) - additive so it blends correctly; it is a sibling child of the globe and rotates with the group */}
      {hasLights && (
        <mesh scale={1.001} geometry={icosaGeo}>
          <meshBasicMaterial map={lightsMap} blending={THREE.AdditiveBlending} transparent opacity={0.9} toneMapped={false} />
        </mesh>
      )}

  {/* starfield */}
  {starsObj && <primitive object={starsObj} />}

      {/* debug markers removed */}

  {/* Location marker */}
      {targetLocation && (
        <LocationMarker
          lat={targetLocation.lat}
          lon={targetLocation.lon}
          label={targetLocation.label}
        />
      )}
    </group>
  );
};

export default Globe;



