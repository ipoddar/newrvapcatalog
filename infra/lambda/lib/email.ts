import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';

const ses = new SESv2Client({});
const FROM_ADDRESS = process.env.SES_FROM_ADDRESS!;

export async function sendEmail(to: string, subject: string, bodyText: string): Promise<void> {
  if (!to) return;

  try {
    await ses.send(
      new SendEmailCommand({
        FromEmailAddress: FROM_ADDRESS,
        Destination: { ToAddresses: [to] },
        Content: {
          Simple: {
            Subject: { Data: subject },
            Body: { Text: { Data: bodyText } },
          },
        },
      })
    );
  } catch (err) {
    // Email delivery is best-effort — a checkout/return/signup must not
    // fail because of an SES error (e.g. sandbox mode, unverified
    // recipient, throttling).
    console.error('Failed to send email', err);
  }
}
