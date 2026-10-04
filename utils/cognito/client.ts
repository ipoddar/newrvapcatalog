import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  CognitoUserSession,
  CognitoUserAttribute,
} from 'amazon-cognito-identity-js';

function getUserPool() {
  const UserPoolId = process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID;
  const ClientId = process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID;

  if (!UserPoolId || !ClientId) {
    throw new Error('Missing Cognito environment variables');
  }

  return new CognitoUserPool({ UserPoolId, ClientId });
}

export function getCurrentCognitoUser(): CognitoUser | null {
  return getUserPool().getCurrentUser();
}

export function getSession(): Promise<CognitoUserSession | null> {
  const user = getCurrentCognitoUser();
  if (!user) return Promise.resolve(null);

  return new Promise((resolve, reject) => {
    user.getSession((err: Error | null, session: CognitoUserSession | null) => {
      if (err) {
        resolve(null);
        return;
      }
      resolve(session);
    });
  });
}

export type SignInResult =
  | { type: 'success'; session: CognitoUserSession }
  | { type: 'newPasswordRequired'; cognitoUser: CognitoUser; userAttributes: Record<string, unknown> };

export function signIn(email: string, password: string): Promise<SignInResult> {
  const user = new CognitoUser({ Username: email, Pool: getUserPool() });
  const authDetails = new AuthenticationDetails({
    Username: email,
    Password: password,
  });

  return new Promise((resolve, reject) => {
    user.authenticateUser(authDetails, {
      onSuccess: (session) => resolve({ type: 'success', session }),
      onFailure: (err) => reject(err),
      newPasswordRequired: (userAttributes) => {
        // Cognito includes these in the challenge payload but rejects them
        // if echoed back in completeNewPasswordChallenge — they must be
        // stripped by the caller before submitting the new password.
        resolve({ type: 'newPasswordRequired', cognitoUser: user, userAttributes });
      },
    });
  });
}

export function completeNewPasswordChallenge(
  cognitoUser: CognitoUser,
  newPassword: string
): Promise<CognitoUserSession> {
  return new Promise((resolve, reject) => {
    cognitoUser.completeNewPasswordChallenge(newPassword, {}, {
      onSuccess: (session) => resolve(session),
      onFailure: (err) => reject(err),
    });
  });
}

export function changePassword(oldPassword: string, newPassword: string): Promise<void> {
  const user = getCurrentCognitoUser();
  if (!user) return Promise.reject(new Error('Not signed in'));

  return new Promise((resolve, reject) => {
    // changePassword requires an authenticated session on the CognitoUser
    // instance (getSession() populates it as a side effect) — calling it
    // on a freshly-constructed CognitoUser without this fails silently.
    user.getSession((err: Error | null) => {
      if (err) {
        reject(err);
        return;
      }
      user.changePassword(oldPassword, newPassword, (err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });
  });
}

export function signOut(): void {
  getCurrentCognitoUser()?.signOut();
}
