"use client";

import React, { useEffect, useRef } from "react";
import * as THREE from "three";
import gsap from "gsap";

interface LandingSceneProps {
  onBurstRef?: React.MutableRefObject<(() => void) | null>;
  onReady?: () => void;
}

export default function LandingScene({ onBurstRef, onReady }: LandingSceneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLSpanElement>(null);

  const onReadyRef = useRef(onReady);
  const onBurstRefHolder = useRef(onBurstRef);

  useEffect(() => {
    onReadyRef.current = onReady;
    onBurstRefHolder.current = onBurstRef;
  }, [onReady, onBurstRef]);

  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return;

    const cv = canvasRef.current;
    const wrap = containerRef.current;
    const tip = tooltipRef.current;
    const status = statusRef.current;

    let renderer: THREE.WebGLRenderer | null = null;
    try {
      renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true });
    } catch {
      wrap.classList.add("nogl");
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 2.4, 20);

    const root = new THREE.Group();
    scene.add(root);

    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const pointLight = new THREE.PointLight(0x7c8cff, 2.2, 40);
    root.add(pointLight);

    const AC = 0x7c8cff;
    const OK = 0x4ade9a;
    const BAD = 0xff6b6b;
    const ZERO = new THREE.Vector3();

    // Core
    const core = new THREE.Group();
    root.add(core);

    const icoGeo = new THREE.IcosahedronGeometry(1.15, 1);
    const icoMat = new THREE.MeshBasicMaterial({ color: AC, wireframe: true });
    const ico = new THREE.Mesh(icoGeo, icoMat);

    const innerGeo = new THREE.SphereGeometry(0.6, 24, 24);
    const innerMat = new THREE.MeshBasicMaterial({ color: AC });
    const inner = new THREE.Mesh(innerGeo, innerMat);

    const haloGeo = new THREE.SphereGeometry(1.6, 24, 24);
    const haloMat = new THREE.MeshBasicMaterial({
      color: AC,
      transparent: true,
      opacity: 0.12,
      side: THREE.BackSide,
    });
    const halo = new THREE.Mesh(haloGeo, haloMat);
    core.add(ico, inner, halo);
    core.scale.setScalar(0);
    let corePulse = 0;

    // Worker nodes
    const W: THREE.Mesh[] = [];
    for (let i = 0; i < 6; i++) {
      const ring = i % 2;
      const wGeo = new THREE.SphereGeometry(0.4, 24, 24);
      const wMat = new THREE.MeshStandardMaterial({
        color: 0x1a2030,
        emissive: AC,
        emissiveIntensity: 0.55,
        roughness: 0.4,
      });
      const m = new THREE.Mesh(wGeo, wMat);
      m.userData = {
        i,
        done: 0,
        dead: false,
        rm: 0,
        a: (i / 6) * Math.PI * 2,
        r: ring ? 5.3 : 4,
        tilt: ring ? -0.35 : 0.4,
        sp: ring ? -0.22 : 0.3,
        pulse: 0,
        deadT: 0,
      };
      m.scale.setScalar(0);
      root.add(m);

      const lineGeo = new THREE.BufferGeometry().setFromPoints([ZERO, ZERO]);
      const lineMat = new THREE.LineBasicMaterial({
        color: AC,
        transparent: true,
        opacity: 0.22,
      });
      const ln = new THREE.Line(lineGeo, lineMat);
      ln.frustumCulled = false;
      root.add(ln);
      m.userData.ln = ln;
      W.push(m);
    }

    // Background Stars
    const sp: number[] = [];
    for (let i = 0; i < 320; i++) {
      const v = new THREE.Vector3(
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 2
      ).normalize().multiplyScalar(11 + Math.random() * 7);
      sp.push(v.x, v.y, v.z);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute("position", new THREE.Float32BufferAttribute(sp, 3));
    const starMat = new THREE.PointsMaterial({
      color: 0x8a92a6,
      size: 0.07,
      transparent: true,
      opacity: 0.6,
    });
    const stars = new THREE.Points(starGeo, starMat);
    scene.add(stars);

    // Particles (Tasks in flight)
    interface Particle {
      m: THREE.Mesh;
      on: boolean;
      t: number;
      from: THREE.Vector3;
      w: THREE.Mesh | null;
      ph: "out" | "back";
      hold: number;
    }
    const P: Particle[] = [];
    for (let i = 0; i < 26; i++) {
      const pGeo = new THREE.SphereGeometry(0.1, 10, 10);
      const pMat = new THREE.MeshBasicMaterial({ color: AC });
      const m = new THREE.Mesh(pGeo, pMat);
      m.visible = false;
      root.add(m);
      P.push({ m, on: false, t: 0, from: new THREE.Vector3(), w: null, ph: "out", hold: 0 });
    }

    const alive = () => W.filter((w) => !w.userData.dead && w.userData.rm > 0.9);

    function spawn(w: THREE.Mesh) {
      const p = P.find((x) => !x.on);
      if (!p || !w) return;
      Object.assign(p, { on: true, t: 0, w, ph: "out", hold: 0 });
      p.from.set(0, 0, 0);
      (p.m.material as THREE.MeshBasicMaterial).color.setHex(AC);
      p.m.visible = true;
    }

    const burst = () => {
      alive().forEach((w, i) => setTimeout(() => spawn(w), i * 80));
    };

    if (onBurstRefHolder.current) {
      onBurstRefHolder.current.current = () => {
        corePulse = 1;
        burst();
      };
    }

    function revive(w: THREE.Mesh) {
      const u = w.userData;
      if (!u.dead) return;
      u.dead = false;
      (w.material as THREE.MeshStandardMaterial).emissive.setHex(AC);
      if (status) status.textContent = `worker-${u.i + 1} back online`;
    }

    function crash(w: THREE.Mesh) {
      const u = w.userData;
      if (u.dead) {
        revive(w);
        return;
      }
      u.dead = true;
      u.deadT = 0;
      (w.material as THREE.MeshStandardMaterial).emissive.setHex(BAD);
      P.forEach((p) => {
        if (p.on && p.ph === "out" && p.w === w) {
          p.hold = 0.9;
          p.from.copy(p.m.position);
          (p.m.material as THREE.MeshBasicMaterial).color.setHex(BAD);
        }
      });
      if (status) {
        status.textContent = `worker-${u.i + 1} simulated crash · re-routing`;
      }
      setTimeout(() => {
        if (status) status.textContent = `worker-${u.i + 1} re-routed ✓`;
      }, 950);
      setTimeout(() => revive(w), 4200);
    }

    // Interaction
    const ray = new THREE.Raycaster();
    const mp = new THREE.Vector2();
    let down: { x: number; rot: number } | null = null;
    let drag = false;
    let rot = 0;
    let rotT = 0;
    let hov: THREE.Object3D | null = null;
    let ready = false;

    const pick = (e: PointerEvent) => {
      const b = cv.getBoundingClientRect();
      mp.set(((e.clientX - b.left) / b.width) * 2 - 1, -((e.clientY - b.top) / b.height) * 2 + 1);
      ray.setFromCamera(mp, camera);
      const hits = ray.intersectObjects([...W, inner, ico], false);
      return hits[0] ? hits[0].object : null;
    };

    const handlePointerDown = (e: PointerEvent) => {
      down = { x: e.clientX, rot: rotT };
      drag = false;
      cv.setPointerCapture(e.pointerId);
      cv.style.cursor = "grabbing";
    };

    const handlePointerMove = (e: PointerEvent) => {
      const b = cv.getBoundingClientRect();
      mp.set(((e.clientX - b.left) / b.width) * 2 - 1, -((e.clientY - b.top) / b.height) * 2 + 1);

      if (down) {
        const dx = e.clientX - down.x;
        if (Math.abs(dx) > 5) drag = true;
        if (drag) rotT = down.rot + dx * 0.01;
        return;
      }

      const o = pick(e);
      hov = o;
      cv.style.cursor = o ? "pointer" : "grab";

      if (tip && o && W.includes(o as THREE.Mesh)) {
        const u = (o as THREE.Mesh).userData;
        tip.textContent = u.dead
          ? `worker-${u.i + 1} · simulated crash (click to revive)`
          : `worker-${u.i + 1} · active`;
        tip.style.transform = `translate(${e.clientX - b.left + 14}px,${e.clientY - b.top + 14}px)`;
        tip.style.opacity = "1";
      } else if (tip) {
        tip.style.opacity = "0";
      }
    };

    const handlePointerLeave = () => {
      if (tip) tip.style.opacity = "0";
      hov = null;
    };

    const handlePointerUp = (e: PointerEvent) => {
      cv.style.cursor = hov ? "pointer" : "grab";
      if (!drag) {
        const o = pick(e);
        if (o) {
          if (W.includes(o as THREE.Mesh)) {
            crash(o as THREE.Mesh);
          } else {
            corePulse = 1;
            burst();
          }
        }
      }
      down = null;
      drag = false;
      rotT = 0;
    };

    cv.addEventListener("pointerdown", handlePointerDown);
    cv.addEventListener("pointermove", handlePointerMove);
    cv.addEventListener("pointerleave", handlePointerLeave);
    cv.addEventListener("pointerup", handlePointerUp);

    // Resize and visibility observers
    let visible = true;
    const io = new IntersectionObserver((entries) => {
      visible = entries[0].isIntersecting;
    });
    io.observe(wrap);

    const ro = new ResizeObserver(() => {
      if (!renderer) return;
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    });
    ro.observe(wrap);

    // Initial entrance animation
    gsap.to(camera.position, { z: 14, duration: 2.4, ease: "power3.out" });
    gsap.to(core.scale, { x: 1, y: 1, z: 1, duration: 1.5, ease: "elastic.out(1,.5)" });
    W.forEach((w, i) => {
      gsap.to(w.scale, { x: 1, y: 1, z: 1, duration: 0.9, delay: 0.5 + i * 0.12, ease: "back.out(2)" });
      gsap.to(w.userData, { rm: 1, duration: 1.8, delay: 0.5 + i * 0.12, ease: "power3.out" });
    });
    gsap.delayedCall(1.8, () => {
      ready = true;
      burst();
      if (onReadyRef.current) onReadyRef.current();
    });

    // Animation loop using performance.now()
    let lastTime = performance.now();
    const startTime = lastTime;
    let acc = 0;
    let animId = 0;

    const frame = () => {
      animId = requestAnimationFrame(frame);
      const now = performance.now();
      const rawDt = (now - lastTime) / 1000;
      lastTime = now;
      if (!visible || document.hidden || !renderer) {
        return;
      }
      const dt = Math.min(rawDt, 0.05);
      const t = (now - startTime) / 1000;
      acc += dt;

      if (ready && acc > 0.45) {
        acc = 0;
        const a = alive();
        if (a.length) spawn(a[(Math.random() * a.length) | 0]);
      }

      rot += (rotT - rot) * 0.08;
      root.rotation.y = rot;
      ico.rotation.y += dt * 0.4;
      ico.rotation.x += dt * 0.2;
      stars.rotation.y += dt * 0.01;

      corePulse = Math.max(0, corePulse - dt * 2.5);
      inner.scale.setScalar(1 + corePulse * 0.5 + Math.sin(t * 2) * 0.04);

      W.forEach((w) => {
        const u = w.userData;
        u.a += u.sp * dt;
        const rr = u.r * u.rm;
        w.position.set(
          Math.cos(u.a) * rr,
          Math.sin(u.a) * rr * Math.sin(u.tilt),
          Math.sin(u.a) * rr * Math.cos(u.tilt)
        );

        const pa = (u.ln.geometry.attributes.position as THREE.BufferAttribute);
        pa.setXYZ(1, w.position.x, w.position.y, w.position.z);
        pa.needsUpdate = true;

        u.ln.material.color.setHex(u.dead ? BAD : AC);
        u.ln.material.opacity = u.dead ? 0.1 : 0.22;
        u.pulse = Math.max(0, u.pulse - dt * 3);

        if (u.dead) {
          u.deadT += dt;
          (w.material as THREE.MeshStandardMaterial).emissiveIntensity =
            u.deadT < 0.8 ? (Math.sin(t * 50) > 0 ? 1.2 : 0.1) : 0.7;
        } else {
          (w.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.55 + u.pulse * 1.4;
        }

        const base = (u.dead ? 0.85 : 1) * (hov === w ? 1.25 : 1);
        if (u.rm > 0.05) {
          const s = w.scale.x;
          if (!gsap.isTweening(w.scale)) w.scale.setScalar(s + (base - s) * 0.2);
        }
      });

      P.forEach((p) => {
        if (!p.on || !p.w) return;
        if (p.hold > 0) {
          p.hold -= dt;
          if (p.hold <= 0) {
            const a = alive();
            if (a.length) {
              p.w = a[(Math.random() * a.length) | 0];
              p.t = 0;
              p.ph = "out";
              (p.m.material as THREE.MeshBasicMaterial).color.setHex(AC);
            } else {
              p.on = false;
              p.m.visible = false;
            }
          }
          return;
        }

        p.t += dt * 0.8;
        const tg = p.ph === "out" ? p.w.position : ZERO;
        p.m.position.lerpVectors(p.from, tg, Math.min(p.t, 1));
        p.m.position.y += Math.sin(Math.PI * Math.min(p.t, 1)) * 0.5;

        if (p.t >= 1) {
          if (p.ph === "out") {
            p.w.userData.pulse = 1;
            p.w.userData.done++;
            p.from.copy(p.w.position);
            p.ph = "back";
            p.t = 0;
            (p.m.material as THREE.MeshBasicMaterial).color.setHex(OK);
          } else {
            corePulse = Math.max(corePulse, 0.5);
            p.on = false;
            p.m.visible = false;
          }
        }
      });

      const px = mp.x * 1.8;
      const py = 2.4 - mp.y * 1.2;
      camera.position.x += (px - camera.position.x) * 0.04;
      camera.position.y += (py - camera.position.y) * 0.04;
      camera.lookAt(0, 0, 0);

      renderer.render(scene, camera);
    };

    frame();

    return () => {
      cancelAnimationFrame(animId);
      io.disconnect();
      ro.disconnect();
      cv.removeEventListener("pointerdown", handlePointerDown);
      cv.removeEventListener("pointermove", handlePointerMove);
      cv.removeEventListener("pointerleave", handlePointerLeave);
      cv.removeEventListener("pointerup", handlePointerUp);

      renderer?.dispose();
      icoGeo.dispose();
      icoMat.dispose();
      innerGeo.dispose();
      innerMat.dispose();
      haloGeo.dispose();
      haloMat.dispose();
      starGeo.dispose();
      starMat.dispose();
    };
  }, []);

  return (
    <div className="flex flex-col gap-3 w-full">
      <div
        ref={containerRef}
        id="stage"
        className="relative min-h-[400px] h-[min(74vh,680px)] rounded-[24px] border border-[var(--line)] bg-[var(--surface)] overflow-hidden"
        style={{
          background:
            "radial-gradient(circle at 50% 50%, rgba(124,140,255,0.16), transparent 62%), var(--surface)",
        }}
      >
        <canvas ref={canvasRef} id="cv" className="w-full h-full block cursor-grab touch-pan-y" />
        <div
          ref={tooltipRef}
          id="tip"
          className="absolute left-0 top-0 pointer-events-none opacity-0 bg-[var(--surface-2)] border border-[var(--line)] px-2.5 py-1.5 rounded-lg text-xs whitespace-nowrap font-mono transition-opacity duration-150 z-10"
        />
        <div className="hidden nogl:grid place-items-center h-full text-[var(--dim)] p-6 text-center">
          3D demo is off (reduced motion or no WebGL). Relay splits a job into tasks, runs them across
          worker nodes, and merges the results.
        </div>
      </div>
      <div className="flex justify-between items-center text-xs text-[var(--dim)] px-2">
        <span ref={statusRef} id="status" className="font-mono">
          Click a worker to crash it · click the core for a burst
        </span>
        <span className="opacity-70">Interactive 3D Demo</span>
      </div>
    </div>
  );
}
