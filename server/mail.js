// Envio de e-mail transacional (achado B14, Fase 5) — hoje só usado para o
// link de redefinição de senha. Provedor escolhido pelo usuário: Resend.
//
// Sem RESEND_API_KEY configurada (conta ainda não criada), cai em modo de
// desenvolvimento: registra o link no console em vez de falhar — nunca
// bloqueia o fluxo, e a resposta ao usuário é sempre a mesma de qualquer
// forma (proteção contra enumeração de contas em server/auth.js).
import { Resend } from "resend";
import { config } from "./config.js";

const resend = config.resendApiKey ? new Resend(config.resendApiKey) : null;

export async function sendPasswordResetEmail(email, resetUrl) {
  if (!resend) {
    console.log(`[mail] RESEND_API_KEY não configurada — link de redefinição de senha para ${email}: ${resetUrl}`);
    return;
  }
  try {
    await resend.emails.send({
      from: config.mailFrom,
      to: email,
      subject: "Redefinição de senha — SUED ERP",
      html: `<p>Você pediu para redefinir sua senha no SUED ERP.</p><p><a href="${resetUrl}">Clique aqui para definir uma nova senha</a>. O link expira em 30 minutos.</p><p>Se você não pediu isso, ignore este e-mail — sua senha continua a mesma.</p>`,
    });
  } catch (e) {
    // Nunca lança — o chamador não deve saber se o envio falhou (a resposta
    // ao usuário é sempre igual). Só registrado no servidor para diagnóstico.
    console.error("sendPasswordResetEmail: falha ao enviar via Resend:", e.message);
  }
}
