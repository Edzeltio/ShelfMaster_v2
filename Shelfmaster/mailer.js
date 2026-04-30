// Email transport for ShelfMaster.
//
// If SMTP_HOST / SMTP_USER / SMTP_PASS are set, real email is sent through that
// SMTP server (works with Gmail, Outlook, Resend's SMTP relay, Mailtrap, etc.).
// If none are configured, every email is logged to the console instead — the
// app keeps working in development with no setup required.

import nodemailer from 'nodemailer';

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_FROM = process.env.SMTP_FROM || (SMTP_USER ? `ShelfMaster <${SMTP_USER}>` : 'ShelfMaster <no-reply@shelfmaster.local>');
const SMTP_SECURE = String(process.env.SMTP_SECURE || (SMTP_PORT === 465)).toLowerCase() === 'true';

let transporter = null;
let mode = 'console';

if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  mode = 'smtp';
}

export function getMailerMode() { return mode; }

export async function sendMail({ to, subject, html, text }) {
  if (!to) return { ok: false, error: 'No recipient' };

  if (!transporter) {
    // Console fallback so the rest of the app still works.
    console.log('\n📬 [mailer:console]');
    console.log('   To:      ', to);
    console.log('   Subject: ', subject);
    console.log('   Body:    ', text || html?.replace(/<[^>]+>/g, '').slice(0, 240));
    console.log('   (Set SMTP_HOST / SMTP_USER / SMTP_PASS to send real email.)\n');
    return { ok: true, mode: 'console' };
  }

  try {
    await transporter.sendMail({
      from: SMTP_FROM,
      to,
      subject,
      text: text || html?.replace(/<[^>]+>/g, ''),
      html,
    });
    return { ok: true, mode: 'smtp' };
  } catch (err) {
    console.error('[mailer] sendMail failed:', err.message);
    return { ok: false, error: err.message, mode: 'smtp' };
  }
}

// Pretty HTML wrapper used by every transactional email.
export function htmlEmail({ heading, body, ctaUrl, ctaLabel }) {
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#FAFFF0;font-family:Arial,Helvetica,sans-serif;color:#1e293b">
  <div style="max-width:560px;margin:24px auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.06)">
    <div style="background:#8C1010;color:#fff;padding:22px 26px;font-size:20px;font-weight:700">
      📚 ShelfMaster
    </div>
    <div style="padding:26px">
      <h2 style="margin:0 0 12px;color:#8C1010;font-size:18px">${heading}</h2>
      <div style="font-size:15px;line-height:1.55;color:#334155">${body}</div>
      ${ctaUrl ? `
      <div style="margin:22px 0 6px">
        <a href="${ctaUrl}" style="display:inline-block;background:#7DB356;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700">
          ${ctaLabel || 'Open ShelfMaster'}
        </a>
      </div>` : ''}
      <p style="margin-top:26px;color:#94a3b8;font-size:12px">You received this email because of activity on your ShelfMaster account.</p>
    </div>
  </div>
</body></html>`;
}
