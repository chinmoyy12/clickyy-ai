/** System metrics Clickyy can measure and explain, with the words people use for them. */
export const METRICS = [
  { id: 'cpu', label: 'CPU usage and temperature', names: ['cpu usage and core temperatures', 'cpu usage', 'cpu load', 'processor usage', 'core temperatures', 'cpu temperature', 'temperatures', 'temperature', 'processor', 'cpu'] },
  { id: 'ram', label: 'memory and swap', names: ['ram memory consumption and swap usage', 'memory consumption', 'memory usage', 'ram usage', 'swap usage', 'page file', 'pagefile', 'swap', 'memory', 'ram'] },
  { id: 'disk', label: 'drive space', names: ['ssd hard drive free space on all partitions', 'free space on all partitions', 'drive free space', 'disk space', 'free space', 'storage space', 'partitions', 'hard drive', 'ssd', 'storage', 'drives'] },
  { id: 'diskio', label: 'disk read and write speed', names: ['disk read and write i o speeds', 'disk read and write io speeds', 'read and write speeds', 'disk io', 'disk i o', 'disk speed', 'disk activity', 'disk usage'] },
  { id: 'battery', label: 'battery health', names: ['battery health charge percentage and time remaining', 'battery health', 'battery wear', 'battery capacity', 'battery'] },
  { id: 'gpu', label: 'GPU and video memory', names: ['gpu utilization and vram memory usage', 'gpu utilization', 'gpu usage', 'graphics card', 'video memory', 'vram', 'gpu'] },
  { id: 'netio', label: 'network bandwidth', names: ['active network upload and download bandwidth', 'upload and download bandwidth', 'network bandwidth', 'network usage', 'network traffic', 'bandwidth', 'upload and download', 'data usage right now'] },
  { id: 'ips', label: 'IP and MAC addresses', names: ['local ip address public ip and mac address', 'local ip address', 'public ip', 'ip address', 'mac address', 'my ip', 'ip addresses'] },
  { id: 'wifi', label: 'Wi-Fi signal', names: ['wi fi signal strength rssi and link speed', 'wifi signal strength rssi and link speed', 'wifi signal strength', 'wi fi signal strength', 'signal strength', 'wifi signal', 'wi fi signal', 'link speed', 'rssi'] },
  { id: 'cpu_top', label: 'top CPU processes', names: ['top 10 processes consuming the most cpu', 'processes consuming the most cpu', 'processes using the most cpu', 'apps using the most cpu', 'cpu hogs', 'top cpu processes'] },
  { id: 'ram_top', label: 'top memory processes', names: ['top 10 processes consuming the most ram', 'processes consuming the most ram', 'processes using the most ram', 'processes using the most memory', 'apps using the most memory', 'apps using the most ram', 'memory hogs', 'top memory processes'] },
  { id: 'ports', label: 'listening network ports', names: ['open listening tcp and udp network ports', 'listening tcp and udp', 'listening ports', 'open ports', 'network ports', 'tcp ports', 'udp ports'] },
  { id: 'uptime', label: 'uptime', names: ['system uptime since last reboot', 'system uptime', 'uptime', 'last reboot', 'since last restart'] },
  { id: 'usb', label: 'USB devices and drives', names: ['connected usb devices and external drives', 'usb devices and external drives', 'usb devices', 'external drives', 'pen drives', 'usb drives', 'usb'] },
  { id: 'bluetooth', label: 'Bluetooth devices', names: ['connected bluetooth peripherals and battery levels', 'bluetooth peripherals', 'bluetooth devices', 'paired devices', 'bluetooth battery'] },
  { id: 'display', label: 'display settings', names: ['display resolution refresh rate and scaling factor', 'display resolution', 'screen resolution', 'refresh rate', 'scaling factor', 'display scaling', 'resolution'] },
  { id: 'audio', label: 'audio devices', names: ['audio input and output devices currently active', 'audio input and output devices', 'audio devices', 'sound devices', 'audio input', 'audio output'] },
  { id: 'os', label: 'Windows version', names: ['installed os version kernel build and architecture', 'os version', 'windows version', 'kernel build', 'build number', 'architecture', 'operating system version', 'operating system build'] },
  { id: 'updates', label: 'pending updates', names: ['pending os security updates and driver patches', 'pending updates', 'security updates', 'windows updates', 'driver patches', 'driver updates', 'updates'] },
  { id: 'env', label: 'environment variables', names: ['system environment variables and path entries', 'environment variables', 'path entries', 'path variable', 'env vars'] },
  { id: 'tasks', label: 'scheduled tasks', names: ['scheduled background tasks and cron jobs', 'scheduled background tasks', 'scheduled tasks', 'background tasks', 'cron jobs', 'task scheduler jobs'] },
  { id: 'crashes', label: 'crash logs and errors', names: ['recent system crash logs and event viewer errors', 'system crash logs', 'event viewer errors', 'crash logs', 'system errors', 'crashes', 'error logs', 'blue screen'] },
  { id: 'dns', label: 'network latency', names: ['dns server response latency and ping to gateway', 'dns server response latency', 'ping to gateway', 'dns latency', 'network latency', 'latency', 'ping', 'dns'] },
  { id: 'folders', label: 'folder sizes', names: ['folder sizes inside my user home directory', 'folder sizes', 'home directory', 'biggest folders', 'largest folders', 'what is taking up space'] },
  { id: 'recycle', label: 'Recycle Bin', names: ['recycle bin trash item count and total size', 'recycle bin', 'trash', 'recycle'] },
] as const;

export type MetricId = (typeof METRICS)[number]['id'];
export const METRIC_IDS = METRICS.map((m) => m.id) as [MetricId, ...MetricId[]];
export const METRIC_LABEL = new Map<string, string>(METRICS.map((m) => [m.id, m.label]));

const norm = (s: string) => ` ${s.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()} `;

/** Finds the metric named in a phrase; the longest matching name wins. */
export function findMetric(text: string): MetricId | null {
  const t = norm(text);
  let best: { id: MetricId; len: number } | null = null;
  for (const m of METRICS) for (const n of m.names) {
    const k = norm(n);
    if (t.includes(k) && (!best || k.length > best.len)) best = { id: m.id, len: k.length };
  }
  return best?.id ?? null;
}
