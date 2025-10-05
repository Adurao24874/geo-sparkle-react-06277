declare namespace JSX {
  interface IntrinsicElements {
    group: any;
    mesh: any;
    sphereGeometry: any;
    cylinderGeometry: any;
    meshBasicMaterial: any;
    meshStandardMaterial: any;
    meshPhongMaterial: any;
    meshPhysicalMaterial: any;
    pointLight: any;
    ambientLight: any;
    directionalLight: any;
  }
}

declare module '*.svg';
declare module '*.png';
declare module '*.jpg';

declare module '@react-three/fiber';
declare module 'gsap';
declare module '@vitejs/plugin-react-swc';
