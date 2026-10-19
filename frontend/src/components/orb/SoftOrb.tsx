"use client";

import React, { useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";

function AnimatedOrb({ isDispersing }: { isDispersing?: boolean }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const particlesRef = useRef<THREE.Points>(null);

  useFrame((state, delta) => {
    if (meshRef.current) {
      meshRef.current.rotation.y += delta * 0.4;
      meshRef.current.rotation.x += delta * 0.2;
      const t = state.clock.getElapsedTime();
      meshRef.current.scale.setScalar(1 + Math.sin(t * 1.5) * 0.04);
    }
    if (particlesRef.current) {
      particlesRef.current.rotation.y -= delta * (isDispersing ? 0.8 : 0.15);
      if (isDispersing) {
        particlesRef.current.scale.multiplyScalar(1 + delta * 0.2);
      }
    }
  });

  return (
    <group>
      {/* Translucent Soft Glass Orb */}
      <mesh ref={meshRef}>
        <sphereGeometry args={[1.5, 32, 32]} />
        <meshPhysicalMaterial
          color="#5B6CFF"
          roughness={0.15}
          transmission={0.85}
          thickness={0.8}
          transparent
          opacity={0.7}
        />
      </mesh>

      {/* Floating particles around it */}
      <points ref={particlesRef}>
        <sphereGeometry args={[2.2, 24, 24]} />
        <pointsMaterial color="#7C8CFF" size={0.06} transparent opacity={0.6} />
      </points>
    </group>
  );
}

export default function SoftOrb({ isDispersing = false }: { isDispersing?: boolean }) {
  return (
    <div className="w-[180px] h-[180px] hidden md:block">
      <Canvas camera={{ position: [0, 0, 4.5], fov: 45 }}>
        <ambientLight intensity={0.9} />
        <pointLight position={[5, 5, 5]} intensity={1.5} color="#5B6CFF" />
        <pointLight position={[-5, -5, -5]} intensity={0.8} color="#A0ACFF" />
        <AnimatedOrb isDispersing={isDispersing} />
      </Canvas>
    </div>
  );
}
