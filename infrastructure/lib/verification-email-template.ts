/**
 * Branded HTML email template for Cognito verification codes.
 *
 * Uses the Signalr design tokens (dark navy background, cyan-blue primary)
 * to match the platform's visual identity. The `{####}` placeholder is
 * replaced by Cognito with the actual 6-digit verification code.
 *
 * Email-safe HTML: table-based layout, inline styles, system font stack.
 */
export const verificationEmailBody = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Verify your email</title>
</head>
<body style="margin:0;padding:0;background-color:#060a13;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#060a13;">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" width="480" cellspacing="0" cellpadding="0" border="0" style="max-width:480px;width:100%;">

          <!-- Logo -->
          <tr>
            <td align="center" style="padding-bottom:32px;">
              <span style="font-size:28px;font-weight:700;color:#8b5cf6;text-decoration:none;">
                Signalr
              </span>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background-color:#0b1121;border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:40px 32px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">

                <!-- Heading -->
                <tr>
                  <td align="center" style="padding-bottom:8px;">
                    <h1 style="margin:0;font-size:22px;font-weight:700;color:#e2e8f0;">
                      Verify your email
                    </h1>
                  </td>
                </tr>

                <!-- Subheading -->
                <tr>
                  <td align="center" style="padding-bottom:32px;">
                    <p style="margin:0;font-size:15px;color:#64748b;line-height:1.5;">
                      Enter the code below in the app to complete your registration.
                    </p>
                  </td>
                </tr>

                <!-- Verification Code -->
                <tr>
                  <td align="center" style="padding-bottom:32px;">
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                      <tr>
                        <td style="background-color:#101829;border:1px solid rgba(139,92,246,0.25);border-radius:8px;padding:16px 32px;">
                          <span style="font-size:32px;font-weight:700;font-family:'Courier New',Courier,monospace;color:#8b5cf6;letter-spacing:6px;">
                            {####}
                          </span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- Expiry note -->
                <tr>
                  <td align="center" style="padding-bottom:0;">
                    <p style="margin:0;font-size:13px;color:#475569;line-height:1.5;">
                      This code expires in 24 hours. If you didn't create an account, you can safely ignore this email.
                    </p>
                  </td>
                </tr>

              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top:24px;">
              <p style="margin:0;font-size:12px;color:#475569;line-height:1.6;">
                Signalr — Automated trading strategies, no code required.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

/** Subject line for the Cognito verification email. */
export const verificationEmailSubject = 'Signalr — Verify your email';
