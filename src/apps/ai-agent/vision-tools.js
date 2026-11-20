// AI-7/AI-8 pure helpers for the vision tools: input validation, result shaping, the OCR
// downscale plan, the background-removal engine metadata and the tool schemas. No DOM, no
// storage: the heavy work (models + image processing) lives in vision-worker.js.
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // same bound as the AI-1 attached image
export const OCR_MAX_TEXT = 20_000; // OCR output bound
export const OCR_MAX_DIM = 768; // longest side after downscaling, before OCR
export const NOBG_SUFFIX = '-nobg.png';

const IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);
const IMAGE_EXT = /\.(png|jpe?g|webp)$/i;

/** Error string when a file cannot be a vision source (type or size), else ''. */
export function validateImageFile({ name = '', type = '', size = 0 } = {}) {
  const okType = IMAGE_MIME.has(type) || (type === '' && IMAGE_EXT.test(name));
  if (!okType) return 'Only PNG, JPEG and WebP images are supported.';
  if (size > MAX_IMAGE_BYTES) return `The image is too large (at most ${MAX_IMAGE_BYTES / 1048576} MB).`;
  return '';
}

/** Bound OCR output at OCR_MAX_TEXT characters, with a truncation marker. */
export function ocrTextResult(text) {
  const t = String(text ?? '');
  return t.length > OCR_MAX_TEXT ? `${t.slice(0, OCR_MAX_TEXT).trimEnd()} …[truncated]` : t;
}

/** `photos/cat.jpg` -> `photos/cat-nobg.png`: the background-removed PNG next to the source. */
export function nobgName(path) {
  const p = String(path ?? '');
  const slash = p.lastIndexOf('/');
  const dot = p.lastIndexOf('.');
  const base = dot > slash ? p.slice(0, dot) : p; // strip a real file extension, keep dir
  return `${base}${NOBG_SUFFIX}`;
}

/** Aspect-preserving downscale so the longest side is at most maxDim; never upscales. */
export function downscalePlan(width, height, maxDim = OCR_MAX_DIM) {
  const w = Math.max(1, Math.trunc(width));
  const h = Math.max(1, Math.trunc(height));
  const scale = Math.min(1, maxDim / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

// Background-removal engine choices for the Part B settings UI (the worker owns the repos and
// revisions): 'modnet' is the default; 'birefnet' is the higher-quality option (WebGPU only,
// because its only small-enough ONNX is fp16 and ORT WASM is fp32-only).
export const BGBM_ENGINES = [
  { id: 'modnet', name: 'MODNet', sizeMB: 6.3, note: 'Best for people and portraits.' },
  { id: 'birefnet', name: 'BiRefNet Lite', sizeMB: 109.2, webgpuOnly: true, note: 'General objects (needs a GPU with fp16).' },
];

// Tool schemas in the shape createTools() expects (agent.js): Part B wires the run() bodies.
export const VISION_TOOL_SCHEMAS = {
  ocr_image: {
    description: "Read the text in an image with the local Florence-2 model (on this device; first use downloads the model). source is 'attached' for the attached image, or a path of an image inside a granted folder.",
    parameters: {
      type: 'object',
      properties: {
        source: { type: 'string', description: "'attached', or a path inside a granted folder" },
      },
      required: ['source'],
    },
  },
  remove_background: {
    description: "Remove the background of an image with the local MODNet model (best for people and portraits; BiRefNet Lite, for general objects, when selected in Settings; on this device, first use downloads the model). source is 'attached' for the attached image, or a path of an image inside a granted folder. Saves a transparent PNG '<name>-nobg.png' through the write_file confirmation into the granted folder, or offers a download when there is no grant.",
    parameters: {
      type: 'object',
      properties: {
        source: { type: 'string', description: "'attached', or a path inside a granted folder" },
      },
      required: ['source'],
    },
  },
};
