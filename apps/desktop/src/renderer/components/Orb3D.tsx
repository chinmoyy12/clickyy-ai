import { useEffect, useRef, useState } from 'react';
import { store } from '../state/store';
import { Orb, type OrbMode } from './Orb';

/**
 * The 3D voice orb: a ray-traced, lit sphere drawn by one WebGL fragment shader. Flowing plasma on the
 * surface, a fresnel rim, a specular highlight that follows the mouse, and per-state effects (listening
 * ripples, a thinking orbit, a speaking glow). Every visual state maps to a real application state and
 * the size reacts only to measured microphone or playback level. If WebGL is missing or the context is
 * lost, the 2D canvas orb takes over. Reduced motion renders a still frame per state change.
 */

type Vec3 = [number, number, number];
const hex = (h: string): Vec3 => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];

/** core = dark body, accent = plasma, ring = rim and effects; energy = how lively the surface is. */
const ORB_LOOK: Record<OrbMode, { core: Vec3; accent: Vec3; ring: Vec3; energy: number; code: number }> = {
  idle: { core: hex('#1f1812'), accent: hex('#dcaa76'), ring: hex('#f0c896'), energy: 0.38, code: 0 },
  wake_detected: { core: hex('#2a2216'), accent: hex('#f5d6aa'), ring: hex('#fff0d6'), energy: 1, code: 4 },
  listening: { core: hex('#0c1a1f'), accent: hex('#7fd3e6'), ring: hex('#a6e8f5'), energy: 0.75, code: 1 },
  processing: { core: hex('#17130f'), accent: hex('#d4a373'), ring: hex('#f0c896'), energy: 0.6, code: 2 },
  executing: { core: hex('#1c1610'), accent: hex('#e0b07c'), ring: hex('#ffd6a0'), energy: 0.8, code: 2 },
  speaking: { core: hex('#22180e'), accent: hex('#f0b878'), ring: hex('#ffd9a8'), energy: 0.75, code: 3 },
  confirming: { core: hex('#221b0c'), accent: hex('#e8c27a'), ring: hex('#f5d48e'), energy: 0.6, code: 4 },
  offline: { core: hex('#111215'), accent: hex('#4f535b'), ring: hex('#7a7e86'), energy: 0.05, code: 6 },
  error: { core: hex('#2a100e'), accent: hex('#e5786d'), ring: hex('#ff9a8f'), energy: 0.6, code: 5 },
  muted: { core: hex('#101114'), accent: hex('#43464d'), ring: hex('#6c7078'), energy: 0, code: 6 },
};

const VERT = `attribute vec2 aPos; void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAG = `precision highp float;
uniform vec2 uRes; uniform float uTime; uniform float uLevel; uniform float uEnergy; uniform float uMode;
uniform vec3 uCore; uniform vec3 uAccent; uniform vec3 uRing; uniform vec2 uTilt;
float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1.0, 0.0, 0.0)), f.x), mix(hash(i + vec3(0.0, 1.0, 0.0)), hash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
             mix(mix(hash(i + vec3(0.0, 0.0, 1.0)), hash(i + vec3(1.0, 0.0, 1.0)), f.x), mix(hash(i + vec3(0.0, 1.0, 1.0)), hash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}
float fbm(vec3 p) { float v = 0.0; float a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; } return v; }
mat3 rotY(float a) { float c = cos(a); float s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
mat3 rotX(float a) { float c = cos(a); float s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
void main() {
  vec2 p = (gl_FragCoord.xy * 2.0 - uRes) / min(uRes.x, uRes.y);
  float idle = 1.0 - step(0.5, uMode);
  float R = 0.5 + uLevel * 0.08 + 0.01 * sin(uTime * 1.2) * idle;
  float d = length(p);
  vec3 col = vec3(0.0); float alpha = 0.0;
  float glow = exp(-max(d - R, 0.0) * (6.0 - uEnergy * 2.5)) * (0.25 + 0.75 * uEnergy + uLevel * 0.6);
  col += uRing * glow * 0.5; alpha += glow * 0.55;
  if (uMode > 0.5 && uMode < 1.5) {
    for (int i = 0; i < 3; i++) {
      float ph = fract(uTime * 0.5 + float(i) / 3.0);
      float rr = R + 0.05 + ph * (0.26 + uLevel * 0.18);
      float w = smoothstep(0.014, 0.0, abs(d - rr)) * (1.0 - ph) * 0.75;
      col += uRing * w; alpha += w;
    }
  }
  if (uMode > 1.5 && uMode < 2.5) {
    float ry = 0.3; vec2 q = vec2(p.x, p.y / ry);
    float e = length(q); float rr = R + 0.14;
    float band = smoothstep(0.035, 0.0, abs(e - rr));
    float ang = atan(q.y, q.x);
    float sweep = pow(0.5 + 0.5 * cos(ang - uTime * 2.4), 8.0);
    float hidden = step(0.0, p.y) * step(d, R);
    float w = band * (0.12 + 0.88 * sweep) * (1.0 - hidden);
    col += uRing * w * 1.3; alpha += w;
  }
  if (uMode > 3.5 && uMode < 4.5) {
    float pulse = 0.5 + 0.5 * sin(uTime * 3.0);
    float w = smoothstep(0.012, 0.0, abs(d - (R + 0.06 + pulse * 0.04))) * (0.35 + 0.45 * pulse);
    col += uRing * w; alpha += w;
  }
  if (d < R) {
    float z = sqrt(R * R - d * d);
    vec3 n = normalize(vec3(p, z));
    vec3 sp = rotX(uTilt.y * 0.5) * rotY(uTime * 0.22 + uTilt.x * 0.7) * n;
    float warp = fbm(sp * 3.0 - vec3(uTime * 0.09));
    float flow = fbm(sp * 2.1 + vec3(0.0, uTime * 0.16, uTime * 0.1) + warp * 1.5);
    float bands = smoothstep(0.38, 0.86, flow);
    vec3 surf = mix(uCore, uAccent, bands * (0.45 + 0.55 * uEnergy));
    vec3 L = normalize(vec3(-0.45 + uTilt.x * 0.5, 0.55 + uTilt.y * 0.5, 0.8));
    float diff = max(dot(n, L), 0.0);
    vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
    float spec = pow(max(dot(n, H), 0.0), 56.0);
    float fres = pow(1.0 - n.z, 2.4);
    vec3 c = surf * (0.3 + 0.95 * diff) + vec3(1.0, 0.93, 0.84) * spec * 0.45 + uRing * fres * (0.45 + 0.7 * uEnergy + uLevel);
    c += uAccent * pow(1.0 - d / R, 3.0) * (0.12 + 0.45 * uEnergy + uLevel * 0.9);
    float edge = smoothstep(R, R - 0.008, d);
    col = mix(col, c, edge); alpha = mix(alpha, 1.0, edge);
  }
  if (uMode > 5.5) { float g = dot(col, vec3(0.299, 0.587, 0.114)); col = mix(col, vec3(g), 0.85) * 0.75; }
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
}`;

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader compile failed');
  return s;
}

export function Orb3D({ mode, reducedMotion, size = 230 }: { mode: OrbMode; reducedMotion: boolean; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    if (fallback) return;
    const canvas = ref.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl', { premultipliedAlpha: true, antialias: true, alpha: true, powerPreference: 'low-power' });
    if (!gl) { setFallback(true); return; }
    let prog: WebGLProgram;
    try {
      prog = gl.createProgram()!;
      gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link failed');
    } catch (e) {
      console.warn('3D orb unavailable, using 2D orb:', (e as Error).message);
      setFallback(true);
      return;
    }
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    const u = (n: string) => gl.getUniformLocation(prog, n);
    const U = { res: u('uRes'), time: u('uTime'), level: u('uLevel'), energy: u('uEnergy'), mode: u('uMode'), core: u('uCore'), accent: u('uAccent'), ring: u('uRing'), tilt: u('uTilt') };

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);

    const look = ORB_LOOK[modeRef.current];
    const cur = { core: [...look.core] as Vec3, accent: [...look.accent] as Vec3, ring: [...look.ring] as Vec3, energy: look.energy };
    let level = 0;
    const tilt = { x: 0, y: 0, tx: 0, ty: 0 };
    const onMove = (e: PointerEvent) => {
      tilt.tx = Math.max(-1, Math.min(1, (e.clientX / window.innerWidth) * 2 - 1));
      tilt.ty = Math.max(-1, Math.min(1, -((e.clientY / window.innerHeight) * 2 - 1)));
    };
    window.addEventListener('pointermove', onMove);

    let raf = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const t0 = performance.now();
    let frozen = 0;
    const lerp = (a: Vec3, b: Vec3, k: number) => { for (let i = 0; i < 3; i++) a[i] += (b[i] - a[i]) * k; };

    const draw = (now: number) => {
      const m = modeRef.current;
      const target = ORB_LOOK[m];
      const s = store.get();
      const k = reducedMotion ? 1 : 0.08;
      lerp(cur.core, target.core, k); lerp(cur.accent, target.accent, k); lerp(cur.ring, target.ring, k);
      // Windows voices give no amplitude: a gentle steady pulse, never a fake waveform.
      const steady = m === 'speaking' && s.speakLevel === 0 && !reducedMotion ? 0.12 * (0.5 + 0.5 * Math.sin(now / 160)) : 0;
      cur.energy += (target.energy + steady - cur.energy) * k;
      const lv = m === 'listening' ? s.micLevel : m === 'speaking' ? s.speakLevel : 0;
      level += (Math.min(1, lv) - level) * (reducedMotion ? 1 : 0.25);
      tilt.x += (tilt.tx - tilt.x) * 0.06; tilt.y += (tilt.ty - tilt.y) * 0.06;
      const t = reducedMotion ? frozen : (now - t0) / 1000;
      gl.uniform2f(U.res, canvas.width, canvas.height);
      gl.uniform1f(U.time, t);
      gl.uniform1f(U.level, level);
      gl.uniform1f(U.energy, cur.energy);
      gl.uniform1f(U.mode, target.code);
      gl.uniform3fv(U.core, cur.core); gl.uniform3fv(U.accent, cur.accent); gl.uniform3fv(U.ring, cur.ring);
      gl.uniform2f(U.tilt, reducedMotion ? 0 : tilt.x, reducedMotion ? 0 : tilt.y);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      if (document.hidden) return;
      if (reducedMotion && !(m === 'listening' || m === 'speaking')) return; // still frame
      // Calm states run at ~30 fps to keep the GPU and battery cool; active states at full rate.
      const calm = m === 'idle' || m === 'muted' || m === 'offline';
      if (calm) timer = setTimeout(() => { raf = requestAnimationFrame(draw); }, 33);
      else raf = requestAnimationFrame(draw);
    };
    const restart = () => { cancelAnimationFrame(raf); clearTimeout(timer); raf = requestAnimationFrame(draw); };
    restart();
    let lastMode = modeRef.current;
    const unsub = store.subscribe(() => { if (modeRef.current !== lastMode) { lastMode = modeRef.current; frozen += 0.37; restart(); } });
    const onVis = () => { if (!document.hidden) restart(); };
    const onLost = (e: Event) => { e.preventDefault(); setFallback(true); };
    document.addEventListener('visibilitychange', onVis);
    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('orb-mode', restart);
    return () => {
      cancelAnimationFrame(raf); clearTimeout(timer); unsub();
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('visibilitychange', onVis);
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('orb-mode', restart);
      gl.deleteBuffer(buf); gl.deleteProgram(prog);
    };
  }, [size, reducedMotion, fallback]);

  useEffect(() => { ref.current?.dispatchEvent(new Event('orb-mode')); }, [mode]);

  if (fallback) return <Orb mode={mode} reducedMotion={reducedMotion} size={size} />;
  return <canvas ref={ref} className="orb-canvas" style={{ width: size, height: size }} aria-hidden="true" data-orb="3d" />;
}
