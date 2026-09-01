// Monograma SUED — losango com "S", extraído de views/login.js para ser
// reutilizado também nos documentos de orçamento (pré-visualização, link
// público do cliente, visualização em Contratos). Gera um id de gradiente
// único a cada chamada — evitar <linearGradient id="mg"> repetido quando
// mais de uma instância aparece na mesma página (ex.: barra da página
// pública + o próprio documento).
let counter = 0;

export function suedMonogram(size = 46) {
  const gid = `sued-mg-${counter++}`;
  return `
<svg class="mono" width="${size}" height="${size}" viewBox="0 0 52 54" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#e3cf94"/>
      <stop offset="0.5" stop-color="#c9a227"/>
      <stop offset="1" stop-color="#a9820a"/>
    </linearGradient>
  </defs>
  <g stroke="url(#${gid})" fill="none" stroke-linejoin="round" stroke-linecap="round">
    <path d="M26 4 L46 27 L26 50 L6 27 Z" stroke-width="1.5"/>
    <path d="M26 9.5 L40 27 L26 44.5 L12 27 Z" stroke-width="0.7" opacity="0.55"/>
    <path d="M21 20.5 C 21 16.8 30.5 16.3 30.5 21 C 30.5 25 21.5 24.8 21.5 29 C 21.5 33.4 31 33 31.4 29.2" stroke-width="2"/>
    <path d="M10 22.5 L5.5 27 L10 31.5" stroke-width="1" opacity="0.85"/>
    <path d="M42 22.5 L46.5 27 L42 31.5" stroke-width="1" opacity="0.85"/>
  </g>
</svg>`;
}
