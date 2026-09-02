"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useMotionPreference } from "../../shared/lib/useMotionPreference";

/**
 * The ambient scene behind the landing page: a radar sweeping a field of TORs.
 * Each soft point on the disc is a document in the corpus, the amber ones are
 * figures a peer-group comparison flagged, and the wedge is the pipeline going
 * round — its trail fading behind it the way a real radar's does.
 *
 * Colours come from the design tokens: corpus #33507a, anomaly #b45309,
 * sweep #1d63d8.
 */
const CORPUS_POINTS = 900;
const ANOMALY_POINTS = 12;
const RING_COUNT = 4;
const RING_SPACING = 1.3;
const DISC_RADIUS = 5.2;
const PING_PERIOD_SECONDS = 4;

const COLOR_CORPUS = 0x33507a;
const COLOR_ANOMALY = 0xb45309;
const COLOR_SWEEP = 0x1d63d8;

const CAMERA_START_Z = 8;
const CAMERA_START_Y = 2.2;
const TILT_BASE = 0.12;
const EASE = 0.05;

/** A soft round dot, so points read as glows rather than square pixels. */
function makeDotTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;

  const context = canvas.getContext("2d");
  if (context) {
    const gradient = context.createRadialGradient(
      size / 2,
      size / 2,
      0,
      size / 2,
      size / 2,
      size / 2,
    );
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.35, "rgba(255,255,255,0.85)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

/**
 * The sweep: a full disc whose alpha falls away behind the beam, giving the
 * trailing wedge. Done in a shader because a mesh cannot fade along an angle.
 */
const SWEEP_VERTEX = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SWEEP_FRAGMENT = `
  uniform float uAngle;
  uniform vec3 uColor;
  varying vec2 vUv;

  void main() {
    vec2 centred = vUv - 0.5;
    float radius = length(centred) * 2.0;
    if (radius > 1.0) discard;

    float angle = atan(centred.y, centred.x);
    float behind = mod(uAngle - angle, 6.2831853);

    // bright at the beam, gone a third of a turn behind it
    float trail = 1.0 - smoothstep(0.0, 2.0943951, behind);
    float edge = smoothstep(1.0, 0.55, radius);
    float alpha = trail * trail * edge * 0.5;

    gl_FragColor = vec4(uColor, alpha);
  }
`;

export function RadarBackdrop() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { animate } = useMotionPreference();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

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

    const dot = makeDotTexture();

    // the corpus, denser toward the centre so the disc has weight
    const corpus = new Float32Array(CORPUS_POINTS * 3);
    const sizes = new Float32Array(CORPUS_POINTS);
    for (let i = 0; i < CORPUS_POINTS; i += 1) {
      const radius = Math.sqrt(Math.random()) * DISC_RADIUS;
      const angle = Math.random() * Math.PI * 2;
      corpus[i * 3] = Math.cos(angle) * radius;
      corpus[i * 3 + 1] = (Math.random() - 0.5) * 0.18;
      corpus[i * 3 + 2] = Math.sin(angle) * radius;
      sizes[i] = 0.05 + Math.random() * 0.05;
    }
    const corpusGeometry = new THREE.BufferGeometry();
    corpusGeometry.setAttribute("position", new THREE.BufferAttribute(corpus, 3));
    const corpusMaterial = new THREE.PointsMaterial({
      color: COLOR_CORPUS,
      size: 0.075,
      map: dot,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
      sizeAttenuation: true,
    });
    group.add(new THREE.Points(corpusGeometry, corpusMaterial));

    // the flagged ones, raised off the plane and additively blended so they glow
    const flagged = new Float32Array(ANOMALY_POINTS * 3);
    for (let i = 0; i < ANOMALY_POINTS; i += 1) {
      const radius = 1 + Math.random() * 4;
      const angle = Math.random() * Math.PI * 2;
      flagged[i * 3] = Math.cos(angle) * radius;
      flagged[i * 3 + 1] = 0.3 + Math.random() * 0.45;
      flagged[i * 3 + 2] = Math.sin(angle) * radius;
    }
    const flaggedGeometry = new THREE.BufferGeometry();
    flaggedGeometry.setAttribute("position", new THREE.BufferAttribute(flagged, 3));
    const flaggedMaterial = new THREE.PointsMaterial({
      color: COLOR_ANOMALY,
      size: 0.3,
      map: dot,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    group.add(new THREE.Points(flaggedGeometry, flaggedMaterial));

    // range rings, fainter as they go out
    const rings: THREE.Mesh[] = [];
    for (let i = 1; i <= RING_COUNT; i += 1) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(i * RING_SPACING, 0.004, 8, 160),
        new THREE.MeshBasicMaterial({
          color: COLOR_CORPUS,
          transparent: true,
          opacity: 0.26 - i * 0.04,
        }),
      );
      ring.rotation.x = Math.PI / 2;
      rings.push(ring);
      group.add(ring);
    }

    // the expanding ping, one pulse per period
    const pingGeometry = new THREE.TorusGeometry(1, 0.006, 8, 160);
    const pingMaterial = new THREE.MeshBasicMaterial({
      color: COLOR_SWEEP,
      transparent: true,
      opacity: 0,
    });
    const ping = new THREE.Mesh(pingGeometry, pingMaterial);
    ping.rotation.x = Math.PI / 2;
    group.add(ping);

    const sweepGeometry = new THREE.PlaneGeometry(DISC_RADIUS * 2, DISC_RADIUS * 2);
    const sweepMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uAngle: { value: 0 },
        uColor: { value: new THREE.Color(COLOR_SWEEP) },
      },
      vertexShader: SWEEP_VERTEX,
      fragmentShader: SWEEP_FRAGMENT,
      transparent: true,
      depthWrite: false,
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

    const draw = (time: number) => {
      const scrolled = Math.min(1, window.scrollY / (window.innerHeight * 1.4));

      group.rotation.y = time * 0.05;
      sweepMaterial.uniforms.uAngle.value = -time * 0.85;
      flaggedMaterial.size = 0.26 + Math.sin(time * 2.4) * 0.07;

      const pingProgress = (time % PING_PERIOD_SECONDS) / PING_PERIOD_SECONDS;
      ping.scale.setScalar(0.4 + pingProgress * DISC_RADIUS);
      pingMaterial.opacity = (1 - pingProgress) * 0.35;

      // the disc flattens toward the reader while the camera closes in
      group.rotation.x += (TILT_BASE + scrolled * 0.9 - group.rotation.x) * EASE;
      camera.position.z += (CAMERA_START_Z - scrolled * 2.5 - camera.position.z) * EASE;
      camera.position.x += (pointer.x * 0.9 - camera.position.x) * 0.04;
      camera.position.y += (CAMERA_START_Y - pointer.y * 0.7 - camera.position.y) * 0.04;
      camera.lookAt(0, 0, 0);

      const fade = Math.max(0, 1 - window.scrollY / (window.innerHeight * 1.1));
      canvas.style.opacity = String(0.3 + fade * 0.7);

      renderer.render(scene, camera);
    };

    if (animate) {
      const loop = () => {
        frame = requestAnimationFrame(loop);
        draw(clock.getElapsedTime());
      };
      loop();
    } else {
      // Still, but present: a single frame mid-sweep rather than a blank hero.
      draw(PING_PERIOD_SECONDS / 2);
    }

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("resize", onResize);
      dot.dispose();
      corpusGeometry.dispose();
      corpusMaterial.dispose();
      flaggedGeometry.dispose();
      flaggedMaterial.dispose();
      pingGeometry.dispose();
      pingMaterial.dispose();
      sweepGeometry.dispose();
      sweepMaterial.dispose();
      rings.forEach((ring) => {
        ring.geometry.dispose();
        (ring.material as THREE.Material).dispose();
      });
      renderer.dispose();
    };
  }, [animate]);

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
