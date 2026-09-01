// Painel institucional "Parede SUED" — reprodução fiel (em SVG/CSS leve) da
// parede de mármore do Espaço SUED: leque de curvas luminosas + rede de veios
// dourados (kintsugi). Usado em áreas institucionais (topo do dashboard, telas
// especiais). O conteúdo fica sobre um scrim claro para manter a leitura.
import { el } from "../utils.js";

// Leque de curvas luminosas (linhas de luz quentes). O vinco 3D e o glow
// são aplicados por CSS (drop-shadow) — ver .sued-wall__curves em decor.css.
const WALL_CURVES = `
<svg class="wall-curves" viewBox="0 0 820 900" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <linearGradient id="wcg" x1="0" y1="1" x2="1" y2="0">
      <stop offset="0" stop-color="#fffdf7" stop-opacity="0.96"/>
      <stop offset="0.5" stop-color="#f6ead0" stop-opacity="0.85"/>
      <stop offset="1" stop-color="#e6d09a" stop-opacity="0.6"/>
    </linearGradient>
  </defs>
  <g fill="none" stroke="url(#wcg)" stroke-linecap="round">
    <path d="M70 940 C 40 620 130 330 380 60" stroke-width="3.4" opacity="0.92"/>
    <path d="M170 940 C 132 648 232 372 470 118" stroke-width="3" opacity="0.8"/>
    <path d="M270 940 C 225 672 330 414 560 190" stroke-width="2.6" opacity="0.7"/>
    <path d="M375 940 C 322 700 430 460 650 270" stroke-width="2.2" opacity="0.6"/>
    <path d="M485 940 C 425 724 540 512 740 352" stroke-width="1.8" opacity="0.5"/>
  </g>
</svg>`;

// Rede de veios dourados (kintsugi) — mais densa à direita, esparsa à esquerda.
const WALL_VEINS = `
<svg class="wall-veins" viewBox="0 0 820 600" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <linearGradient id="wvg" x1="1" y1="1" x2="0" y2="0">
      <stop offset="0" stop-color="#8a6608"/>
      <stop offset="0.5" stop-color="#c9a227"/>
      <stop offset="1" stop-color="#ecdcab"/>
    </linearGradient>
  </defs>
  <g fill="none" stroke="url(#wvg)" stroke-linecap="round" stroke-linejoin="round">
    <path d="M540 30 C 560 84 602 96 612 150 C 620 192 662 204 674 244" stroke-width="1.5" opacity="0.85"/>
    <path d="M612 150 C 642 140 682 160 704 128" stroke-width="1" opacity="0.7"/>
    <path d="M612 150 C 590 182 560 176 540 208" stroke-width="0.9" opacity="0.65"/>
    <path d="M674 244 C 704 254 724 296 764 306" stroke-width="1.1" opacity="0.72"/>
    <path d="M674 244 C 652 276 662 318 630 342" stroke-width="0.9" opacity="0.6"/>
    <path d="M764 306 C 744 356 774 408 752 456" stroke-width="1.2" opacity="0.72"/>
    <path d="M752 456 C 784 478 792 528 770 566" stroke-width="1" opacity="0.62"/>
    <path d="M752 456 C 710 466 690 508 702 548" stroke-width="0.85" opacity="0.55"/>
    <path d="M540 208 C 500 232 470 222 440 262 C 414 296 380 292 360 334" stroke-width="1.3" opacity="0.7"/>
    <path d="M440 262 C 462 302 452 344 482 374" stroke-width="0.9" opacity="0.6"/>
    <path d="M360 334 C 330 364 340 414 310 444" stroke-width="0.95" opacity="0.6"/>
    <path d="M360 334 C 382 354 422 354 442 388" stroke-width="0.8" opacity="0.52"/>
    <path d="M482 374 C 502 424 482 474 512 514" stroke-width="0.95" opacity="0.6"/>
    <path d="M512 514 C 542 524 562 564 604 566" stroke-width="0.8" opacity="0.5"/>
    <path d="M310 444 C 340 474 330 524 360 556" stroke-width="0.8" opacity="0.5"/>
    <path d="M300 96 C 322 136 300 176 332 206" stroke-width="0.7" opacity="0.45"/>
    <path d="M332 206 C 302 236 302 286 272 306" stroke-width="0.65" opacity="0.4"/>
    <path d="M540 208 C 566 214 588 236 590 268" stroke-width="0.7" opacity="0.45"/>
    <circle cx="612" cy="150" r="2.4" fill="#d4af37" stroke="none" opacity="0.85"/>
    <circle cx="674" cy="244" r="2.1" fill="#c9a227" stroke="none" opacity="0.8"/>
    <circle cx="752" cy="456" r="2.3" fill="#d4af37" stroke="none" opacity="0.8"/>
    <circle cx="440" cy="262" r="1.9" fill="#c9a227" stroke="none" opacity="0.72"/>
    <circle cx="360" cy="334" r="1.8" fill="#b8901a" stroke="none" opacity="0.7"/>
    <circle cx="512" cy="514" r="1.7" fill="#d4af37" stroke="none" opacity="0.68"/>
  </g>
</svg>`;

export function suedWall(children, opts = {}) {
  return el("div", { class: `sued-wall ${opts.className || ""}`.trim() }, [
    el("div", { class: "sued-wall__veins", html: WALL_VEINS }),
    el("div", { class: "sued-wall__curves", html: WALL_CURVES }),
    el("div", { class: "sued-wall__scrim" }),
    el("div", { class: "sued-wall__content" }, children),
  ]);
}
