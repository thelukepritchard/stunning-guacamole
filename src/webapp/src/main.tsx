import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AwsRum, type AwsRumConfig } from 'aws-rum-web';
import '@shared/styles/global.css';
import { configureAmplify } from './amplify';
import App from './App';

try {
  const config: AwsRumConfig = {
    sessionSampleRate: 1,
    endpoint: 'https://dataplane.rum.ap-southeast-2.amazonaws.com',
    telemetries: ['performance', 'errors', 'http'],
    allowCookies: true,
    enableXRay: true,
    signing: true,
  };

  const APPLICATION_ID = '29b89b12-17ac-4168-b8fe-237218c2dcd0';
  const APPLICATION_VERSION = '1.0.0';
  const APPLICATION_REGION = 'ap-southeast-2';

  new AwsRum(APPLICATION_ID, APPLICATION_VERSION, APPLICATION_REGION, config);
} catch (error) {
  // Ignore errors thrown during CloudWatch RUM web client initialization
}

configureAmplify();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
