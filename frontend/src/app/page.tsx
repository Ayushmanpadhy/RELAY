"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";

const LandingScene = dynamic(() => import("@/components/landing/LandingScene"), {
  ssr: false,
  loading: () => (
    <div className="relative min-h-[400px] h-[min(74vh,680px)] rounded-[24px] border border-[var(--line)] bg-[var(--surface)] grid place-items-center">
      <div className="flex flex-col items-center gap-3 text-sm text-[var(--dim)]">
        <div className="w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
        <span className="font-mono text-xs">Initializing 3D simulation...</span>
      </div>
    </div>
  ),
});

gsap.registerPlugin(ScrollTrigger);

export default function LandingPage() {
  const [activeStep, setActiveStep] = useState(0);
  const [introVisible, setIntroVisible] = useState(true);
  const burstRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    // Initialize Lenis smooth scroll
    const lenis = new Lenis({
      duration: 1.2,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    });

    let rafId: number;
    function raf(time: number) {
      lenis.raf(time);
      rafId = requestAnimationFrame(raf);
    }
    rafId = requestAnimationFrame(raf);

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      const timer = setTimeout(() => setIntroVisible(false), 0);
      return () => {
        clearTimeout(timer);
        cancelAnimationFrame(rafId);
        lenis.destroy();
      };
    }

    // Intro timeline
    const R = gsap.utils.random;
    const introEl = document.getElementById("introT");
    if (introEl) {
      const text = introEl.textContent || "RELAY";
      introEl.textContent = "";
      const chars: HTMLSpanElement[] = [];
      [...text].forEach((ch) => {
        const s = document.createElement("span");
        s.className = "inline-block will-change-transform";
        s.textContent = ch;
        introEl.appendChild(s);
        chars.push(s);
      });

      const tl = gsap.timeline();
      tl.from(chars, {
        x: () => R(-900, 900),
        y: () => R(-600, 600),
        rotation: () => R(-720, 720),
        scale: () => R(0.1, 3),
        opacity: 0,
        duration: 1.5,
        ease: "power4.out",
        stagger: { each: 0.06, from: "random" },
      })
        .to(
          chars,
          {
            y: -30,
            opacity: 0,
            duration: 0.5,
            stagger: 0.05,
            ease: "power2.in",
          },
          "+=0.35"
        )
        .to(
          "#intro",
          {
            opacity: 0,
            duration: 0.5,
            onComplete: () => setIntroVisible(false),
          },
          "-=0.2"
        );
    }

    // Scroll reveal animations
    gsap.utils.toArray<HTMLElement>(".reveal").forEach((elem) => {
      gsap.fromTo(
        elem,
        { opacity: 0, y: 35 },
        {
          opacity: 1,
          y: 0,
          duration: 0.8,
          ease: "power3.out",
          scrollTrigger: {
            trigger: elem,
            start: "top 88%",
            toggleActions: "play none none reverse",
          },
        }
      );
    });

    return () => {
      cancelAnimationFrame(rafId);
      lenis.destroy();
      ScrollTrigger.getAll().forEach((t) => t.kill());
    };
  }, []);

  const handleDemoClick = () => {
    if (burstRef.current) {
      burstRef.current();
    }
  };

  return (
    <div className="bg-[var(--bg)] text-[var(--text)] min-h-screen selection:bg-[var(--accent)] selection:text-black">
      {introVisible && (
        <div
          id="intro"
          className="fixed inset-0 z-50 bg-[var(--bg)] grid place-items-center transition-opacity"
        >
          <div
            id="introT"
            className="text-[clamp(44px,12vw,120px)] font-bold tracking-[0.08em] text-[var(--text)]"
          >
            RELAY
          </div>
        </div>
      )}

      {/* Top Navbar */}
      <nav className="sticky top-0 z-30 bg-[rgba(11,13,18,0.85)] backdrop-blur-md border-b border-[var(--line)]">
        <div className="max-w-[1200px] mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="font-semibold text-lg tracking-wide flex items-center gap-2.5">
            <i className="w-3 h-3 rounded-full bg-[var(--accent)] shadow-[0_0_14px_var(--accent)] inline-block" />
            <span>Relay</span>
          </Link>
          <div className="flex items-center gap-4">
            <Link
              href="/auth"
              className="px-5 py-2.5 rounded-lg text-sm font-semibold bg-[var(--surface-2)] border border-[var(--line)] hover:border-[var(--accent)] transition-all transform hover:-translate-y-0.5"
            >
              Sign in
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <main className="max-w-[1200px] mx-auto px-6">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.15fr] gap-10 items-center min-h-[calc(100svh-64px)] py-8">
          <div>
            <p className="text-xs font-mono tracking-[0.18em] text-[var(--accent)] mb-5 uppercase">
              DISTRIBUTED AI TASK PLATFORM
            </p>
            <h1 className="text-[clamp(36px,5vw,62px)] leading-[1.08] font-semibold tracking-tight mb-5">
              Split the work. Survive the failures.
            </h1>
            <p className="text-lg text-[var(--dim)] max-w-[28em] mb-8 leading-relaxed">
              Describe the work. Relay splits it, runs it everywhere across virtual worker nodes and AI
              providers, and hands you the answer.
            </p>
            <div className="flex flex-wrap gap-3">
              <button
                onClick={handleDemoClick}
                className="px-6 py-3 rounded-xl font-semibold text-sm bg-[var(--accent)] text-[#0B0D12] hover:bg-[#919fff] transition-all transform hover:-translate-y-0.5 cursor-pointer shadow-lg shadow-[rgba(124,140,255,0.2)]"
              >
                Try the demo
              </button>
              <a
                href="#how"
                className="px-6 py-3 rounded-xl font-semibold text-sm bg-[var(--surface-2)] text-[var(--text)] border border-[var(--line)] hover:border-[var(--dim)] transition-all transform hover:-translate-y-0.5"
              >
                How it works
              </a>
            </div>
          </div>

          <div className="w-full">
            <LandingScene onBurstRef={burstRef} />
          </div>
        </div>

        {/* How It Works Section */}
        <section id="how" className="py-24 border-t border-[var(--line)]">
          <div className="reveal">
            <h2 className="text-[clamp(28px,3.6vw,44px)] font-semibold tracking-tight mb-3">
              How it works
            </h2>
            <p className="text-lg text-[var(--dim)] max-w-[34em] mb-12">
              One prompt goes in. Many workers share it in parallel. One clear answer comes out.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
            {[
              {
                num: "01",
                title: "Intake & Plan",
                desc: "You upload files and describe the work. The AI Orchestrator designs an exact or AI execution plan.",
              },
              {
                num: "02",
                title: "Split",
                desc: "The coordinator partitions the dataset into 10 to 100 sized sub-tasks.",
              },
              {
                num: "03",
                title: "Run",
                desc: "100 virtual worker nodes pull tasks and run them concurrently across healthy providers.",
              },
              {
                num: "04",
                title: "Assemble",
                desc: "Partial results are verified, reduced, and assembled into an explained final deliverable.",
              },
            ].map((step, idx) => (
              <div
                key={step.num}
                onClick={() => setActiveStep(idx)}
                className={`reveal p-6 rounded-2xl border transition-all cursor-pointer ${
                  activeStep === idx
                    ? "border-[var(--accent)] bg-[var(--surface-2)] -translate-y-1"
                    : "border-[var(--line)] bg-[var(--surface)] hover:border-[var(--dim)]"
                }`}
              >
                <span className="font-mono text-sm text-[var(--accent)] font-semibold">{step.num}</span>
                <h3 className="text-lg font-semibold mt-3 mb-2">{step.title}</h3>
                <p className="text-sm text-[var(--dim)] leading-relaxed">{step.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Built to Survive Failure Section */}
        <section className="py-24 border-t border-[var(--line)]">
          <div className="reveal">
            <h2 className="text-[clamp(28px,3.6vw,44px)] font-semibold tracking-tight mb-3">
              Built to survive failure
            </h2>
            <p className="text-lg text-[var(--dim)] max-w-[34em] mb-12">
              A crashed node or rate-limited provider never means a lost task.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="reveal p-8 rounded-2xl bg-[var(--surface)] border border-[var(--line)]">
              <h3 className="text-xl font-semibold mb-3">Circuit Breakers</h3>
              <p className="text-sm text-[var(--dim)] leading-relaxed">
                3 consecutive provider errors open the circuit. Calls automatically fail over to healthy
                alternative providers.
              </p>
            </div>
            <div className="reveal p-8 rounded-2xl bg-[var(--surface)] border border-[var(--line)]">
              <h3 className="text-xl font-semibold mb-3">Automatic Reassignment</h3>
              <p className="text-sm text-[var(--dim)] leading-relaxed">
                In-flight tasks from crashed nodes return to the queue and execute on different worker slots.
              </p>
            </div>
            <div className="reveal p-8 rounded-2xl bg-[var(--surface)] border border-[var(--line)]">
              <h3 className="text-xl font-semibold mb-3">Number Guard</h3>
              <p className="text-sm text-[var(--dim)] leading-relaxed">
                Exact tasks run deterministic Python tools. The answer is verified and strictly preserved in
                the final explanation.
              </p>
            </div>
          </div>
        </section>

        {/* Call to Action Section */}
        <section className="py-28 text-center border-t border-[var(--line)]">
          <div className="reveal max-w-xl mx-auto">
            <h2 className="text-[clamp(30px,4vw,48px)] font-semibold tracking-tight mb-6">
              Break a worker. Watch it heal.
            </h2>
            <Link
              href="/auth"
              className="inline-block px-8 py-4 rounded-xl font-semibold text-base bg-[var(--accent)] text-[#0B0D12] hover:bg-[#919fff] transition-all transform hover:-translate-y-0.5 shadow-xl shadow-[rgba(124,140,255,0.25)]"
            >
              Sign in to Relay
            </Link>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-[var(--line)] py-8 text-center text-xs text-[var(--dim)]">
        Relay · Distributed AI Task Platform · 2026
      </footer>
    </div>
  );
}
