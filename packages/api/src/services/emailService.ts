import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendAccessCode(email: string, code: string) {
  if (!process.env.RESEND_API_KEY) {
    console.log(`[DEV] Access code for ${email}: ${code}`);
    return;
  }

  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL || 'Summa <onboarding@resend.dev>',
    to: email,
    subject: 'Seu codigo de acesso - Summa',
    html: `
      <h2>Bem-vindo ao Summa!</h2>
      <p>Seu codigo de acesso para o experimento e:</p>
      <h1 style="font-family: monospace; font-size: 2rem; color: #3b82f6; letter-spacing: 0.2em;">${code}</h1>
      <p>Use este codigo para acessar o sistema em qualquer momento.</p>
      <p>Obrigado por participar!</p>
    `,
  });
}
