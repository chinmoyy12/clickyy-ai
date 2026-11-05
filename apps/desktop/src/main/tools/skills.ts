import { z } from 'zod';
import { defineTool, ToolError, type ToolDef } from './types';

// ---------------------------------------------------------------------------
// Safe calculator: a small recursive-descent parser. No eval, no Function.
// ---------------------------------------------------------------------------
const FUNCS: Record<string, (x: number) => number> = {
  sqrt: Math.sqrt, abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil,
  sin: (x) => Math.sin((x * Math.PI) / 180), cos: (x) => Math.cos((x * Math.PI) / 180), tan: (x) => Math.tan((x * Math.PI) / 180),
  log: Math.log10, ln: Math.log, exp: Math.exp,
};
const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E };

export function evaluate(expr: string): number {
  const src = expr.replace(/\s+/g, '').toLowerCase();
  if (!src || src.length > 200) throw new ToolError('That expression is empty or too long.', 'invalid_input');
  let i = 0;
  const peek = () => src[i];
  const eat = (c: string) => (src[i] === c ? (i++, true) : false);
  const expression = (): number => {
    let v = term();
    for (;;) {
      if (eat('+')) v += term();
      else if (eat('-')) v -= term();
      else return v;
    }
  };
  const term = (): number => {
    let v = power();
    for (;;) {
      if (eat('*')) v *= power();
      else if (eat('/')) {
        const d = power();
        if (d === 0) throw new ToolError("You can't divide by zero.", 'invalid_input');
        v /= d;
      } else if (eat('%')) v %= power();
      else return v;
    }
  };
  const power = (): number => {
    const base = unary();
    return eat('^') ? base ** power() : base;
  };
  const unary = (): number => (eat('-') ? -unary() : eat('+') ? unary() : atom());
  const atom = (): number => {
    if (eat('(')) {
      const v = expression();
      if (!eat(')')) throw new ToolError('Missing closing bracket.', 'invalid_input');
      return v;
    }
    const num = src.slice(i).match(/^\d+(\.\d+)?/);
    if (num) {
      i += num[0].length;
      return parseFloat(num[0]);
    }
    const word = src.slice(i).match(/^[a-z]+/);
    if (word) {
      i += word[0].length;
      if (word[0] in CONSTS) return CONSTS[word[0]];
      const fn = FUNCS[word[0]];
      if (fn && eat('(')) {
        const v = expression();
        if (!eat(')')) throw new ToolError('Missing closing bracket.', 'invalid_input');
        return fn(v);
      }
    }
    throw new ToolError(`I couldn't understand "${expr}" as math.`, 'invalid_input');
  };
  const v = expression();
  if (i !== src.length || peek() !== undefined) throw new ToolError(`I couldn't understand "${expr}" as math.`, 'invalid_input');
  if (!Number.isFinite(v)) throw new ToolError('The result is not a finite number.', 'invalid_input');
  return v;
}

/** "15 percent of 240", "12 times 7", "square root of 81" → "(15/100)*240" etc. */
export function spokenToExpression(text: string): string {
  let t = ` ${text.toLowerCase()} `;
  t = t.replace(/(\d+(?:\.\d+)?)\s*(?:percent|%)\s+of\s+/g, '($1/100)*');
  t = t.replace(/\bsquare root of\s+(\d+(?:\.\d+)?)/g, 'sqrt($1)');
  t = t.replace(/\bcube root of\s+(\d+(?:\.\d+)?)/g, '($1)^(1/3)');
  t = t.replace(/(\d+(?:\.\d+)?)\s+squared\b/g, '($1)^2').replace(/(\d+(?:\.\d+)?)\s+cubed\b/g, '($1)^3');
  t = t.replace(/\b(?:to the power of|raised to)\b/g, '^');
  t = t.replace(/\b(?:times|multiplied by|x)\b/g, '*').replace(/\b(?:divided by|over)\b/g, '/');
  t = t.replace(/\bplus\b/g, '+').replace(/\bminus\b/g, '-').replace(/\bmod(?:ulo)?\b/g, '%');
  t = t.replace(/\b(?:what'?s|what is|calculate|compute|how much is|equals?|the)\b/g, ' ');
  return t.replace(/[?,]/g, '').replace(/\s+/g, ' ').trim();
}

export function formatNumber(v: number): string {
  const r = Math.abs(v) >= 1e6 || Number.isInteger(v) ? v : Number(v.toPrecision(10));
  return r.toLocaleString('en-US', { maximumFractionDigits: 6 });
}

// ---------------------------------------------------------------------------
// Unit conversion
// ---------------------------------------------------------------------------
type Dim = 'length' | 'mass' | 'volume' | 'speed' | 'data' | 'time' | 'temperature' | 'area';
const UNITS: Record<string, { dim: Dim; f: number; name: string }> = {
  m: { dim: 'length', f: 1, name: 'meters' }, km: { dim: 'length', f: 1000, name: 'kilometers' }, cm: { dim: 'length', f: 0.01, name: 'centimeters' },
  mm: { dim: 'length', f: 0.001, name: 'millimeters' }, mi: { dim: 'length', f: 1609.344, name: 'miles' }, yd: { dim: 'length', f: 0.9144, name: 'yards' },
  ft: { dim: 'length', f: 0.3048, name: 'feet' }, in: { dim: 'length', f: 0.0254, name: 'inches' },
  kg: { dim: 'mass', f: 1, name: 'kilograms' }, g: { dim: 'mass', f: 0.001, name: 'grams' }, mg: { dim: 'mass', f: 1e-6, name: 'milligrams' },
  lb: { dim: 'mass', f: 0.45359237, name: 'pounds' }, oz: { dim: 'mass', f: 0.028349523125, name: 'ounces' }, st: { dim: 'mass', f: 6.35029318, name: 'stone' },
  l: { dim: 'volume', f: 1, name: 'liters' }, ml: { dim: 'volume', f: 0.001, name: 'milliliters' }, gal: { dim: 'volume', f: 3.785411784, name: 'US gallons' },
  qt: { dim: 'volume', f: 0.946352946, name: 'quarts' }, pt: { dim: 'volume', f: 0.473176473, name: 'pints' }, cup: { dim: 'volume', f: 0.2365882365, name: 'cups' },
  floz: { dim: 'volume', f: 0.0295735295625, name: 'fluid ounces' }, tbsp: { dim: 'volume', f: 0.01478676478125, name: 'tablespoons' }, tsp: { dim: 'volume', f: 0.00492892159375, name: 'teaspoons' },
  kph: { dim: 'speed', f: 1 / 3.6, name: 'kilometers per hour' }, mph: { dim: 'speed', f: 0.44704, name: 'miles per hour' }, mps: { dim: 'speed', f: 1, name: 'meters per second' }, knot: { dim: 'speed', f: 0.514444, name: 'knots' },
  b: { dim: 'data', f: 1, name: 'bytes' }, kb: { dim: 'data', f: 1e3, name: 'kilobytes' }, mb: { dim: 'data', f: 1e6, name: 'megabytes' }, gb: { dim: 'data', f: 1e9, name: 'gigabytes' }, tb: { dim: 'data', f: 1e12, name: 'terabytes' },
  s: { dim: 'time', f: 1, name: 'seconds' }, min: { dim: 'time', f: 60, name: 'minutes' }, h: { dim: 'time', f: 3600, name: 'hours' }, day: { dim: 'time', f: 86400, name: 'days' }, week: { dim: 'time', f: 604800, name: 'weeks' },
  m2: { dim: 'area', f: 1, name: 'square meters' }, ft2: { dim: 'area', f: 0.09290304, name: 'square feet' }, acre: { dim: 'area', f: 4046.8564224, name: 'acres' }, ha: { dim: 'area', f: 10000, name: 'hectares' },
  c: { dim: 'temperature', f: 1, name: 'degrees Celsius' }, f: { dim: 'temperature', f: 1, name: 'degrees Fahrenheit' }, k: { dim: 'temperature', f: 1, name: 'kelvin' },
};
const ALIASES: Record<string, string> = {
  meter: 'm', meters: 'm', metre: 'm', metres: 'm', kilometer: 'km', kilometers: 'km', kilometre: 'km', kilometres: 'km', kms: 'km',
  centimeter: 'cm', centimeters: 'cm', millimeter: 'mm', millimeters: 'mm', mile: 'mi', miles: 'mi', yard: 'yd', yards: 'yd',
  foot: 'ft', feet: 'ft', inch: 'in', inches: 'in', kilogram: 'kg', kilograms: 'kg', kilo: 'kg', kilos: 'kg', kgs: 'kg', gram: 'g', grams: 'g',
  milligram: 'mg', milligrams: 'mg', pound: 'lb', pounds: 'lb', lbs: 'lb', ounce: 'oz', ounces: 'oz', stone: 'st',
  liter: 'l', liters: 'l', litre: 'l', litres: 'l', milliliter: 'ml', milliliters: 'ml', gallon: 'gal', gallons: 'gal', quart: 'qt', quarts: 'qt',
  pint: 'pt', pints: 'pt', cups: 'cup', 'fluid ounce': 'floz', 'fluid ounces': 'floz', tablespoon: 'tbsp', tablespoons: 'tbsp', teaspoon: 'tsp', teaspoons: 'tsp',
  'km/h': 'kph', 'kilometers per hour': 'kph', 'kilometres per hour': 'kph', 'miles per hour': 'mph', 'meters per second': 'mps', 'm/s': 'mps', knots: 'knot',
  byte: 'b', bytes: 'b', kilobyte: 'kb', kilobytes: 'kb', megabyte: 'mb', megabytes: 'mb', gigabyte: 'gb', gigabytes: 'gb', gigs: 'gb', terabyte: 'tb', terabytes: 'tb',
  second: 's', seconds: 's', sec: 's', minute: 'min', minutes: 'min', hour: 'h', hours: 'h', hr: 'h', days: 'day', weeks: 'week',
  'square meters': 'm2', 'square metres': 'm2', 'square feet': 'ft2', 'sq ft': 'ft2', acres: 'acre', hectare: 'ha', hectares: 'ha',
  celsius: 'c', centigrade: 'c', 'degrees celsius': 'c', fahrenheit: 'f', 'degrees fahrenheit': 'f', kelvin: 'k',
};
export function unitId(raw: string): string | null {
  const u = raw.trim().toLowerCase().replace(/^degrees? /, (m) => (/(celsius|fahrenheit)/.test(raw) ? m : ''));
  if (UNITS[u]) return u;
  if (ALIASES[u]) return ALIASES[u];
  if (ALIASES[u.replace(/^degrees? /, '')]) return ALIASES[u.replace(/^degrees? /, '')];
  return null;
}
export function convert(value: number, from: string, to: string): number {
  const a = UNITS[from], b = UNITS[to];
  if (a.dim !== b.dim) throw new ToolError(`I can't convert ${a.name} to ${b.name}.`, 'invalid_input');
  if (a.dim === 'temperature') {
    const c = from === 'c' ? value : from === 'f' ? ((value - 32) * 5) / 9 : value - 273.15;
    return to === 'c' ? c : to === 'f' ? (c * 9) / 5 + 32 : c + 273.15;
  }
  return (value * a.f) / b.f;
}

// ---------------------------------------------------------------------------
// Weather (Open-Meteo: free, no API key)
// ---------------------------------------------------------------------------
const WMO: Record<number, string> = {
  0: 'clear skies', 1: 'mostly clear', 2: 'partly cloudy', 3: 'overcast', 45: 'foggy', 48: 'freezing fog', 51: 'light drizzle', 53: 'drizzle', 55: 'heavy drizzle',
  61: 'light rain', 63: 'rain', 65: 'heavy rain', 66: 'freezing rain', 67: 'heavy freezing rain', 71: 'light snow', 73: 'snow', 75: 'heavy snow', 77: 'snow grains',
  80: 'light showers', 81: 'showers', 82: 'violent showers', 85: 'snow showers', 86: 'heavy snow showers', 95: 'thunderstorms', 96: 'thunderstorms with hail', 99: 'severe thunderstorms with hail',
};

export interface WeatherReport { place: string; temp: number; feels: number; text: string; high: number; low: number; rain: number; wind: number; humidity: number; units: 'metric' | 'imperial' }

export function describeWeather(w: WeatherReport, brief = false): string {
  const deg = w.units === 'imperial' ? '°F' : '°C';
  const speed = w.units === 'imperial' ? 'miles per hour' : 'kilometers per hour';
  const head = `It's ${Math.round(w.temp)}${deg} and ${w.text} in ${w.place}`;
  if (brief) return `${head}, with a high of ${Math.round(w.high)}${deg}.`;
  const feels = Math.abs(w.feels - w.temp) >= 2 ? `, feeling like ${Math.round(w.feels)}${deg}` : '';
  const rain = w.rain >= 20 ? ` There's a ${w.rain} percent chance of rain today.` : '';
  return `${head}${feels}. Today's high is ${Math.round(w.high)}${deg} and the low is ${Math.round(w.low)}${deg}, with wind around ${Math.round(w.wind)} ${speed}.${rain}`;
}

export const skillTools: ToolDef[] = [
  defineTool({
    name: 'math.calculate', title: 'Calculate', description: 'Evaluate an arithmetic expression offline (+ - * / ^ %, parentheses, sqrt, sin/cos/tan in degrees, log, ln, pi, e).', category: 'Knowledge', risk: 1, permission: null,
    input: z.object({ expression: z.string().trim().min(1).max(200) }).strict(), confirm: 'never', timeoutMs: 1000, offline: true,
    describe: ({ expression }) => `Calculate ${expression}`,
    async run({ expression }) {
      const expr = /[a-z]/i.test(expression) ? spokenToExpression(expression) : expression;
      const v = evaluate(expr);
      return { ok: true, data: { expression: expr, result: v }, message: `That's ${formatNumber(v)}.` };
    },
  }),
  defineTool({
    name: 'units.convert', title: 'Convert units', description: 'Convert between units of length, mass, volume, speed, data size, time, area and temperature, offline.', category: 'Knowledge', risk: 1, permission: null,
    input: z.object({ value: z.number().finite(), from: z.string().trim().min(1).max(30), to: z.string().trim().min(1).max(30) }).strict(), confirm: 'never', timeoutMs: 1000, offline: true,
    describe: ({ value, from, to }) => `Convert ${value} ${from} to ${to}`,
    async run({ value, from, to }) {
      const a = unitId(from), b = unitId(to);
      if (!a || !b) return { ok: false, message: `I don't know the unit ${!a ? from : to}.` };
      const r = convert(value, a, b);
      return { ok: true, data: { value: r, from: a, to: b }, message: `${formatNumber(value)} ${UNITS[a].name} is ${formatNumber(r)} ${UNITS[b].name}.` };
    },
  }),
  defineTool({
    name: 'weather.current', title: 'Weather', description: "Current weather and today's forecast for a place (or the location set in Settings), via Open-Meteo.", category: 'Knowledge', risk: 1, permission: 'web',
    input: z.object({ location: z.string().trim().max(80).optional() }).strict(), confirm: 'never', timeoutMs: 12000, offline: false,
    describe: ({ location }) => `Get the weather for ${location || 'your location'}`,
    async run({ location }, ctx) {
      const place = location || ctx.settings.tools.weatherLocation;
      if (!place) return { ok: false, message: 'Which city? You can also set your home city in Settings, Permissions, so I always know.' };
      const fetchImpl = ctx.net;
      const geo = (await (await fetchImpl(`https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&format=json&name=${encodeURIComponent(place)}`, { signal: ctx.signal })).json()) as { results?: Array<{ name: string; country?: string; admin1?: string; latitude: number; longitude: number }> };
      const g = geo.results?.[0];
      if (!g) return { ok: false, message: `I couldn't find a place called ${place}.` };
      const imperial = ctx.settings.tools.units === 'imperial';
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${g.latitude}&longitude=${g.longitude}&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=1${imperial ? '&temperature_unit=fahrenheit&wind_speed_unit=mph' : ''}`;
      const f = (await (await fetchImpl(url, { signal: ctx.signal })).json()) as { current: { temperature_2m: number; apparent_temperature: number; weather_code: number; wind_speed_10m: number; relative_humidity_2m: number }; daily: { temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_probability_max: Array<number | null> } };
      const report: WeatherReport = {
        place: g.name, temp: f.current.temperature_2m, feels: f.current.apparent_temperature, text: WMO[f.current.weather_code] ?? 'mixed conditions',
        high: f.daily.temperature_2m_max[0], low: f.daily.temperature_2m_min[0], rain: f.daily.precipitation_probability_max[0] ?? 0,
        wind: f.current.wind_speed_10m, humidity: f.current.relative_humidity_2m, units: imperial ? 'imperial' : 'metric',
      };
      return { ok: true, data: report, message: describeWeather(report) };
    },
  }),
  defineTool({
    name: 'screen.capture', title: 'Look at the screen', description: 'Capture one screenshot of the primary display so a vision-capable model can answer a question about it. Always asks first; the image is not stored.', category: 'Vision', risk: 2, permission: 'screen',
    input: z.object({ question: z.string().trim().max(300).default('Describe what is on my screen.') }).strict(), confirm: 'always', timeoutMs: 60000, offline: true,
    confirmLabel: () => 'Capture the screen once',
    describe: () => 'Take one screenshot of your main display and send it to your selected AI model to answer your question. It is not saved.',
    async run(_i, ctx) {
      const png = await ctx.platform.captureScreen();
      return { ok: true, data: { pngBase64: png }, message: 'Captured the screen.' };
    },
  }),
];
