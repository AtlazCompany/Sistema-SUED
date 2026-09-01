// Identidade visual SUED — traduzida da parede de mármore do Espaço SUED:
// ramificações douradas orgânicas (veios/kintsugi) + curvas luminosas suaves.
// Tudo em SVG leve (sem imagem pesada). Opacidade/posição controladas por CSS.

// ---------- Ramificações douradas (veios orgânicos, espessuras variadas) ----------
function branchesSvg(id, paths) {
  return `
<svg class="gold-branches" viewBox="0 0 360 420" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <linearGradient id="${id}" x1="1" y1="1" x2="0" y2="0">
      <stop offset="0" stop-color="#8f6c08"/>
      <stop offset="0.5" stop-color="#c9a227"/>
      <stop offset="1" stop-color="#e6d4a0"/>
    </linearGradient>
  </defs>
  <g fill="none" stroke="url(#${id})" stroke-linecap="round" stroke-linejoin="round">
    ${paths}
  </g>
</svg>`;
}

// Reação em cadeia: um tronco mais espesso que se ramifica em veios finos.
const CORNER = `
  <path d="M356 420 C 336 388 344 366 322 342 C 304 322 312 300 290 282 C 270 266 278 242 254 226 C 232 212 240 188 216 172 C 198 160 202 138 184 126" stroke-width="1.7" opacity="0.9"/>
  <path d="M322 342 C 338 346 354 338 360 348" stroke-width="0.9" opacity="0.6"/>
  <path d="M290 282 C 300 298 300 318 318 330" stroke-width="1" opacity="0.6"/>
  <path d="M290 282 C 276 276 260 286 254 272" stroke-width="0.7" opacity="0.5"/>
  <path d="M254 226 C 240 228 226 244 230 266" stroke-width="0.9" opacity="0.55"/>
  <path d="M254 226 C 268 214 286 220 296 206" stroke-width="0.7" opacity="0.45"/>
  <path d="M216 172 C 204 168 190 178 184 166" stroke-width="0.7" opacity="0.5"/>
  <path d="M216 172 C 218 152 232 146 232 128" stroke-width="0.8" opacity="0.5"/>
  <path d="M184 126 C 172 120 156 128 150 116" stroke-width="0.6" opacity="0.4"/>
  <circle cx="322" cy="342" r="2" fill="#c9a227" stroke="none" opacity="0.7"/>
  <circle cx="290" cy="282" r="1.8" fill="#b8901a" stroke="none" opacity="0.65"/>
  <circle cx="254" cy="226" r="1.6" fill="#c9a227" stroke="none" opacity="0.6"/>
  <circle cx="216" cy="172" r="1.4" fill="#b8901a" stroke="none" opacity="0.55"/>
`;

export function goldBranches() {
  return branchesSvg("gbCorner", CORNER);
}

// ---------- Curvas luminosas (leque de arcos suaves, como a parede iluminada) ----------
export function luminousCurves() {
  return `
<svg class="lumi-curves" viewBox="0 0 600 900" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <linearGradient id="lcStroke" x1="0" y1="1" x2="1" y2="0">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.95"/>
      <stop offset="0.55" stop-color="#f4ead2" stop-opacity="0.8"/>
      <stop offset="1" stop-color="#e3cf94" stop-opacity="0.55"/>
    </linearGradient>
  </defs>
  <g fill="none" stroke="url(#lcStroke)" stroke-linecap="round">
    <path d="M-60 900 C 120 610 240 350 560 110" stroke-width="3" opacity="0.75"/>
    <path d="M30 900 C 200 640 320 380 600 160" stroke-width="2.4" opacity="0.6"/>
    <path d="M120 900 C 280 660 400 410 640 240" stroke-width="1.8" opacity="0.48"/>
    <path d="M-150 880 C 40 590 130 320 430 80" stroke-width="1.8" opacity="0.55"/>
  </g>
</svg>`;
}
