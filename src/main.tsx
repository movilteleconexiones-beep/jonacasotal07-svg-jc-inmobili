import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { OrganizationProvider } from './core/organization-context';
import { AuthProvider } from './core/auth-context';

createRoot(document.getElementById('root')!).render(
  <OrganizationProvider>
    <AuthProvider>
      <App />
    </AuthProvider>
  </OrganizationProvider>,
);
