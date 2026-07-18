// Tela de login (identidade SUED: mármore claro + veios dourados + monograma).
// A LÓGICA de autenticação é preservada — apenas a composição visual evolui.
import { el } from "../utils.js";
import { icon } from "../components/icons.js";
import { login } from "../auth.js";

// Monograma SUED — losango com "S", inspirado na placa física do Espaço SUED.
const MONOGRAM = `
<svg class="mono" viewBox="0 0 52 54" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <linearGradient id="mg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#e3cf94"/>
      <stop offset="0.5" stop-color="#c9a227"/>
      <stop offset="1" stop-color="#a9820a"/>
    </linearGradient>
  </defs>
  <g stroke="url(#mg)" fill="none" stroke-linejoin="round" stroke-linecap="round">
    <path d="M26 4 L46 27 L26 50 L6 27 Z" stroke-width="1.5"/>
    <path d="M26 9.5 L40 27 L26 44.5 L12 27 Z" stroke-width="0.7" opacity="0.55"/>
    <path d="M21 20.5 C 21 16.8 30.5 16.3 30.5 21 C 30.5 25 21.5 24.8 21.5 29 C 21.5 33.4 31 33 31.4 29.2" stroke-width="2"/>
    <path d="M10 22.5 L5.5 27 L10 31.5" stroke-width="1" opacity="0.85"/>
    <path d="M42 22.5 L46.5 27 L42 31.5" stroke-width="1" opacity="0.85"/>
  </g>
</svg>`;

// Veios dourados orgânicos + arco (moldura arquitetônica) — SVG leve.
const VEINS = `
<svg class="veins veins--tr" viewBox="0 0 600 900" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <linearGradient id="vgA" x1="1" y1="0" x2="0.1" y2="1">
      <stop offset="0" stop-color="#8f6c08"/><stop offset="0.45" stop-color="#c9a227"/><stop offset="1" stop-color="#e3cf94"/>
    </linearGradient>
  </defs>
  <g fill="none" stroke="url(#vgA)" stroke-linecap="round">
    <path d="M612 -20 C 556 96, 548 176, 470 224 S 372 316, 332 392 S 250 486, 300 568 S 350 690, 286 800" stroke-width="1.6" opacity="0.62"/>
    <path d="M470 224 C 512 250, 556 246, 586 300" stroke-width="1.1" opacity="0.46"/>
    <path d="M470 224 C 470 168, 506 130, 486 92" stroke-width="0.8" opacity="0.34"/>
    <path d="M332 392 C 300 366, 250 388, 214 356" stroke-width="1" opacity="0.36"/>
    <path d="M332 392 C 360 420, 420 416, 452 452" stroke-width="0.7" opacity="0.26"/>
    <path d="M300 568 C 262 548, 214 566, 186 616" stroke-width="0.85" opacity="0.3"/>
    <circle cx="470" cy="224" r="2.2" fill="#c9a227" stroke="none" opacity="0.55"/>
    <circle cx="332" cy="392" r="1.8" fill="#b8901a" stroke="none" opacity="0.5"/>
    <circle cx="300" cy="568" r="1.5" fill="#c9a227" stroke="none" opacity="0.4"/>
  </g>
</svg>
<svg class="veins veins--bl" viewBox="0 0 600 900" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <linearGradient id="vgB" x1="0" y1="1" x2="0.8" y2="0.1">
      <stop offset="0" stop-color="#8f6c08"/><stop offset="0.5" stop-color="#c9a227"/><stop offset="1" stop-color="#e3cf94"/>
    </linearGradient>
  </defs>
  <g fill="none" stroke="url(#vgB)" stroke-linecap="round">
    <path d="M-20 920 C 84 862, 116 806, 152 738 S 214 632, 182 552 S 138 456, 208 402" stroke-width="1.5" opacity="0.56"/>
    <path d="M152 738 C 120 718, 74 730, 44 700" stroke-width="1" opacity="0.36"/>
    <path d="M152 738 C 188 756, 236 748, 262 782" stroke-width="0.7" opacity="0.26"/>
    <path d="M182 552 C 214 540, 250 556, 268 526" stroke-width="0.85" opacity="0.3"/>
    <path d="M208 402 C 236 372, 232 330, 262 306" stroke-width="0.8" opacity="0.32"/>
    <circle cx="152" cy="738" r="2" fill="#b8901a" stroke="none" opacity="0.5"/>
    <circle cx="182" cy="552" r="1.6" fill="#c9a227" stroke="none" opacity="0.42"/>
  </g>
</svg>
<svg class="veins veins--arc" viewBox="0 0 600 900" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <linearGradient id="vgC" x1="0" y1="0" x2="1" y2="0.4">
      <stop offset="0" stop-color="#e3cf94"/><stop offset="0.6" stop-color="#c9a227"/><stop offset="1" stop-color="#8f6c08"/>
    </linearGradient>
  </defs>
  <g fill="none" stroke="url(#vgC)" stroke-linecap="round">
    <path d="M-60 250 C 70 96, 280 30, 520 60 S 760 150, 720 300" stroke-width="1.3" opacity="0.3"/>
    <path d="M-60 320 C 90 168, 300 104, 520 130" stroke-width="0.7" opacity="0.2"/>
  </g>
</svg>`;

// Marca SUED com foco absoluto (sem protagonismo de "ERP").
function brand(variant = "aside") {
  return el("div", { class: `login-brand login-brand--${variant}` }, [
    el("span", { class: "login-monogram", html: MONOGRAM }),
    el("div", { class: "login-brand__text" }, [
      el("span", { class: "login-brand__word" }, "SUED"),
      el("span", { class: "login-brand__caption" }, "Sistema de gestão"),
    ]),
  ]);
}

function inputField({ id, name, type, placeholder, autocomplete, iconName, trailing }) {
  const input = el("input", {
    class: "login-input", id, name, type, placeholder, autocomplete, required: "",
  });
  const wrap = el("div", { class: "login-inputwrap" }, [
    el("span", { class: "login-inputwrap__icon", html: icon(iconName, 18) }),
    input,
    trailing || null,
  ]);
  return { wrap, input };
}

export function renderLogin(onSuccess) {
  const error = el("div", { class: "login-error", style: "display:none" });

  const submit = el(
    "button",
    { class: "login-submit", type: "submit" },
    [el("span", { class: "login-submit__label" }, "Entrar")],
  );

  const email = inputField({
    id: "email", name: "email", type: "email",
    placeholder: "voce@sued.com.br", autocomplete: "email", iconName: "mail",
  });

  const eyeBtn = el("button", {
    class: "login-eye", type: "button", "aria-label": "Mostrar senha",
    tabindex: "-1", html: icon("eye", 18),
  });
  const pass = inputField({
    id: "password", name: "password", type: "password",
    placeholder: "••••••••", autocomplete: "current-password", iconName: "lock",
    trailing: eyeBtn,
  });
  eyeBtn.addEventListener("click", () => {
    const show = pass.input.type === "password";
    pass.input.type = show ? "text" : "password";
    eyeBtn.innerHTML = icon(show ? "eyeOff" : "eye", 18);
    eyeBtn.setAttribute("aria-label", show ? "Ocultar senha" : "Mostrar senha");
    pass.input.focus();
  });

  const form = el(
    "form",
    {
      class: "login__form",
      onsubmit: async (e) => {
        e.preventDefault();
        error.style.display = "none";
        submit.disabled = true;
        submit.classList.add("is-loading");
        submit.querySelector(".login-submit__label").textContent = "Entrando…";
        try {
          await login(email.input.value, pass.input.value);
          onSuccess();
        } catch (err) {
          error.textContent = err.message || "Falha ao entrar.";
          error.style.display = "block";
          submit.disabled = false;
          submit.classList.remove("is-loading");
          submit.querySelector(".login-submit__label").textContent = "Entrar";
        }
      },
    },
    [
      brand("mobile"),
      el("div", { class: "login-formhead" }, [
        el("span", { class: "login-kicker" }),
        el("h2", { class: "login-title" }, "Bem-vindo de volta"),
        el("p", { class: "login-subtitle" }, "Acesse o painel para continuar."),
      ]),
      el("div", { class: "login-fields" }, [
        el("div", { class: "login-fieldrow" }, [
          el("label", { class: "login-label", for: "email" }, "E-mail"),
          email.wrap,
        ]),
        el("div", { class: "login-fieldrow" }, [
          el("label", { class: "login-label", for: "password" }, "Senha"),
          pass.wrap,
        ]),
      ]),
      error,
      submit,
      el("p", { class: "login-foot" }, "Acesso restrito a colaboradores autorizados."),
    ],
  );

  const aside = el("aside", { class: "login__aside" }, [
    el("div", { class: "login-veins", html: VEINS }),
    el("div", { class: "login-aside__top" }, [brand("aside")]),
    el("div", { class: "login-aside__center" }, [
      el("span", { class: "login-headline__mark" }),
      el("h1", { class: "login-headline" }, [
        el("span", { class: "login-headline__lead" }, "Cada evento começa com uma ideia."),
        el("span", { class: "login-headline__accent sued-gold-text" }, "A SUED transforma em experiência."),
      ]),
      el("p", { class: "login-aside__desc" },
        "Comercial, planejamento, operação e financeiro integrados para conduzir cada etapa com precisão."),
    ]),
    el("div", { class: "login-aside__foot" }, [
      el("span", { class: "login-signature__line" }),
      el("p", { class: "login-signature__concept" }, "Três experiências. Uma única essência."),
      el("p", { class: "login-signature__houses" }, "Palácio SUED · Espaço SUED · Assessoria SUED"),
      el("p", { class: "login-signature__years" }, "+25 anos realizando eventos em Teresina"),
    ]),
  ]);

  return el("div", { class: "login" }, [
    aside,
    el("section", { class: "login__form-wrap" }, [form]),
  ]);
}
