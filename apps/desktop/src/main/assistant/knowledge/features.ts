/**
 * Windows features Clickyy can switch or check by name. Each one is either switched
 * through a documented, per-user, reversible mechanism, or (when Windows has no API
 * for apps, or the setting is security or privacy related) opened on its Settings page
 * so the user flips it themselves.
 */
export type FeatureMechanism =
  | { kind: 'radio'; radio: 'WiFi' | 'Bluetooth' }
  | { kind: 'reg'; feature: 'dark_mode' | 'autohide_taskbar' | 'file_extensions' | 'hidden_files' | 'clipboard_history' | 'sticky_keys' | 'filter_keys' | 'storage_sense'; invert?: boolean }
  | { kind: 'process'; exe: string; process: string }
  | { kind: 'plan' }
  | { kind: 'settings'; why: string };

export interface Feature {
  id: string;
  label: string;
  names: string[];
  mechanism: FeatureMechanism;
  /** Settings page id (knowledge/windows.ts) for "open the settings for…" and the fallback. */
  page: string;
  /** Windows' default, used for "reset to default". */
  defaultOn: boolean;
}

const NO_API = "Windows doesn't let apps switch this directly";
const PRIVACY = 'this is a privacy setting, so you switch it yourself';
const SECURITY = "this protects your PC, so I never switch it myself";

export const FEATURES: Feature[] = [
  { id: 'wifi', label: 'Wi-Fi', names: ['wifi', 'wi fi', 'wireless', 'wlan', 'wireless network'], mechanism: { kind: 'radio', radio: 'WiFi' }, page: 'wifi', defaultOn: true },
  { id: 'bluetooth', label: 'Bluetooth', names: ['bluetooth', 'blue tooth'], mechanism: { kind: 'radio', radio: 'Bluetooth' }, page: 'bluetooth', defaultOn: true },
  { id: 'airplane', label: 'Airplane mode', names: ['airplane mode', 'aeroplane mode', 'flight mode', 'airplane'], mechanism: { kind: 'settings', why: NO_API }, page: 'airplane', defaultOn: false },
  { id: 'dark_mode', label: 'Dark mode', names: ['dark mode', 'dark theme', 'night mode theme'], mechanism: { kind: 'reg', feature: 'dark_mode' }, page: 'colors', defaultOn: false },
  { id: 'light_mode', label: 'Light mode', names: ['light mode', 'light theme'], mechanism: { kind: 'reg', feature: 'dark_mode', invert: true }, page: 'colors', defaultOn: true },
  { id: 'night_light', label: 'Night light', names: ['night light', 'blue light filter', 'night light blue light filter', 'nightlight', 'eye comfort'], mechanism: { kind: 'settings', why: NO_API }, page: 'nightlight', defaultOn: false },
  { id: 'dnd', label: 'Do not disturb', names: ['do not disturb', 'dnd', 'focus assist', 'do not disturb focus mode', 'quiet hours'], mechanism: { kind: 'settings', why: NO_API }, page: 'notifications', defaultOn: false },
  { id: 'battery_saver', label: 'Battery saver', names: ['battery saver', 'battery saver mode', 'power saver', 'energy saver', 'power saving mode'], mechanism: { kind: 'settings', why: NO_API }, page: 'battery', defaultOn: false },
  { id: 'high_performance', label: 'High performance power plan', names: ['high performance power plan', 'high performance mode', 'high performance', 'performance mode', 'best performance'], mechanism: { kind: 'plan' }, page: 'power', defaultOn: false },
  { id: 'tap_to_click', label: 'Touchpad tap to click', names: ['touchpad tap to click', 'tap to click', 'touchpad tapping', 'touchpad'], mechanism: { kind: 'settings', why: NO_API }, page: 'touchpad', defaultOn: true },
  { id: 'keyboard_backlight', label: 'Keyboard backlight', names: ['keyboard backlight', 'keyboard light', 'keyboard lighting', 'backlit keyboard'], mechanism: { kind: 'settings', why: "the keyboard backlight is controlled by your laptop maker's keys or app (often Fn plus Space or F5), not by Windows" }, page: 'devices', defaultOn: false },
  { id: 'location', label: 'Location services', names: ['location services', 'location', 'gps', 'location access'], mechanism: { kind: 'settings', why: PRIVACY }, page: 'location', defaultOn: true },
  { id: 'hotspot', label: 'Mobile hotspot', names: ['mobile hotspot', 'hotspot', 'mobile hotspot sharing', 'wifi hotspot', 'internet sharing'], mechanism: { kind: 'settings', why: NO_API }, page: 'mobilehotspot', defaultOn: false },
  { id: 'mic_access', label: 'Microphone access', names: ['microphone access', 'mic access', 'microphone permission', 'microphone privacy'], mechanism: { kind: 'settings', why: PRIVACY }, page: 'microphone', defaultOn: true },
  { id: 'camera_access', label: 'Camera access', names: ['webcam camera access', 'camera access', 'webcam access', 'webcam', 'camera permission', 'camera privacy'], mechanism: { kind: 'settings', why: PRIVACY }, page: 'camera', defaultOn: true },
  { id: 'clipboard_history', label: 'Clipboard history', names: ['clipboard history', 'clipboard manager'], mechanism: { kind: 'reg', feature: 'clipboard_history' }, page: 'clipboard', defaultOn: false },
  { id: 'autohide_taskbar', label: 'Taskbar auto-hide', names: ['auto hide taskbar', 'autohide taskbar', 'auto hide the taskbar', 'taskbar auto hide', 'hide the taskbar automatically', 'taskbar autohide'], mechanism: { kind: 'reg', feature: 'autohide_taskbar' }, page: 'taskbar', defaultOn: false },
  { id: 'file_extensions', label: 'File name extensions', names: ['file extensions visibility', 'file extensions', 'file name extensions', 'show file extensions', 'extensions'], mechanism: { kind: 'reg', feature: 'file_extensions' }, page: 'developers', defaultOn: false },
  { id: 'hidden_files', label: 'Hidden files', names: ['hidden files visibility', 'hidden files', 'hidden items', 'show hidden files', 'hidden folders'], mechanism: { kind: 'reg', feature: 'hidden_files' }, page: 'developers', defaultOn: false },
  { id: 'startup_boost', label: 'Startup apps', names: ['startup apps acceleration', 'startup acceleration', 'fast startup', 'startup boost'], mechanism: { kind: 'settings', why: NO_API }, page: 'startup', defaultOn: true },
  { id: 'spatial_audio', label: 'Spatial sound', names: ['spatial 3d audio', 'spatial audio', 'spatial sound', '3d audio', 'windows sonic'], mechanism: { kind: 'settings', why: NO_API }, page: 'sound', defaultOn: false },
  { id: 'mono_audio', label: 'Mono audio', names: ['mono audio accessibility', 'mono audio', 'mono sound'], mechanism: { kind: 'settings', why: NO_API }, page: 'audioaccess', defaultOn: false },
  { id: 'live_captions', label: 'Live captions', names: ['live captions on screen', 'live captions', 'live caption', 'captions', 'subtitles on screen'], mechanism: { kind: 'process', exe: 'LiveCaptions.exe', process: 'LiveCaptions' }, page: 'captions', defaultOn: false },
  { id: 'magnifier', label: 'Magnifier', names: ['screen magnifier zoom', 'screen magnifier', 'magnifier', 'magnify', 'screen zoom'], mechanism: { kind: 'process', exe: 'Magnify.exe', process: 'Magnify' }, page: 'magnifier', defaultOn: false },
  { id: 'high_contrast_theme', label: 'Windows contrast themes', names: ['high contrast theme', 'windows high contrast', 'contrast theme', 'contrast themes'], mechanism: { kind: 'settings', why: NO_API }, page: 'contrast', defaultOn: false },
  { id: 'sticky_keys', label: 'Sticky keys', names: ['sticky keys toggle', 'sticky keys', 'sticky key'], mechanism: { kind: 'reg', feature: 'sticky_keys' }, page: 'keyboard', defaultOn: false },
  { id: 'filter_keys', label: 'Filter keys', names: ['filter keys bounce protection', 'filter keys', 'bounce keys', 'filter key'], mechanism: { kind: 'reg', feature: 'filter_keys' }, page: 'keyboard', defaultOn: false },
  { id: 'narrator', label: 'Narrator', names: ['narrator screen reader', 'narrator', 'screen reader'], mechanism: { kind: 'process', exe: 'Narrator.exe', process: 'Narrator' }, page: 'narrator', defaultOn: false },
  { id: 'firewall', label: 'Windows Firewall', names: ['windows os firewall protection', 'windows firewall protection', 'firewall protection', 'windows firewall', 'firewall'], mechanism: { kind: 'settings', why: SECURITY }, page: 'firewall', defaultOn: true },
  { id: 'antivirus', label: 'Real-time protection', names: ['real time antivirus scanning', 'real time protection', 'antivirus scanning', 'antivirus', 'windows defender', 'virus protection', 'defender'], mechanism: { kind: 'settings', why: SECURITY }, page: 'windowssecurity', defaultOn: true },
  { id: 'auto_timezone', label: 'Automatic time zone', names: ['automatic time zone sync', 'automatic time zone', 'auto time zone', 'time zone sync', 'automatic time'], mechanism: { kind: 'settings', why: NO_API }, page: 'date', defaultOn: true },
  { id: 'storage_sense', label: 'Storage Sense', names: ['storage sense auto cleanup', 'storage sense', 'automatic cleanup', 'auto cleanup'], mechanism: { kind: 'reg', feature: 'storage_sense' }, page: 'storage', defaultOn: false },
  { id: 'gpu_scheduling', label: 'Hardware-accelerated GPU scheduling', names: ['hardware accelerated gpu scheduling', 'gpu scheduling', 'hags'], mechanism: { kind: 'settings', why: 'it needs administrator rights and a restart' }, page: 'graphics', defaultOn: true },
  { id: 'vrr', label: 'Variable refresh rate', names: ['variable refresh rate vrr', 'variable refresh rate', 'vrr', 'adaptive sync', 'g sync', 'freesync'], mechanism: { kind: 'settings', why: NO_API }, page: 'graphics', defaultOn: true },
  { id: 'hdr', label: 'HDR', names: ['hdr display output', 'hdr', 'high dynamic range', 'hdr display'], mechanism: { kind: 'settings', why: NO_API }, page: 'hdr', defaultOn: false },
];

export const FEATURE_BY_ID = new Map(FEATURES.map((f) => [f.id, f]));

const norm = (s: string) => s.toLowerCase().replace(/[()]/g, ' ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Finds a feature named anywhere in a phrase ("toggle wi-fi on my laptop"), longest name wins. */
export function findFeature(text: string): Feature | null {
  const t = ` ${norm(text)} `;
  let best: { f: Feature; len: number } | null = null;
  for (const f of FEATURES) for (const n of f.names) {
    const k = ` ${norm(n)} `;
    if (t.includes(k) && (!best || k.length > best.len)) best = { f, len: k.length };
  }
  return best?.f ?? null;
}
