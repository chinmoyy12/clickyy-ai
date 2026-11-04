import { realpathSync, existsSync } from 'node:fs';
import { dirname, isAbsolute, normalize, relative, resolve, sep, basename } from 'node:path';

export class PathRejected extends Error {}

const PROTECTED = [
  /^[a-z]:\\windows(\\|$)/i,
  /^[a-z]:\\program files( \(x86\))?(\\|$)/i,
  /^[a-z]:\\programdata(\\|$)/i,
  /\\appdata\\(local|roaming)\\microsoft\\(credentials|protect|vault)(\\|$)/i,
  /\\\.ssh(\\|$)/i,
  /\\\.aws(\\|$)/i,
  /\\\.gnupg(\\|$)/i,
  /\\ntuser\.dat/i,
  /^\\\\/, // UNC paths
];

const BAD_NAME = /[<>:"|?*\x00-\x1f]/;
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;

function canonical(p: string): string {
  // Resolve symlinks/junctions for the deepest existing ancestor so a link
  // inside an approved folder cannot escape it.
  let current = resolve(p);
  const tail: string[] = [];
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) break;
    tail.unshift(basename(current));
    current = parent;
  }
  let real = current;
  try {
    real = realpathSync.native(current);
  } catch {
    /* keep resolved path */
  }
  return normalize(resolve(real, ...tail));
}

export function isProtectedPath(p: string): boolean {
  return PROTECTED.some((re) => re.test(p));
}

export function isWithin(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel) && !rel.split(sep).includes('..'));
}

/**
 * Resolves `requested` against the approved roots and enforces the boundary.
 * Relative paths resolve against the first root. Returns the canonical path.
 */
export function resolveApproved(requested: string, roots: string[]): string {
  if (!requested || requested.length > 600) throw new PathRejected('Path is empty or too long');
  if (requested.includes('\0')) throw new PathRejected('Invalid path');
  const approved = roots.filter(Boolean).map(canonical);
  if (approved.length === 0) throw new PathRejected('No approved folders are configured. Add one in Settings > Permissions.');
  const target = canonical(isAbsolute(requested) ? requested : resolve(approved[0], requested));
  if (isProtectedPath(target)) throw new PathRejected('That location is protected');
  if (!approved.some((root) => isWithin(root, target))) throw new PathRejected('That path is outside your approved folders');
  return target;
}

export function validateFileName(name: string): string {
  const n = name.trim();
  if (!n || n.length > 200 || BAD_NAME.test(n) || RESERVED.test(n) || n === '.' || n === '..' || /[\\/]/.test(n) || /[. ]$/.test(n)) {
    throw new PathRejected(`"${name}" is not a valid file name`);
  }
  return n;
}
