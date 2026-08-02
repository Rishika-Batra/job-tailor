import { CognitoUserPool, CognitoUserAttribute, AuthenticationDetails, CognitoUser } from 'amazon-cognito-identity-js';

const poolData = {
  UserPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID || '',
  ClientId: import.meta.env.VITE_COGNITO_CLIENT_ID || ''
};

export const userPool = new CognitoUserPool(poolData);

export const signUp = (email: string, password: string): Promise<any> => {
  const attributeList = [
    new CognitoUserAttribute({ Name: 'email', Value: email })
  ];

  return new Promise((resolve, reject) => {
    userPool.signUp(email, password, attributeList, [], (err, result) => {
      if (err) {
        reject(err);
      } else {
        resolve(result);
      }
    });
  });
};

export const confirmSignUp = (email: string, code: string): Promise<any> => {
  const user = new CognitoUser({
    Username: email,
    Pool: userPool
  });

  return new Promise((resolve, reject) => {
    user.confirmRegistration(code, true, (err, result) => {
      if (err) {
        reject(err);
      } else {
        resolve(result);
      }
    });
  });
};

export const signIn = (email: string, password: string): Promise<string> => {
  const authDetails = new AuthenticationDetails({
    Username: email,
    Password: password
  });

  const user = new CognitoUser({
    Username: email,
    Pool: userPool
  });

  return new Promise((resolve, reject) => {
    user.authenticateUser(authDetails, {
      onSuccess: (result) => {
        resolve(result.getIdToken().getJwtToken());
      },
      onFailure: (err) => {
        reject(err);
      }
    });
  });
};

export const signOut = (): void => {
  const user = userPool.getCurrentUser();
  if (user) {
    user.signOut();
  }
};

export const getCurrentUserToken = (): Promise<string | null> => {
  const user = userPool.getCurrentUser();
  if (!user) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    user.getSession((err: any, session: any) => {
      if (err) {
        resolve(null);
      } else if (session.isValid()) {
        resolve(session.getIdToken().getJwtToken());
      } else {
        resolve(null);
      }
    });
  });
};
