const SITE_URL = process.env.SITE_URL!;

// Shared by adminCreateUser.ts (new account) and adminSetPassword.ts
// (existing account, password reset) — both hand the user a password an
// admin chose, so the instructions and consent notice are identical; only
// the opening line differs.
export function buildCredentialsEmail(opts: {
  name: string;
  email: string;
  password: string;
  isNewAccount: boolean;
}): string {
  const { name, email, password, isNewAccount } = opts;
  const intro = isNewAccount
    ? `An administrator has created a library catalog account for you at the Ramakrishna Vedanta Ashrama of Pittsburgh.`
    : `An administrator has reset the password for your library catalog account at the Ramakrishna Vedanta Ashrama of Pittsburgh.`;

  return `Hi ${name},

${intro}

Sign in here: ${SITE_URL}/login
Email: ${email}
Password: ${password}

This password won't expire — you can keep using it, or change it any time after signing in from the account menu.

About the catalog: it holds books on Sri Ramakrishna, Holy Mother, and Swami Vivekananda's lives and teachings, Vedanta philosophy, sacred texts, devotional music and prayers, and more — spanning English, Sanskrit, Hindi, Bengali, and Tamil.

Checking out and returning books:
- Find a book and click the checkout icon on its row to borrow it.
- Click the same icon again (it becomes a return icon) when you're ready to return it.
- A row highlighted in yellow means it's already checked out.

Please note: the library sends automated email reminders if a book you've checked out hasn't been returned after a while. By confirming this account and signing in, you're agreeing to receive these reminder emails.

— Ramakrishna Vedanta Ashrama of Pittsburgh`;
}
