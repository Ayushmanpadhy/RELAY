import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import * as THREE from 'three';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useRelayStore } from '../../store/relayStore';
import { api } from '../../api/client';
import type { WorkerInfo, TasksSummary } from '@relay/shared';
import './landing.css';

gsap.registerPlugin(ScrollTrigger);

export function Landing() {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLSpanElement>(null);
  const introRef = useRef<HTMLDivElement>(null);
  const introTRef = useRef<HTMLDivElement>(null);
  const demoBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    const tip = tipRef.current;
    const status = statusRef.current;
    const intro = introRef.current;
    const introT = introTRef.current;
    const demoBtn = demoBtnRef.current;

    if (!container || !stage || !canvas || !tip || !status || !intro || !introT) {
      return;
    }

    // Apply overflow-x: clip and smooth scrolling while mounted
    const prevScrollBehavior = document.documentElement.style.scrollBehavior;
    const prevOverflowX = document.documentElement.style.overflowX;
    const prevBodyOverflowX = document.body.style.overflowX;

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduce) {
      document.documentElement.style.scrollBehavior = 'smooth';
    }
    document.documentElement.style.overflowX = 'clip';
    document.body.style.overflowX = 'clip';

    const R = gsap.utils.random;

    function split(el: HTMLElement) {
      const raw = el.getAttribute('data-raw') || el.textContent?.trim() || '';
      el.setAttribute('data-raw', raw);
      el.setAttribute('aria-label', raw);
      el.innerHTML = '';
      const words = raw.split(' ');
      words.forEach((w, i, a) => {
        const ws = document.createElement('span');
        ws.className = 'w';
        ws.setAttribute('aria-hidden', 'true');
        [...w].forEach((ch) => {
          const s = document.createElement('span');
          s.className = 'c';
          s.textContent = ch;
          ws.appendChild(s);
        });
        el.appendChild(ws);
        if (i < a.length - 1) {
          el.appendChild(document.createTextNode(' '));
        }
      });
      return el.querySelectorAll<HTMLElement>('.c');
    }

    const scatter = (chars: NodeListOf<HTMLElement> | HTMLElement[], extra: gsap.TweenVars = {}) =>
      gsap.from(
        chars,
        Object.assign(
          {
            x: () => R(-700, 700),
            y: () => R(-500, 500),
            rotation: () => R(-540, 540),
            scale: () => R(0.2, 2.2),
            opacity: 0,
            duration: 1.3,
            ease: 'power4.out',
            stagger: { each: 0.02, from: 'random' },
          },
          extra
        )
      );

    /* ---------- 3D scene ---------- */
    function initScene() {
      let r: THREE.WebGLRenderer;
      try {
        r = new THREE.WebGLRenderer({ canvas: canvas!, antialias: true, alpha: true });
      } catch {
        return null;
      }
      r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));

      const sc = new THREE.Scene();
      const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
      cam.position.set(0, 2.4, 20);

      const root = new THREE.Group();
      sc.add(root);

      sc.add(new THREE.AmbientLight(0xffffff, 0.7));
      const pl = new THREE.PointLight(0x7c8cff, 2.2, 40);
      root.add(pl);

      const AC = 0x7c8cff;
      const OK = 0x4ade9a;
      const BAD = 0xff6b6b;
      const ZERO = new THREE.Vector3();

      const core = new THREE.Group();
      root.add(core);

      const icoGeom = new THREE.IcosahedronGeometry(1.15, 1);
      const icoMat = new THREE.MeshBasicMaterial({ color: AC, wireframe: true });
      const ico = new THREE.Mesh(icoGeom, icoMat);

      const innerGeom = new THREE.SphereGeometry(0.6, 24, 24);
      const innerMat = new THREE.MeshBasicMaterial({ color: AC });
      const inner = new THREE.Mesh(innerGeom, innerMat);

      const haloGeom = new THREE.SphereGeometry(1.6, 24, 24);
      const haloMat = new THREE.MeshBasicMaterial({
        color: AC,
        transparent: true,
        opacity: 0.12,
        side: THREE.BackSide,
      });
      const halo = new THREE.Mesh(haloGeom, haloMat);

      core.add(ico, inner, halo);
      core.scale.setScalar(0);
      let corePulse = 0;

      const W: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>[] = [];
      const workerGeom = new THREE.SphereGeometry(0.4, 24, 24);

      let liveWorkersList: WorkerInfo[] = [];
      let liveSummary: TasksSummary = { queued: 0, running: 0, done: 0, dead: 0 };

      // Support up to 8 cluster worker nodes
      const MAX_WORKERS = 8;
      for (let i = 0; i < MAX_WORKERS; i++) {
        const ring = i % 2;
        const workerMat = new THREE.MeshStandardMaterial({
          color: 0x1a2030,
          emissive: AC,
          emissiveIntensity: 0.55,
          roughness: 0.4,
        });
        const m = new THREE.Mesh(workerGeom, workerMat);
        m.userData = {
          i,
          workerId: '',
          workerName: `worker-${i + 1}`,
          pid: null as number | null,
          status: 'IDLE',
          done: 0,
          dead: false,
          active: false,
          rm: 0,
          a: (i / MAX_WORKERS) * Math.PI * 2,
          r: ring ? 5.3 : 4,
          tilt: ring ? -0.35 : 0.4,
          sp: ring ? -0.22 : 0.3,
          pulse: 0,
          deadT: 0,
        };
        m.scale.setScalar(0);
        root.add(m);

        const lineGeom = new THREE.BufferGeometry().setFromPoints([ZERO, ZERO]);
        const lineMat = new THREE.LineBasicMaterial({ color: AC, transparent: true, opacity: 0.22 });
        const ln = new THREE.Line(lineGeom, lineMat);
        ln.frustumCulled = false;
        root.add(ln);
        m.userData.ln = ln;
        W.push(m);
      }

      function updateCluster(workers: WorkerInfo[], summary?: TasksSummary) {
        liveWorkersList = workers;
        if (summary) liveSummary = summary;

        const count = workers.length;
        W.forEach((m, idx) => {
          const u = m.userData;
          if (idx < count) {
            const w = workers[idx];
            u.workerId = w.id;
            u.workerName = w.name;
            u.pid = w.pid;
            u.status = w.status;
            u.done = w.tasks_done;
            const isDead = w.status === 'DEAD' || w.status === 'STOPPED';
            u.dead = isDead;
            u.active = true;

            if (isDead) {
              m.material.emissive.setHex(BAD);
            } else if (w.status === 'BUSY') {
              m.material.emissive.setHex(OK);
            } else {
              m.material.emissive.setHex(AC);
            }

            if (u.rm < 0.95 && !gsap.isTweening(u)) {
              gsap.to(u, { rm: 1, duration: 0.8, ease: 'power2.out' });
              gsap.to(m.scale, { x: 1, y: 1, z: 1, duration: 0.6, ease: 'back.out(1.7)' });
            }
          } else {
            u.active = false;
            u.workerId = '';
            if (u.rm > 0.05 && !gsap.isTweening(u)) {
              gsap.to(u, { rm: 0, duration: 0.5, ease: 'power2.in' });
              gsap.to(m.scale, { x: 0, y: 0, z: 0, duration: 0.4 });
            }
          }
        });
      }

      const sp: number[] = [];
      for (let i = 0; i < 320; i++) {
        const v = new THREE.Vector3(R(-1, 1), R(-1, 1), R(-1, 1)).normalize().multiplyScalar(R(11, 18));
        sp.push(v.x, v.y, v.z);
      }
      const sg = new THREE.BufferGeometry();
      sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
      const starMat = new THREE.PointsMaterial({ color: 0x8a92a6, size: 0.07, transparent: true, opacity: 0.6 });
      const stars = new THREE.Points(sg, starMat);
      sc.add(stars);

      const P: Array<{
        m: THREE.Mesh;
        on: boolean;
        t: number;
        from: THREE.Vector3;
        w: any;
        ph: 'out' | 'back';
        hold: number;
      }> = [];

      const packetGeom = new THREE.SphereGeometry(0.1, 10, 10);
      for (let i = 0; i < 26; i++) {
        const packetMat = new THREE.MeshBasicMaterial({ color: AC });
        const m = new THREE.Mesh(packetGeom, packetMat);
        m.visible = false;
        root.add(m);
        P.push({ m, on: false, t: 0, from: new THREE.Vector3(), w: null, ph: 'out', hold: 0 });
      }

      const alive = () => W.filter((w) => w.userData.active && !w.userData.dead && w.userData.rm > 0.5);

      function spawn(w: any) {
        const p = P.find((x) => !x.on);
        if (!p || !w) return;
        Object.assign(p, { on: true, t: 0, w, ph: 'out', hold: 0 });
        p.from.set(0, 0, 0);
        (p.m.material as THREE.MeshBasicMaterial).color.setHex(AC);
        p.m.visible = true;
      }

      const timeouts: Array<ReturnType<typeof setTimeout>> = [];
      const addTimeout = (fn: () => void, ms: number) => {
        const tid = setTimeout(fn, ms);
        timeouts.push(tid);
        return tid;
      };

      const burst = () => alive().forEach((w, i) => addTimeout(() => spawn(w), i * 80));

      async function onWorkerClick(w: any) {
        const u = w.userData;
        if (!u.workerId) return;

        if (!u.dead) {
          u.dead = true;
          u.deadT = 0;
          w.material.emissive.setHex(BAD);
          let n = 0;
          P.forEach((p) => {
            if (p.on && p.ph === 'out' && p.w === w) {
              p.hold = 0.9;
              n++;
              p.from.copy(p.m.position);
              (p.m.material as THREE.MeshBasicMaterial).color.setHex(BAD);
            }
          });
          status!.textContent = `Terminating worker process ${u.workerName} (PID: ${u.pid || '—'})...`;
          try {
            await api.killWorker(u.workerId);
            status!.textContent = `Worker ${u.workerName} killed · Coordinator sweeper recovering leased tasks ✓`;
          } catch (err: any) {
            status!.textContent = `Worker ${u.workerName} terminated (crash simulated)`;
          }
        } else {
          status!.textContent = 'Spawning new worker process...';
          try {
            await api.spawnWorker();
            status!.textContent = 'New worker process spawned · Registering with cluster ✓';
          } catch (err: any) {
            status!.textContent = 'Worker process spawned';
          }
        }
      }

      async function onCoreClick() {
        corePulse = 1;
        burst();
        status!.textContent = 'Submitting distributed Primes workload to cluster...';
        try {
          const job = await api.createJob('primes', { limit: 5_000_000, chunks: 16 }, 1);
          status!.textContent = `Workload dispatched (ID: ${job.id.slice(0, 8)}) · 16 tasks claimed across workers`;
        } catch (err: any) {
          status!.textContent = 'Dispatched workload across cluster';
        }
      }

      /* interaction */
      const ray = new THREE.Raycaster();
      const mp = new THREE.Vector2();
      let down: { x: number; rot: number } | null = null;
      let drag = false;
      let rot = 0;
      let rotT = 0;
      let hov: any = null;
      let ready = false;

      const pick = (e: PointerEvent) => {
        const b = canvas!.getBoundingClientRect();
        mp.set(((e.clientX - b.left) / b.width) * 2 - 1, -((e.clientY - b.top) / b.height) * 2 + 1);
        ray.setFromCamera(mp, cam);
        const h = ray.intersectObjects([...W.filter(m => m.userData.active), inner, ico], false)[0];
        return h ? h.object : null;
      };

      const onPointerDown = (e: PointerEvent) => {
        down = { x: e.clientX, rot: rotT };
        drag = false;
        canvas!.setPointerCapture(e.pointerId);
        canvas!.style.cursor = 'grabbing';
      };

      const onPointerMove = (e: PointerEvent) => {
        const b = canvas!.getBoundingClientRect();
        mp.set(((e.clientX - b.left) / b.width) * 2 - 1, -((e.clientY - b.top) / b.height) * 2 + 1);
        if (down) {
          const dx = e.clientX - down.x;
          if (Math.abs(dx) > 5) drag = true;
          if (drag) rotT = down.rot + dx * 0.01;
          return;
        }
        const o: any = pick(e);
        hov = o;
        canvas!.style.cursor = o ? 'pointer' : 'grab';
        if (o && W.includes(o) && o.userData.active) {
          const u = o.userData;
          tip!.textContent = u.dead
            ? `${u.workerName} (PID ${u.pid || '—'}) · OFFLINE (Click to spawn)`
            : `${u.workerName} (PID ${u.pid || '—'}) · ${u.status} · ${u.done} tasks done (Click to crash)`;
          tip!.style.transform = `translate(${e.clientX - b.left + 14}px,${e.clientY - b.top + 14}px)`;
          tip!.style.opacity = '1';
        } else if (o && (o === inner || o === ico)) {
          const liveCount = liveWorkersList.filter((w) => w.status !== 'DEAD' && w.status !== 'STOPPED').length;
          tip!.textContent = `Relay Coordinator · ${liveCount} active worker(s) · Click to dispatch job`;
          tip!.style.transform = `translate(${e.clientX - b.left + 14}px,${e.clientY - b.top + 14}px)`;
          tip!.style.opacity = '1';
        } else {
          tip!.style.opacity = '0';
        }
      };

      const onPointerLeave = () => {
        tip!.style.opacity = '0';
        hov = null;
      };

      const onPointerUp = (e: PointerEvent) => {
        canvas!.style.cursor = hov ? 'pointer' : 'grab';
        if (!drag) {
          const o: any = pick(e);
          if (o) {
            if (W.includes(o) && o.userData.active) {
              onWorkerClick(o);
            } else if (o === inner || o === ico) {
              onCoreClick();
            }
          }
        }
        down = null;
        drag = false;
        rotT = 0;
      };

      canvas!.addEventListener('pointerdown', onPointerDown);
      canvas!.addEventListener('pointermove', onPointerMove);
      canvas!.addEventListener('pointerleave', onPointerLeave);
      canvas!.addEventListener('pointerup', onPointerUp);

      /* size + visibility */
      let vis = true;
      const io = new IntersectionObserver((a) => (vis = a[0].isIntersecting));
      io.observe(stage!);

      const ro = new ResizeObserver(() => {
        if (!stage) return;
        const w = stage.clientWidth;
        const h = stage.clientHeight;
        if (w > 0 && h > 0) {
          r.setSize(w, h, false);
          cam.aspect = w / h;
          cam.updateProjectionMatrix();
        }
      });
      ro.observe(stage!);

      /* loop */
      const clk = new THREE.Clock();
      let acc = 0;
      let animId = 0;
      let isDisposed = false;

      function frame() {
        if (isDisposed) return;
        animId = requestAnimationFrame(frame);
        if (!vis || document.hidden) {
          clk.getDelta();
          return;
        }
        const dt = Math.min(clk.getDelta(), 0.05);
        const t = clk.elapsedTime;
        const spawnInterval = liveSummary.running > 0 ? 0.18 : 0.45;
        if (ready && acc > spawnInterval) {
          acc = 0;
          const a = alive();
          if (a.length) {
            const busy = a.filter((w) => w.userData.status === 'BUSY');
            const target = busy.length > 0 ? busy[(Math.random() * busy.length) | 0] : a[(Math.random() * a.length) | 0];
            spawn(target);
          }
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
          const pa = u.ln.geometry.attributes.position;
          pa.setXYZ(1, w.position.x, w.position.y, w.position.z);
          pa.needsUpdate = true;
          u.ln.material.color.setHex(u.dead ? BAD : AC);
          u.ln.material.opacity = u.dead ? 0.1 : 0.22;
          u.pulse = Math.max(0, u.pulse - dt * 3);
          if (u.dead) {
            u.deadT += dt;
            w.material.emissiveIntensity =
              u.deadT < 0.8 ? (Math.sin(t * 50) > 0 ? 1.2 : 0.1) : 0.7;
          } else {
            w.material.emissiveIntensity = 0.55 + u.pulse * 1.4;
          }
          const base = (u.dead ? 0.85 : 1) * (hov === w ? 1.25 : 1);
          if (u.rm > 0.05) {
            const s = w.scale.x;
            if (!gsap.isTweening(w.scale)) w.scale.setScalar(s + (base - s) * 0.2);
          }
        });

        P.forEach((p) => {
          if (!p.on) return;
          if (p.hold > 0) {
            p.hold -= dt;
            if (p.hold <= 0) {
              const a = alive();
              if (a.length) {
                p.w = a[(Math.random() * a.length) | 0];
                p.t = 0;
                p.ph = 'out';
                (p.m.material as THREE.MeshBasicMaterial).color.setHex(AC);
              } else {
                p.on = false;
                p.m.visible = false;
              }
            }
            return;
          }
          p.t += dt * 0.8;
          const tg = p.ph === 'out' ? p.w.position : ZERO;
          p.m.position.lerpVectors(p.from, tg, Math.min(p.t, 1));
          p.m.position.y += Math.sin(Math.PI * Math.min(p.t, 1)) * 0.5;
          if (p.t >= 1) {
            if (p.ph === 'out') {
              p.w.userData.pulse = 1;
              p.w.userData.done++;
              p.from.copy(p.w.position);
              p.ph = 'back';
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
        cam.position.x += (px - cam.position.x) * 0.04;
        cam.position.y += (py - cam.position.y) * 0.04;
        cam.lookAt(0, 0, 0);

        r.render(sc, cam);
      }

      frame();

      return {
        burst: () => {
          corePulse = 1;
          burst();
        },
        updateCluster,
        intro() {
          gsap.to(cam.position, { z: 14, duration: 2.4, ease: 'power3.out' });
          gsap.to(core.scale, { x: 1, y: 1, z: 1, duration: 1.5, ease: 'elastic.out(1,.5)' });
          W.forEach((w, i) => {
            gsap.to(w.scale, { x: 1, y: 1, z: 1, duration: 0.9, delay: 0.5 + i * 0.12, ease: 'back.out(2)' });
            gsap.to(w.userData, { rm: 1, duration: 1.8, delay: 0.5 + i * 0.12, ease: 'power3.out' });
          });
          gsap.delayedCall(1.8, () => {
            ready = true;
            burst();
          });
        },
        dispose() {
          isDisposed = true;
          cancelAnimationFrame(animId);
          timeouts.forEach((id) => clearTimeout(id));
          if (canvas) {
            canvas.removeEventListener('pointerdown', onPointerDown);
            canvas.removeEventListener('pointermove', onPointerMove);
            canvas.removeEventListener('pointerleave', onPointerLeave);
            canvas.removeEventListener('pointerup', onPointerUp);
          }
          io.disconnect();
          ro.disconnect();

          icoGeom.dispose();
          icoMat.dispose();
          innerGeom.dispose();
          innerMat.dispose();
          haloGeom.dispose();
          haloMat.dispose();
          workerGeom.dispose();
          sg.dispose();
          starMat.dispose();
          packetGeom.dispose();

          W.forEach((w) => {
            w.material.dispose();
            w.userData.ln.geometry.dispose();
            w.userData.ln.material.dispose();
          });

          P.forEach((p) => {
            (p.m.material as THREE.Material).dispose();
          });

          r.dispose();
        },
      };
    }

    /* ---------- page animation ---------- */
    const S = reduce ? null : initScene();
    if (!S) {
      stage.classList.add('nogl');
    }

    // Connect to live distributed cluster
    const cleanupSSE = useRelayStore.getState().initSSE();

    // Fetch initial cluster state
    api.fetchState().then((snapshot) => {
      if (S) {
        S.updateCluster(snapshot.workers, snapshot.tasksSummary);
      }
    }).catch(() => {});

    // Subscribe to real-time cluster state updates
    const unsubscribe = useRelayStore.subscribe((state) => {
      if (S) {
        S.updateCluster(state.workers, state.tasksSummary);
      }
    });

    if (demoBtn) {
      demoBtn.onclick = async () => {
        if (S) {
          S.burst();
          status.textContent = 'Submitting distributed Primes workload to cluster...';
          try {
            const job = await api.createJob('primes', { limit: 5_000_000, chunks: 16 }, 1);
            status.textContent = `Live workload active (ID: ${job.id.slice(0, 8)}) · 16 tasks claimed by workers!`;
          } catch (err: any) {
            status.textContent = 'Workload dispatched across cluster';
          }
          stage.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      };
    }

    // Step tabs click handling
    const stepBtns = container.querySelectorAll<HTMLButtonElement>('.step');
    stepBtns.forEach((b) =>
      b.addEventListener('click', () => {
        stepBtns.forEach((x) => x.classList.toggle('on', x === b));
      })
    );

    let ctx: gsap.Context | null = null;

    if (reduce) {
      intro.style.display = 'none';
    } else {
      ctx = gsap.context(() => {
        gsap.set('.reveal', { opacity: 0, y: 40 });

        const h1 = container.querySelector<HTMLElement>('#h1');
        const heroChars = h1 ? split(h1) : [];

        container.querySelectorAll<HTMLElement>('[data-split]:not([data-hero])').forEach((el) => {
          const ch = split(el);
          scatter(ch, {
            scrollTrigger: {
              trigger: el,
              start: 'top 88%',
              toggleActions: 'play none none reverse',
            },
          });
        });

        ScrollTrigger.batch(container.querySelectorAll('.reveal'), {
          start: 'top 90%',
          onEnter: (b) =>
            gsap.to(b, {
              y: 0,
              opacity: 1,
              stagger: 0.12,
              duration: 0.8,
              ease: 'power3.out',
              overwrite: true,
            }),
          onLeaveBack: (b) => gsap.to(b, { opacity: 0, duration: 0.3, overwrite: true }),
        });

        gsap.to('.fill', {
          scaleX: 1,
          ease: 'none',
          scrollTrigger: {
            trigger: container.querySelector('.steps'),
            start: 'top 80%',
            end: 'bottom 55%',
            scrub: true,
          },
        });

        const introChars = split(introT);
        gsap.set(['#lab', '#sub', '#btns'], { opacity: 0, y: 24 });

        const tl = gsap.timeline();
        tl.from(introChars, {
          x: () => R(-900, 900),
          y: () => R(-600, 600),
          rotation: () => R(-720, 720),
          scale: () => R(0.1, 3),
          opacity: 0,
          duration: 1.5,
          ease: 'power4.out',
          stagger: { each: 0.06, from: 'random' },
        })
          .to(
            introChars,
            { y: -30, opacity: 0, duration: 0.5, stagger: 0.05, ease: 'power2.in' },
            '+=0.35'
          )
          .to(
            intro,
            {
              opacity: 0,
              duration: 0.5,
              onComplete: () => {
                intro.style.display = 'none';
              },
            },
            '-=0.2'
          )
          .add(() => {
            S && S.intro();
          }, '-=0.2')
          .to('#lab', { opacity: 1, y: 0, duration: 0.7 }, '<')
          .add(() => scatter(heroChars), '<0.1')
          .to(['#sub', '#btns'], { opacity: 1, y: 0, duration: 0.8, stagger: 0.15, ease: 'power3.out' }, '>-.6');
      }, container);
    }

    return () => {
      document.documentElement.style.scrollBehavior = prevScrollBehavior;
      document.documentElement.style.overflowX = prevOverflowX;
      document.body.style.overflowX = prevBodyOverflowX;

      unsubscribe();
      cleanupSSE();

      if (ctx) {
        ctx.revert();
      }
      ScrollTrigger.getAll().forEach((st) => st.kill());
      if (S) {
        S.dispose();
      }
    };
  }, []);

  return (
    <div className="landing" ref={containerRef}>
      <div id="intro" ref={introRef} aria-hidden="true">
        <div id="introT" ref={introTRef} data-raw="RELAY">
          RELAY
        </div>
      </div>
      <nav>
        <div className="wrap">
          <a className="logo" href="#top">
            <i></i>Relay
          </a>
          <Link className="btn s" to="/app">
            Open dashboard
          </Link>
        </div>
      </nav>
      <main id="top">
        <div className="wrap hero">
          <div>
            <p className="label mono" id="lab">
              DISTRIBUTED TASK PLATFORM
            </p>
            <h1 id="h1" data-split data-hero data-raw="Split the work. Survive the failures.">
              Split the work. Survive the failures.
            </h1>
            <p className="sub" id="sub">
              Relay breaks jobs into tasks, runs them across a pool of workers, and recovers automatically
              when one goes down.
            </p>
            <div className="btns" id="btns">
              <Link className="btn p" to="/app">
                Open dashboard
              </Link>
              <button className="btn s" id="demo" ref={demoBtnRef}>
                Run live workload
              </button>
            </div>
          </div>
          <div className="stagewrap">
            <div className="stage" id="stage" ref={stageRef}>
              <canvas id="cv" ref={canvasRef} aria-label="Live distributed cluster monitor"></canvas>
              <div id="tip" ref={tipRef} className="mono"></div>
              <div className="fb">
                3D cluster view is disabled (reduced motion or no WebGL). Relay splits a job into tasks,
                runs them across worker processes, and merges the results.
              </div>
            </div>
            <div className="cap">
              <span id="status" ref={statusRef} className="mono">
                Click a worker to kill process · Click the core to dispatch workload
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#4ade9a', display: 'inline-block' }} />
                Live Cluster
              </span>
            </div>
          </div>
        </div>
        <section className="blk" id="how">
          <div className="wrap">
            <h2 data-split data-raw="How it works">
              How it works
            </h2>
            <p className="lead reveal">One job goes in. Many workers share it. One answer comes out.</p>
            <div className="steps">
              <div className="track">
                <div className="fill"></div>
              </div>
              <button className="step reveal on">
                <span className="n mono">01</span>
                <h3>Submit</h3>
                <p>You send a job, like counting primes up to 10 million.</p>
              </button>
              <button className="step reveal">
                <span className="n mono">02</span>
                <h3>Split</h3>
                <p>The coordinator cuts it into small, independent tasks.</p>
              </button>
              <button className="step reveal">
                <span className="n mono">03</span>
                <h3>Run</h3>
                <p>Workers pull tasks whenever they are free, in parallel.</p>
              </button>
              <button className="step reveal">
                <span className="n mono">04</span>
                <h3>Merge</h3>
                <p>Partial results are combined into the final answer.</p>
              </button>
            </div>
          </div>
        </section>
        <section className="blk">
          <div className="wrap">
            <h2 data-split data-raw="Built to survive failure">
              Built to survive failure
            </h2>
            <p className="lead reveal">A crashed worker never means a lost task.</p>
            <div className="cards">
              <div className="card reveal">
                <h3>Heartbeats</h3>
                <p>Silence from a worker is detected within seconds.</p>
              </div>
              <div className="card reveal">
                <h3>Leases</h3>
                <p>Lost tasks return to the queue and run again elsewhere.</p>
              </div>
              <div className="card reveal">
                <h3>Fencing</h3>
                <p>Stale results from replaced workers are rejected.</p>
              </div>
            </div>
          </div>
        </section>
        <section className="blk cta">
          <div className="wrap">
            <h2 data-split data-raw="Break a worker. Watch it heal.">
              Break a worker. Watch it heal.
            </h2>
            <Link className="btn p reveal" to="/app">
              Open dashboard
            </Link>
          </div>
        </section>
      </main>
      <footer>Relay · Distributed Computing mini project · 2026</footer>
    </div>
  );
}

export default Landing;
