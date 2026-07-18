// Motivo de identidade SUED: rachaduras douradas ramificadas (estilo kintsugi),
// inspiradas na parede de mármore do Espaço SUED — "reação em cadeia" dourada.
// SVG leve, usado como camada decorativa MUITO sutil no sistema inteiro.
// A opacidade/posicionamento final é controlado por CSS (não prejudicar leitura).

function crackSvg(id, paths) {
  return `
<svg class="gold-cracks" viewBox="0 0 360 360" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <linearGradient id="${id}" x1="1" y1="1" x2="0" y2="0">
      <stop offset="0" stop-color="#8f6c08"/>
      <stop offset="0.5" stop-color="#c9a227"/>
      <stop offset="1" stop-color="#e3cf94"/>
    </linearGradient>
  </defs>
  <g fill="none" stroke="url(#${id})" stroke-linecap="round" stroke-linejoin="round">
    ${paths}
  </g>
</svg>`;
}

// Rachadura que emana de um canto e se ramifica (reação em cadeia).
const CORNER_PATHS = `
  <path d="M356 356 C 338 330 342 314 324 296 C 308 280 314 262 294 246 C 276 232 282 212 260 198 C 240 186 246 166 224 154" stroke-width="1.4" opacity="0.9"/>
  <path d="M324 296 C 338 300 352 292 360 300" stroke-width="0.8" opacity="0.6"/>
  <path d="M294 246 C 302 260 302 278 318 288" stroke-width="0.8" opacity="0.55"/>
  <path d="M260 198 C 246 200 234 214 238 234" stroke-width="0.8" opacity="0.55"/>
  <path d="M224 154 C 212 150 198 160 192 148" stroke-width="0.7" opacity="0.5"/>
  <path d="M224 154 C 226 138 240 132 240 116" stroke-width="0.7" opacity="0.5"/>
  <path d="M294 246 C 280 240 264 250 258 238" stroke-width="0.6" opacity="0.45"/>
  <circle cx="324" cy="296" r="1.9" fill="#c9a227" stroke="none" opacity="0.7"/>
  <circle cx="294" cy="246" r="1.7" fill="#b8901a" stroke="none" opacity="0.65"/>
  <circle cx="260" cy="198" r="1.5" fill="#c9a227" stroke="none" opacity="0.6"/>
  <circle cx="224" cy="154" r="1.3" fill="#b8901a" stroke="none" opacity="0.55"/>
`;

export function goldCracks() {
  return crackSvg("gcCorner", CORNER_PATHS);
}
