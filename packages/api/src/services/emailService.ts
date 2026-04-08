import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendAccessCode(email: string, code: string) {
  if (!process.env.RESEND_API_KEY) {
    console.log(`[DEV] Access code for ${email}: ${code}`);
    return;
  }

  const siteUrl = process.env.SITE_URL || 'https://summa.thomazritter.com.br';

  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL || 'Summa <onboarding@resend.dev>',
    to: email,
    subject: 'Convite para participar de pesquisa acadêmica — Summa',
    html: `
      <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 560px; margin: 0 auto; color: #1f2937;">
        <h2 style="color: #1e3a5f;">Olá! Você foi convidado(a) para participar de uma pesquisa acadêmica.</h2>

        <p>Estamos realizando um experimento como parte de um Trabalho de Conclusão de Curso (TCC) em Ciência da Computação na UNISINOS. O objetivo é avaliar a qualidade de resumos automáticos de artigos científicos personalizados para diferentes perfis de leitores.</p>

        <p><strong>O que você vai fazer:</strong></p>
        <ul style="line-height: 1.8;">
          <li>Ler 2 artigos científicos curtos (em inglês)</li>
          <li>Comparar resumos gerados automaticamente</li>
          <li>Dar feedback para melhorar os resumos</li>
          <li>Responder um breve questionário final</li>
        </ul>

        <p><strong>Tempo estimado:</strong> 25–35 minutos</p>

        <p>Seu código de acesso:</p>
        <div style="text-align: center; margin: 24px 0;">
          <span style="font-family: monospace; font-size: 2rem; color: #2563eb; letter-spacing: 0.2em; background: #eff6ff; padding: 12px 24px; border-radius: 8px; border: 1px solid #bfdbfe;">${code}</span>
        </div>

        <p style="text-align: center;">
          <a href="${siteUrl}" style="display: inline-block; background: #2563eb; color: #ffffff; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600;">Acessar o Summa</a>
        </p>

        <p style="margin-top: 24px;">Use o código acima na tela de login para iniciar o experimento. Você pode pausar e retomar a qualquer momento usando o mesmo código.</p>

        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />

        <p style="color: #6b7280; font-size: 0.875rem;">
          Seus dados serão utilizados exclusivamente para fins acadêmicos e tratados de forma anônima.
          Em caso de dúvidas, entre em contato: <a href="mailto:thomaz.ritter207@gmail.com" style="color: #2563eb;">thomaz.ritter207@gmail.com</a>
        </p>

        <p style="color: #6b7280; font-size: 0.875rem;">Obrigado por contribuir com esta pesquisa!</p>
        <p style="color: #6b7280; font-size: 0.875rem;"><strong>Thomaz Justo Ritter</strong><br/>Ciência da Computação — UNISINOS</p>
      </div>
    `,
  });
}
