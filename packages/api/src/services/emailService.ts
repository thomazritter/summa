import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_ADDRESS = process.env.RESEND_FROM_EMAIL || 'Summa <onboarding@resend.dev>';
const SITE_URL = process.env.SITE_URL || 'https://summa.thomazritter.com.br';
const REPLY_TO = process.env.RESEND_REPLY_TO || 'thomaz.ritter207@gmail.com';

const LOGO_URL = `${SITE_URL}/apple-touch-icon.png`;

const magicLinkHtml = (magicLinkUrl: string) => `<!doctype html>
<html lang="pt-BR">
  <body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1f2937;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f9fafb;padding:48px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:440px;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:40px 32px;">
            <tr>
              <td align="center" style="padding-bottom:24px;">
                <img src="${LOGO_URL}" width="48" height="48" alt="Summa" style="display:block;border-radius:10px;" />
              </td>
            </tr>
            <tr>
              <td style="font-size:18px;line-height:1.5;color:#111827;padding-bottom:8px;">
                Seu link de acesso ao Summa.
              </td>
            </tr>
            <tr>
              <td style="font-size:14px;line-height:1.6;color:#6b7280;padding-bottom:32px;">
                Expira em 15 minutos.
              </td>
            </tr>
            <tr>
              <td align="center" style="padding-bottom:24px;">
                <a href="${magicLinkUrl}" style="display:inline-block;background:#2563eb;color:#ffffff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">
                  Entrar
                </a>
              </td>
            </tr>
            <tr>
              <td style="font-size:12px;line-height:1.6;color:#9ca3af;word-break:break-all;padding-bottom:24px;">
                Se o botão não funcionar:<br/>
                <a href="${magicLinkUrl}" style="color:#6b7280;">${magicLinkUrl}</a>
              </td>
            </tr>
            <tr>
              <td style="border-top:1px solid #f3f4f6;padding-top:20px;font-size:12px;line-height:1.6;color:#9ca3af;">
                Se você não pediu este acesso, ignore este email.
              </td>
            </tr>
          </table>
          <p style="font-size:12px;color:#9ca3af;padding-top:16px;margin:0;">
            Thomaz Ritter · TCC Ciência da Computação · UNISINOS
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

const magicLinkText = (magicLinkUrl: string) =>
  `Seu link de acesso ao Summa.\n\nEntrar: ${magicLinkUrl}\n\nO link expira em 15 minutos.\n\nSe você não pediu este acesso, ignore este email.\n\n—\nThomaz Ritter\nTCC Ciência da Computação · UNISINOS`;

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
