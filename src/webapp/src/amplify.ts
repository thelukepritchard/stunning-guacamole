import { Amplify } from 'aws-amplify';

/**
 * Configures AWS Amplify with Cognito and API Gateway settings
 * sourced from Vite environment variables.
 *
 * Required env vars:
 * - `VITE_COGNITO_USER_POOL_ID`
 * - `VITE_COGNITO_CLIENT_ID`
 * - `VITE_API_URL`
 */
export function configureAmplify(): void {
  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID,
        userPoolClientId: import.meta.env.VITE_COGNITO_CLIENT_ID,
      },
    },
  });
}
