import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_ADDRESS = process.env.RESEND_FROM_EMAIL || 'Summa <onboarding@resend.dev>';
const SITE_URL = process.env.SITE_URL || 'https://summa.thomazritter.com.br';
const REPLY_TO = process.env.RESEND_REPLY_TO || 'thomaz.ritter207@gmail.com';

const LOGO_URL = `${SITE_URL}/apple-touch-icon.png`;
const PREHEADER = 'Clique para entrar. Válido por 15 minutos.';

const magicLinkHtml = (magicLinkUrl: string) => `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <meta name="color-scheme" content="light dark" />
    <meta name="supported-color-schemes" content="light dark" />
    <title>Entrar no Summa</title>
    <style>
      @media (prefers-color-scheme: dark) {
        .bg-page    { background:#0f172a !important; }
        .bg-card    { background:#1e293b !important; border-color:#334155 !important; }
        .text-body  { color:#f1f5f9 !important; }
        .text-muted { color:#94a3b8 !important; }
        .text-faint { color:#64748b !important; }
        .border-soft { border-color:#334155 !important; }
        .link-muted { color:#94a3b8 !important; }
      }
    </style>
  </head>
  <body class="bg-page" style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#111827;">
    <div style="display:none;font-size:1px;color:#f9fafb;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">
      ${PREHEADER}
    </div>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="bg-page" style="background:#f9fafb;padding:48px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="bg-card" style="max-width:440px;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
            <tr>
              <td align="center" style="background:#2563eb;padding:32px 32px 28px 32px;">
                <span style="display:inline-block;background:#ffffff;border-radius:14px;padding:8px;line-height:0;">
                  <img src="${LOGO_URL}" width="56" height="56" alt="Summa" style="display:block;border-radius:8px;" />
                </span>
              </td>
            </tr>
            <tr>
              <td style="padding:32px 32px 0 32px;">
                <p class="text-body" style="margin:0 0 6px 0;font-size:18px;line-height:1.5;color:#111827;">
                  Seu link de acesso ao Summa.
                </p>
                <p class="text-muted" style="margin:0 0 28px 0;font-size:14px;line-height:1.6;color:#6b7280;">
                  Expira em 15 minutos.
                </p>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:0 32px 24px 32px;">
                <a href="${magicLinkUrl}" style="display:inline-block;background:#2563eb;color:#ffffff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">
                  Entrar
                </a>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 24px 32px;">
                <p class="text-faint" style="margin:0 0 6px 0;font-size:12px;line-height:1.6;color:#9ca3af;">
                  Se o botão não funcionar:
                </p>
                <p style="margin:0;font-size:12px;line-height:1.6;word-break:break-all;">
                  <a href="${magicLinkUrl}" class="link-muted" style="color:#6b7280;">${magicLinkUrl}</a>
                </p>
              </td>
            </tr>
            <tr>
              <td class="border-soft" style="border-top:1px solid #f3f4f6;padding:20px 32px 28px 32px;">
                <p class="text-faint" style="margin:0;font-size:12px;line-height:1.6;color:#9ca3af;">
                  Se você não pediu este acesso, ignore este email.
                </p>
              </td>
            </tr>
          </table>
          <p class="text-faint" style="font-size:12px;color:#9ca3af;padding-top:16px;margin:0;">
            Thomaz Ritter · TCC Ciência da Computação · UNISINOS
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

const magicLinkText = (magicLinkUrl: string) =>
  `${PREHEADER}\n\nSeu link de acesso ao Summa.\n\nEntrar: ${magicLinkUrl}\n\nO link expira em 15 minutos.\n\nSe você não pediu este acesso, ignore este email.\n\n—\nThomaz Ritter\nTCC Ciência da Computação · UNISINOS`;

export async function sendMagicLinkEmail(email: string, code: string) {
  const magicLinkUrl = `${SITE_URL}/auth/verify?code=${code}`;

  if (!process.env.RESEND_API_KEY) {
    console.log(`[DEV] Magic link for ${email}: ${magicLinkUrl}`);
    return;
  }

  await resend.emails.send({
    from: FROM_ADDRESS,
    to: email,
    replyTo: REPLY_TO,
    subject: 'Entrar no Summa',
    html: magicLinkHtml(magicLinkUrl),
    text: magicLinkText(magicLinkUrl),
  });
}
