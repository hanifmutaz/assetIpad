import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { UiProvider } from './components/ui.jsx';
import { AuthProvider } from './auth.jsx';
import './styles.css';

if (localStorage.getItem('ipadDark')) document.body.classList.add('dark');
if (localStorage.getItem('ipadSide')) document.body.classList.add('collapsed');

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <UiProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </UiProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
