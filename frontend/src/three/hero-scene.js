/**
 * Three.js hero scene — 3D objects, particles, lighting, camera movement,
 * mouse interaction, bloom via postprocessing. Fully responsive, disposes
 * cleanly on navigation, and renders a static frame when reduced motion
 * is preferred.
 */
import * as THREE from 'three';
import { EffectComposer } from 'postprocessing';
import { RenderPass } from 'postprocessing';
import { BloomEffect } from 'postprocessing';

export function createHeroScene(container) {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x0b0f1a, 0.05);

  const camera = new THREE.PerspectiveCamera(
    60, container.clientWidth / container.clientHeight, 0.1, 100
  );
  camera.position.set(0, 0.6, 7);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  // Lighting
  scene.add(new THREE.AmbientLight(0x334, 0.8));
  const keyLight = new THREE.PointLight(0x6c5ce7, 40, 30);
  keyLight.position.set(4, 4, 4);
  scene.add(keyLight);
  const rimLight = new THREE.PointLight(0x00cec9, 30, 30);
  rimLight.position.set(-5, -2, 3);
  scene.add(rimLight);

  // Central icosahedron
  const core = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1.6, 1),
    new THREE.MeshStandardMaterial({ color: 0x6c5ce7, metalness: 0.8, roughness: 0.25, flatShading: true })
  );
  scene.add(core);

  // Wireframe shell
  const shell = new THREE.Mesh(
    new THREE.IcosahedronGeometry(2.2, 1),
    new THREE.MeshBasicMaterial({ color: 0x00cec9, wireframe: true, transparent: true, opacity: 0.25 })
  );
  scene.add(shell);

  // Orbiting satellites
  const satellites = new THREE.Group();
  for (let i = 0; i < 6; i++) {
    const s = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.22),
      new THREE.MeshStandardMaterial({ color: 0xfd79a8, metalness: 0.6, roughness: 0.4 })
    );
    const angle = (i / 6) * Math.PI * 2;
    s.userData = { angle, radius: 3 + Math.random() * 1.2, speed: 0.25 + Math.random() * 0.3, y: (Math.random() - 0.5) * 2.4 };
    satellites.add(s);
  }
  scene.add(satellites);

  // Particle field
  const particleCount = reduced ? 200 : 900;
  const positions = new Float32Array(particleCount * 3);
  for (let i = 0; i < particleCount * 3; i += 3) {
    positions[i] = (Math.random() - 0.5) * 26;
    positions[i + 1] = (Math.random() - 0.5) * 16;
    positions[i + 2] = (Math.random() - 0.5) * 18;
  }
  const particleGeo = new THREE.BufferGeometry();
  particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const particles = new THREE.Points(
    particleGeo,
    new THREE.PointsMaterial({ color: 0x8b9dd9, size: 0.045, transparent: true, opacity: 0.7 })
  );
  scene.add(particles);

  // Postprocessing: bloom
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new BloomEffect({ intensity: 0.9, luminanceThreshold: 0.25 }));

  // Mouse interaction (parallax camera)
  const mouse = { x: 0, y: 0 };
  const onMouse = (e) => {
    const rect = container.getBoundingClientRect();
    mouse.x = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
    mouse.y = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
  };
  container.addEventListener('pointermove', onMouse);

  // Resize handling
  const onResize = () => {
    if (!container.clientWidth) return;
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
    composer.setSize(container.clientWidth, container.clientHeight);
  };
  window.addEventListener('resize', onResize);

  // Render loop with clock; paused when tab hidden (performance)
  const clock = new THREE.Clock();
  let rafId = 0;

  function tick() {
    const t = clock.getElapsedTime();
    core.rotation.y = t * 0.25;
    core.rotation.x = Math.sin(t * 0.4) * 0.2;
    shell.rotation.y = -t * 0.15;

    satellites.children.forEach((s) => {
      const { angle, radius, speed, y } = s.userData;
      const a = angle + t * speed;
      s.position.set(Math.cos(a) * radius, y + Math.sin(t * 0.8 + angle) * 0.3, Math.sin(a) * radius);
      s.rotation.y = t;
    });

    // Camera follows mouse subtly
    camera.position.x += (mouse.x * 1.2 - camera.position.x) * 0.03;
    camera.position.y += (-mouse.y * 0.8 + 0.6 - camera.position.y) * 0.03;
    camera.lookAt(0, 0, 0);

    composer.render();
    rafId = requestAnimationFrame(tick);
  }

  if (reduced) {
    composer.render(); // single static frame
  } else {
    rafId = requestAnimationFrame(tick);
  }
  const onVisibility = () => {
    if (reduced) return;
    cancelAnimationFrame(rafId);
    if (!document.hidden) rafId = requestAnimationFrame(tick);
  };
  document.addEventListener('visibilitychange', onVisibility);

  /** Full cleanup — no memory leaks on SPA navigation. */
  return function dispose() {
    cancelAnimationFrame(rafId);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('resize', onResize);
    container.removeEventListener('pointermove', onMouse);
    scene.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach((m) => m.dispose());
      }
    });
    composer.dispose?.();
    renderer.dispose();
    renderer.domElement.remove();
  };
}
