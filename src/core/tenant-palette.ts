/** Tenant-only colors: INMOJCO's public brand and SuperAdmin use their original palette. */
export const TENANT_DEFAULT_PRIMARY = '#0f172a';
export const TENANT_DEFAULT_SECONDARY = '#f5f5f4';

export function safeBrandUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}

export function safeTenantColor(value: string | null | undefined, fallback: string): string {
  return value && /^#[0-9a-fA-F]{6}$/.test(value) ? value.toLowerCase() : fallback;
}

function hex(red: number, green: number, blue: number) {
  return '#' + [red, green, blue]
    .map(n => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0'))
    .join('');
}
function luminance(red: number, green: number, blue: number) {
  const normalized = [red, green, blue].map(v => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return normalized[0] * 0.2126 + normalized[1] * 0.7152 + normalized[2] * 0.0722;
}

/** Dominant recognizable color, with guaranteed legible white navigation labels. */
export function extractTenantPalette(pixels: Uint8ClampedArray): { primary: string; secondary: string } {
  const buckets = new Map<string, { r: number; g: number; b: number; score: number }>();
  for (let i = 0; i < pixels.length; i += 4) {
    const [r, g, b, a] = [pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]];
    if (a < 160) continue;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const saturation = max === 0 ? 0 : (max - min) / max;
    if (max > 245 || max < 30 || saturation < 0.16) continue;
    const key = [r, g, b].map(x => Math.floor(x / 32)).join(':');
    const existing = buckets.get(key) ?? { r: 0, g: 0, b: 0, score: 0 };
    const weight = 1 + saturation;
    existing.r += r * weight;
    existing.g += g * weight;
    existing.b += b * weight;
    existing.score += weight;
    buckets.set(key, existing);
  }
  const selected = [...buckets.values()].sort((a, b) => b.score - a.score)[0];
  if (!selected) throw new Error('El logo no contiene un color identificable. Elige un color manualmente en Configuración.');
  let r = selected.r / selected.score, g = selected.g / selected.score, b = selected.b / selected.score;
  while ((1.05 / (luminance(r, g, b) + 0.05)) < 4.5) {
    r *= 0.9; g *= 0.9; b *= 0.9;
  }
  return {
    primary: hex(r, g, b),
    secondary: hex(r * 0.12 + 255 * 0.88, g * 0.12 + 255 * 0.88, b * 0.12 + 255 * 0.88),
  };
}

/** Fetches only a public HTTPS logo; cross-origin hosts must permit CORS for pixel inspection. */
export async function paletteFromLogoUrl(value: string): Promise<{ primary: string; secondary: string }> {
  const url = safeBrandUrl(value);
  if (!url) throw new Error('Registra primero una dirección HTTPS válida para el logo.');
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    const timeout = window.setTimeout(() => {
      img.src = '';
      reject(new Error('El logo tardó demasiado en cargar. Puedes elegir los colores manualmente.'));
    }, 10000);
    img.crossOrigin = 'anonymous';
    img.onload = () => { window.clearTimeout(timeout); resolve(img); };
    img.onerror = () => {
      window.clearTimeout(timeout);
      reject(new Error('El sitio del logo no permite analizar sus colores. Usa una imagen HTTPS con CORS o selecciona un color manualmente.'));
    };
    img.src = url;
  });
  const canvas = document.createElement('canvas');
  canvas.width = 96; canvas.height = 96;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Este navegador no permite analizar imágenes.');
  context.drawImage(image, 0, 0, 96, 96);
  try {
    return extractTenantPalette(context.getImageData(0, 0, 96, 96).data);
  } catch (e) {
    if (e instanceof DOMException && e.name === 'SecurityError')
      throw new Error('El alojamiento del logo no permite leer sus colores. Puedes elegir los colores manualmente.');
    throw e;
  }
}
