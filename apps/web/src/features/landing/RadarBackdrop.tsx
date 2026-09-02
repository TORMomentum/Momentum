"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

/**
 * The ambient scene behind the landing page: a radar. Each particle on the disc
 * is a TOR in the corpus, the amber points are the ones a peer-group comparison
 * flagged, and the sweep is the pipeline going round. Ported from
 * mockups/TOR Radar Landing.dc.html.
 *
 * Colours match the design tokens: --ink-ish #33507a for the corpus,
 * --anomaly #b45309 for flagged figures, --blue #1d63d8 for the sweep.
 */
const CORPUS_POINTS = 700;
const ANOMALY_POINTS = 12;
const RING_COUNT = 4;
const DISC_RADIUS = 5.2;

const COLOR_CORPUS = 0x33507a;
const COLOR_ANOMALY = 0xb45309;
const COLOR_SWEEP = 0x1d63d8;

const CAMERA_START_Z = 8;
const CAMERA_START_Y = 2.2;
const TILT_BASE = 0.12;
const EASE = 0.05;

export function RadarBackdrop() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      55,
      window.innerWidth / window.innerHeight,
      0.1,
      100,
    );
    camera.position.set(0, CAMERA_START_Y, CAMERA_START_Z);

    const group = new THREE.Group();
    scene.add(group);

    // the corpus: one point per TOR, spread evenly over the disc
    const corpus = new Float32Array(CORPUS_POINTS * 3);
    for (let i = 0; i < CORPUS_POINTS; i += 1) {
      const radius = Math.sqrt(Math.random()) * DISC_RADIUS;
      const angle = Math.random() * Math.PI * 2;
      corpus[i * 3] = Math.cos(angle) * radius;
      corpus[i * 3 + 1] = (Math.random() - 0.5) * 0.25;
      corpus[i * 3 + 2] = Math.sin(angle) * radius;
    }
    const corpusGeometry = new THREE.BufferGeometry();
    corpusGeometry.setAttribute("position", new THREE.BufferAttribute(corpus, 3));
    const corpusMaterial = new THREE.PointsMaterial({
      color: COLOR_CORPUS,
      size: 0.05,
      transparent: true,
      opacity: 0.65,
    });
    group.add(new THREE.Points(corpusGeometry, corpusMaterial));

    // the flagged ones, sitting above the plane so they read as raised
    const flagged = new Float32Array(ANOMALY_POINTS * 3);
    for (let i = 0; i < ANOMALY_POINTS; i += 1) {
      const radius = 1 + Math.random() * 4;
      const angle = Math.random() * Math.PI * 2;
      flagged[i * 3] = Math.cos(angle) * radius;
      flagged[i * 3 + 1] = 0.35 + Math.random() * 0.5;
      flagged[i * 3 + 2] = Math.sin(angle) * radius;
    }
    const flaggedGeometry = new THREE.BufferGeometry();
    flaggedGeometry.setAttribute("position", new THREE.BufferAttribute(flagged, 3));
    const flaggedMaterial = new THREE.PointsMaterial({
      color: COLOR_ANOMALY,
      size: 0.14,
      transparent: true,
      opacity: 0.95,
    });
    group.add(new THREE.Points(flaggedGeometry, flaggedMaterial));

    const rings: THREE.Mesh[] = [];
    for (let i = 1; i <= RING_COUNT; i += 1) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(i * 1.3, 0.006, 8, 128),
        new THREE.MeshBasicMaterial({ color: COLOR_CORPUS, transparent: true, opacity: 0.22 }),
      );
      ring.rotation.x = Math.PI / 2;
      rings.push(ring);
      group.add(ring);
    }

    const sweepGeometry = new THREE.PlaneGeometry(DISC_RADIUS, 0.02);
    sweepGeometry.translate(DISC_RADIUS / 2, 0, 0);
    const sweepMaterial = new THREE.MeshBasicMaterial({
      color: COLOR_SWEEP,
      transparent: true,
      opacity: 0.75,
      side: THREE.DoubleSide,
    });
    const sweep = new THREE.Mesh(sweepGeometry, sweepMaterial);
    sweep.rotation.x = -Math.PI / 2;
    group.add(sweep);
    group.rotation.x = TILT_BASE;

    const pointer = { x: 0, y: 0 };
    const onPointerMove = (event: PointerEvent) => {
      pointer.x = (event.clientX / window.innerWidth - 0.5) * 2;
      pointer.y = (event.clientY / window.innerHeight - 0.5) * 2;
    };
    const onResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("resize", onResize);
    onResize();

    const clock = new THREE.Clock();
    let frame = 0;

    const loop = () => {
      frame = requestAnimationFrame(loop);
      const time = clock.getElapsedTime();
      const scrolled = Math.min(1, window.scrollY / (window.innerHeight * 1.4));

      group.rotation.y = time * 0.06;
      sweep.rotation.z = -time * 0.9;
      flaggedMaterial.size = 0.12 + Math.sin(time * 3) * 0.04;

      // the disc flattens toward the reader and the camera closes in on scroll
      group.rotation.x += (TILT_BASE + scrolled * 0.9 - group.rotation.x) * EASE;
      camera.position.z += (CAMERA_START_Z - scrolled * 2.5 - camera.position.z) * EASE;
      camera.position.x += (pointer.x * 0.9 - camera.position.x) * 0.04;
      camera.position.y += (CAMERA_START_Y - pointer.y * 0.7 - camera.position.y) * 0.04;
      camera.lookAt(0, 0, 0);

      const fade = Math.max(0, 1 - window.scrollY / (window.innerHeight * 1.1));
      canvas.style.opacity = String(0.3 + fade * 0.7);

      renderer.render(scene, camera);
    };
    loop();

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("resize", onResize);
      corpusGeometry.dispose();
      corpusMaterial.dispose();
      flaggedGeometry.dispose();
      flaggedMaterial.dispose();
      sweepGeometry.dispose();
      sweepMaterial.dispose();
      rings.forEach((ring) => {
        ring.geometry.dispose();
        (ring.material as THREE.Material).dispose();
      });
      renderer.dispose();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        width: "100%",
        height: "100%",
        zIndex: 0,
        pointerEvents: "none",
      }}
    />
  );
}
