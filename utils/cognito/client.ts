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

export function signIn(email: string, password: string): Promise<CognitoUserSession> {
  const user = new CognitoUser({ Username: email, Pool: getUserPool() });
  const authDetails = new AuthenticationDetails({
    Username: email,
    Password: password,
  });

  return new Promise((resolve, reject) => {
    user.authenticateUser(authDetails, {
      onSuccess: (session) => resolve(session),
      onFailure: (err) => reject(err),
    });
  });
}

export function signUp(params: {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phoneNumber?: string;
}): Promise<{ userConfirmed: boolean }> {
  const attributes = [
    new CognitoUserAttribute({
      Name: 'name',
      Value: `${params.firstName} ${params.lastName}`,
    }),
    new CognitoUserAttribute({ Name: 'custom:admin', Value: 'false' }),
    ...(params.phoneNumber
      ? [new CognitoUserAttribute({ Name: 'phone_number', Value: params.phoneNumber })]
      : []),
  ];

  return new Promise((resolve, reject) => {
    getUserPool().signUp(
      params.email,
      params.password,
      attributes,
      [],
      (err, result) => {
        if (err || !result) {
          reject(err);
          return;
        }
        resolve({ userConfirmed: result.userConfirmed });
      }
    );
  });
}

export function confirmSignUp(email: string, code: string): Promise<void> {
  const user = new CognitoUser({ Username: email, Pool: getUserPool() });
  return new Promise((resolve, reject) => {
    user.confirmRegistration(code, true, (err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

export function resendConfirmationCode(email: string): Promise<void> {
  const user = new CognitoUser({ Username: email, Pool: getUserPool() });
  return new Promise((resolve, reject) => {
    user.resendConfirmationCode((err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

export function signOut(): void {
  getCurrentCognitoUser()?.signOut();
}
