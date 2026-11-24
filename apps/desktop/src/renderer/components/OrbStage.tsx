import { useEffect } from 'react';
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion';
import type { OrbMode } from './Orb';
import { Orb3D } from './Orb3D';

/** The orb on a 3D stage: it leans gently toward the pointer and floats above a soft contact shadow. */
export function OrbStage({ mode, reducedMotion, size }: { mode: OrbMode; reducedMotion: boolean; size: number }) {
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const rx = useSpring(useTransform(py, [-1, 1], [9, -9]), { stiffness: 90, damping: 18, mass: 0.6 });
  const ry = useSpring(useTransform(px, [-1, 1], [-12, 12]), { stiffness: 90, damping: 18, mass: 0.6 });

  useEffect(() => {
    if (reducedMotion) { px.set(0); py.set(0); return; }
    const move = (e: PointerEvent) => { px.set((e.clientX / window.innerWidth) * 2 - 1); py.set((e.clientY / window.innerHeight) * 2 - 1); };
    const leave = () => { px.set(0); py.set(0); };
    window.addEventListener('pointermove', move);
    document.addEventListener('pointerleave', leave);
    return () => { window.removeEventListener('pointermove', move); document.removeEventListener('pointerleave', leave); };
  }, [reducedMotion, px, py]);

  return (
    <div className="orb-stage">
      <motion.div style={{ rotateX: rx, rotateY: ry, transformStyle: 'preserve-3d' }}
        animate={reducedMotion ? undefined : { y: [0, -6, 0] }} transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}>
        <Orb3D mode={mode} reducedMotion={reducedMotion} size={size} />
      </motion.div>
      <div className="orb-shadow" />
    </div>
  );
}
