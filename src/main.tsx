import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { initializeSecurityShield } from './services/securityShield.ts';

// Initialize code protection, anti-inspect, and Facebook-style security guards
initializeSecurityShield();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

