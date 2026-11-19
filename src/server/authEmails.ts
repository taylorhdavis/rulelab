import type {
  GetPasswordResetEmailContentFn,
  GetVerificationEmailContentFn,
} from "wasp/server/auth/email"

const BRAND_NAME = "RuleLab"

export const getVerificationEmailContent: GetVerificationEmailContentFn = ({
  verificationLink,
}) => {
  return buildAuthEmail({
    title: "Verify your email",
    preview: "Confirm your email address to start using RuleLab.",
    body: [
      "Confirm your email address to finish setting up your account.",
    ],
    buttonLabel: "Verify email",
    link: verificationLink,
    footerNote: "If you did not create a RuleLab account, you can safely ignore this email.",
  })
}

export const getPasswordResetEmailContent: GetPasswordResetEmailContentFn = ({
  passwordResetLink,
}) => {
  return buildAuthEmail({
    title: "RuleLab password reset request",
    preview: "A password reset was requested for your RuleLab account.",
    body: [
      "A password reset was requested for your RuleLab account.",
      "Use the link below to choose a new password. If you did not ask for this, you can ignore this email.",
    ],
    buttonLabel: "Choose a new password",
    link: passwordResetLink,
    footerNote: "This link is only for the person who requested the password change.",
  })
}

type AuthEmailArgs = {
  body: string[]
  buttonLabel: string
  footerNote: string
  link: string
  preview: string
  title: string
}

function buildAuthEmail({
  body,
  buttonLabel,
  footerNote,
  link,
  preview,
  title,
}: AuthEmailArgs) {
  const safeLink = escapeHtml(link)
  const bodyHtml = body
    .map((paragraph) => `<p style="margin:0 0 16px;color:#cbd5e1;font-size:16px;line-height:1.7;">${escapeHtml(paragraph)}</p>`)
    .join("")

  return {
    subject: title,
    text: [
      title,
      "",
      ...body,
      "",
      `${buttonLabel}: ${link}`,
      "",
      footerNote,
      "",
      "Need help? Contact your instance administrator.",
    ].join("\n"),
    html: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="x-apple-disable-message-reformatting">
    <title>${escapeHtml(title)}</title>
  </head>
  <body style="margin:0;padding:0;background:#111111;font-family:Arial,Helvetica,sans-serif;color:#f8fafc;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preview)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#111111;padding:32px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#1f1f1f;border:1px solid rgba(255,255,255,0.12);border-radius:18px;overflow:hidden;">
            <tr>
              <td style="padding:28px 30px 0;background:#1f1f1f;">
                <table role="presentation" cellspacing="0" cellpadding="0">
                  <tr>
                    <td width="36" height="36" align="center" valign="middle" style="width:36px;height:36px;border-radius:10px;background:#ebebeb;color:#1f1f1f;">
                      <span style="font-size:20px;font-weight:900;line-height:36px;">R</span>
                    </td>
                    <td style="padding-left:10px;font-size:16px;font-weight:700;color:#ffffff;">
                      ${BRAND_NAME}
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 30px 10px;background:#1f1f1f;">
                <h1 style="margin:0 0 16px;color:#ffffff;font-size:26px;line-height:1.2;font-weight:800;letter-spacing:-0.03em;">${escapeHtml(title)}</h1>
                ${bodyHtml}
                <table role="presentation" cellspacing="0" cellpadding="0" style="margin:28px 0;">
                  <tr>
                    <td style="border-radius:10px;background:#ebebeb;">
                      <a href="${safeLink}" style="display:inline-block;padding:13px 18px;color:#1f1f1f;text-decoration:none;font-weight:700;font-size:15px;border-radius:10px;">${escapeHtml(buttonLabel)}</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:0 0 8px;color:#94a3b8;font-size:13px;line-height:1.6;">If the button does not work, copy and paste this link:</p>
                <p style="margin:0;padding:12px;background:#171717;border:1px solid rgba(255,255,255,0.1);border-radius:10px;color:#e5e7eb;font-size:12px;line-height:1.5;word-break:break-all;">${safeLink}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:22px 30px 30px;background:#1f1f1f;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-top:1px solid rgba(255,255,255,0.1);padding-top:20px;">
                  <tr>
                    <td>
                      <p style="margin:0;color:#94a3b8;font-size:13px;line-height:1.6;">${escapeHtml(footerNote)}</p>
                      <p style="margin:14px 0 0;color:#71717a;font-size:12px;line-height:1.6;">Need help? Contact your instance administrator.</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`,
  }
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}
