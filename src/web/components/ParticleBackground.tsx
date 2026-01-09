/**
 * Particle Background Component
 *
 * Canvas-based particle system that creates a subtle, dynamic background.
 * Features floating particles with connection lines between nearby particles.
 * Respects prefers-reduced-motion preference.
 */

/* eslint-disable sonarjs/pseudo-random */
// Math.random() is safe here - used only for visual particle positions, not security

import { useEffect, useRef, useCallback } from "react";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
  alpha: number;
}

// Neon cyber color palette for particles
const PARTICLE_COLORS = [
  "#00f5d4", // cyan
  "#6482b4", // blue/slate
  "#ffc300", // amber
  "#00c4a7", // teal
];

// Configuration
const PARTICLE_COUNT = 70;
const CONNECTION_DISTANCE = 120;
const PARTICLE_MIN_RADIUS = 1;
const PARTICLE_MAX_RADIUS = 3;
const PARTICLE_MIN_SPEED = 0.1;
const PARTICLE_MAX_SPEED = 0.3;
const PARTICLE_MIN_ALPHA = 0.15;
const PARTICLE_MAX_ALPHA = 0.4;
const CONNECTION_ALPHA = 0.15;

export function ParticleBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const animationRef = useRef<number>(0);
  const prefersReducedMotion = useRef(false);

  // Initialize particles
  const initParticles = useCallback((width: number, height: number) => {
    const particles: Particle[] = [];

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const speed =
        PARTICLE_MIN_SPEED +
        Math.random() * (PARTICLE_MAX_SPEED - PARTICLE_MIN_SPEED);
      const angle = Math.random() * Math.PI * 2;

      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius:
          PARTICLE_MIN_RADIUS +
          Math.random() * (PARTICLE_MAX_RADIUS - PARTICLE_MIN_RADIUS),
        color: PARTICLE_COLORS[Math.floor(Math.random() * PARTICLE_COLORS.length)],
        alpha:
          PARTICLE_MIN_ALPHA +
          Math.random() * (PARTICLE_MAX_ALPHA - PARTICLE_MIN_ALPHA),
      });
    }

    particlesRef.current = particles;
  }, []);

  // Update particle positions
  const updateParticles = useCallback((width: number, height: number) => {
    for (const particle of particlesRef.current) {
      // Update position
      particle.x += particle.vx;
      particle.y += particle.vy;

      // Wrap around screen edges
      if (particle.x < 0) particle.x = width;
      if (particle.x > width) particle.x = 0;
      if (particle.y < 0) particle.y = height;
      if (particle.y > height) particle.y = 0;
    }
  }, []);

  // Draw particles and connections
  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, width: number, height: number) => {
      // Clear canvas
      ctx.clearRect(0, 0, width, height);

      const particles = particlesRef.current;

      // Draw connections between nearby particles
      ctx.lineWidth = 1;
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const distance = Math.sqrt(dx * dx + dy * dy);

          if (distance < CONNECTION_DISTANCE) {
            // Fade connection based on distance
            const alpha =
              CONNECTION_ALPHA * (1 - distance / CONNECTION_DISTANCE);

            ctx.beginPath();
            ctx.strokeStyle = `rgba(0, 245, 212, ${alpha})`;
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.stroke();
          }
        }
      }

      // Draw particles
      for (const particle of particles) {
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
        ctx.fillStyle = particle.color.replace(")", `, ${particle.alpha})`).replace("rgb", "rgba");

        // Handle hex colors
        if (particle.color.startsWith("#")) {
          const r = parseInt(particle.color.slice(1, 3), 16);
          const g = parseInt(particle.color.slice(3, 5), 16);
          const b = parseInt(particle.color.slice(5, 7), 16);
          ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${particle.alpha})`;
        }

        ctx.fill();
      }
    },
    [],
  );

  // Animation loop
  const animate = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    // Only update positions if motion is allowed
    if (!prefersReducedMotion.current) {
      updateParticles(width, height);
    }

    draw(ctx, width, height);

    animationRef.current = requestAnimationFrame(animate);
  }, [updateParticles, draw]);

  // Setup and cleanup
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Check for reduced motion preference
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    prefersReducedMotion.current = mediaQuery.matches;

    const handleMotionChange = (e: MediaQueryListEvent) => {
      prefersReducedMotion.current = e.matches;
    };
    mediaQuery.addEventListener("change", handleMotionChange);

    // Handle resize
    const handleResize = () => {
      const dpr = window.devicePixelRatio || 1;
      const width = window.innerWidth;
      const height = window.innerHeight;

      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.scale(dpr, dpr);
      }

      // Reinitialize particles on resize
      initParticles(width, height);
    };

    handleResize();
    window.addEventListener("resize", handleResize);

    // Start animation
    animationRef.current = requestAnimationFrame(animate);

    return () => {
      window.removeEventListener("resize", handleResize);
      mediaQuery.removeEventListener("change", handleMotionChange);
      cancelAnimationFrame(animationRef.current);
    };
  }, [initParticles, animate]);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none"
      style={{ zIndex: 1 }}
      aria-hidden="true"
    />
  );
}
