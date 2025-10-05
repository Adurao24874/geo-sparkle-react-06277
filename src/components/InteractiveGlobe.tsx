import { useEffect, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import Globe from './Globe';
import * as THREE from 'three';

export interface TargetLocation {
  lat: number;
  lon: number;
  label?: string;
}

interface InteractiveGlobeProps {
  targetLocation?: TargetLocation;
  onFocusComplete?: () => void;
}

const InteractiveGlobe = ({ targetLocation, onFocusComplete }: InteractiveGlobeProps) => {
  const cameraRef = useRef<THREE.PerspectiveCamera>();
  const controlsRef = useRef<any>();

  return (
    <div className="w-full h-full">
      <Canvas
        camera={{ position: [0, 0, 3], fov: 45 }}
        onCreated={({ camera }) => {
          cameraRef.current = camera as THREE.PerspectiveCamera;
        }}
      >
        <ambientLight intensity={0.3} />
        <directionalLight position={[5, 3, 5]} intensity={1.5} />
        <Globe 
          targetLocation={targetLocation} 
          cameraRef={cameraRef}
          controlsRef={controlsRef}
          onFocusComplete={onFocusComplete}
        />
        <OrbitControls 
          ref={controlsRef}
          enableDamping
          dampingFactor={0.05}
          minDistance={1.5}
          maxDistance={5}
        />
      </Canvas>
    </div>
  );
};

export default InteractiveGlobe;
