#!/usr/bin/env ts-node
/**
 * Gmail send helper — sends HTML email via Gmail OAuth2 or App Password.
 * Replaces gmail_send_helper.py — no Python dependency required.
 *
 * Environment variables:
 *   GMAIL_USER           Gmail address to send from
 *   GMAIL_CLIENT_ID      OAuth2 client ID       (preferred)
 *   GMAIL_CLIENT_SECRET  OAuth2 client secret   (preferred)
 *   GMAIL_REFRESH_TOKEN  OAuth2 refresh token   (preferred)
 *   GMAIL_APP_PASSWORD   App password fallback  (alternative)
 */

import nodemailer from "nodemailer";
import * as fs from "fs";
import dotenv from "dotenv";

dotenv.config();

export interface SendGmailOptions {
  to: string;
  subject: string;
  htmlBody: string;
  from?: string;
  cc?: string;
}

export async function sendGmail(options: SendGmailOptions): Promise<string> {
  const { to, subject, htmlBody, cc } = options;
  const gmailUser = options.from ?? process.env.GMAIL_USER ?? process.env.EMAIL_FROM ?? "";

  const hasOAuth2 =
    process.env.GMAIL_CLIENT_ID &&
    process.env.GMAIL_CLIENT_SECRET &&
    process.env.GMAIL_REFRESH_TOKEN;

  let transporter: nodemailer.Transporter;

  if (hasOAuth2) {
    transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        type: "OAuth2",
        user: gmailUser,
        clientId: process.env.GMAIL_CLIENT_ID,
        clientSecret: process.env.GMAIL_CLIENT_SECRET,
        refreshToken: process.env.GMAIL_REFRESH_TOKEN,
      },
    });
  } else if (process.env.GMAIL_APP_PASSWORD) {
    transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: gmailUser,
        pass: process.env.GMAIL_APP_PASSWORD,
      },
    });
  } else {
    throw new Error(
      "No Gmail credentials found. Set GMAIL_CLIENT_ID/GMAIL_CLIENT_SECRET/GMAIL_REFRESH_TOKEN or GMAIL_APP_PASSWORD."
    );
  }

  const mailOptions: nodemailer.SendMailOptions = {
    from: gmailUser,
    to,
    subject,
    html: htmlBody,
  };

  if (cc) {
    mailOptions.cc = cc;
  }

  const info = await transporter.sendMail(mailOptions);
  return `Message sent: ${info.messageId}`;
}

// ============================================================
// CLI entry point — mirrors gmail_send_helper.py interface:
//   ts-node gmail-send-helper.ts --body-file <path> --to <addr> --subject <text>
// ============================================================
if (require.main === module) {
  const args = process.argv.slice(2);

  const getArg = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    return idx !== -1 ? args[idx + 1] : undefined;
  };

  const bodyFile = getArg("--body-file");
  const to = getArg("--to");
  const subject = getArg("--subject");

  if (!bodyFile || !to || !subject) {
    console.error(
      "Usage: ts-node gmail-send-helper.ts --body-file <path> --to <recipients> --subject <subject>"
    );
    process.exit(1);
  }

  const htmlBody = fs.readFileSync(bodyFile, "utf-8");

  sendGmail({ to, subject, htmlBody })
    .then(result => {
      console.log(result);
      process.exit(0);
    })
    .catch(err => {
      console.error("Error:", (err as Error).message);
      process.exit(1);
    });
}
