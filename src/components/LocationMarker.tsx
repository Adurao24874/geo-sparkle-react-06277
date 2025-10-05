import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface LocationMarkerProps {
  lat: number;
  lon: number;
  label?: string;
}

// Convert lat/lon to 3D cartesian coordinates (consistent with Globe component)
const latLonToVector3 = (lat: number, lon: number, radius: number = 1): any => {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lon - 180) * (Math.PI / 180);

  const x = -(radius * Math.sin(phi) * Math.cos(theta));
  const z = radius * Math.sin(phi) * Math.sin(theta);
  const y = radius * Math.cos(phi);

  return new THREE.Vector3(x, y, z);
};

const LocationMarker = ({ lat, lon, label }: LocationMarkerProps) => {
  const markerRef = useRef<any>(null);
  const glowRef = useRef<any>(null);

  // Position on globe surface (slightly above surface so it renders over clouds)
  const position = latLonToVector3(lat, lon, 1.02);

  // Pulsating animation
  useFrame((state) => {
    if (markerRef.current && glowRef.current) {
      const scale = 1 + Math.sin(state.clock.elapsedTime * 2) * 0.2;
      markerRef.current.scale.set(scale, scale, scale);
      glowRef.current.scale.set(scale * 1.5, scale * 1.5, scale * 1.5);
    }
  });

  return (
    <group position={position}>
      {/* Glow effect */}
      <mesh ref={glowRef}>
        <sphereGeometry args={[0.03, 16, 16]} />
        <meshBasicMaterial
          color="#7c3aed"
          transparent
          opacity={0.45}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      
      {/* Main marker dot */}
      <mesh ref={markerRef}>
        <sphereGeometry args={[0.016, 16, 16]} />
        <meshStandardMaterial color="#c7d2fe" emissive="#c7d2fe" emissiveIntensity={0.6} />
      </mesh>
      
      {/* Pin/stick */}
      <mesh position={[0, 0.03, 0]}>
        <cylinderGeometry args={[0.001, 0.001, 0.04, 8]} />
        <meshBasicMaterial color="#818cf8" transparent opacity={0.8} />
      </mesh>
    </group>
  );
};

export default LocationMarker;
