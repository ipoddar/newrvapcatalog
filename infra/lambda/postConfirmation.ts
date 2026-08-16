import type { PostConfirmationTriggerEvent } from 'aws-lambda';
import { sendEmail } from './lib/email';

export async function handler(event: PostConfirmationTriggerEvent): Promise<PostConfirmationTriggerEvent> {
  // Only fires once, right after a user completes email verification —
  // not on every subsequent login.
  if (event.triggerSource === 'PostConfirmation_ConfirmSignUp') {
    const email = event.request.userAttributes.email;
    const name = event.request.userAttributes.name ?? '';

    await sendEmail(
      email,
      'Welcome to the RVAP Library Catalog',
      `Hi ${name || 'there'},\n\nYour account is confirmed and ready to use. You can now sign in, browse the catalog, and check out books.\n\n— Ramakrishna Vedanta Ashrama of Pittsburgh`
    );
  }

  return event;
}
