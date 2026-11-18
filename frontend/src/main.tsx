import React from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { UiProvider } from './components/ui';
import { AuthProvider } from './lib/auth';
import './styles.css';

if (localStorage.getItem('ipadDark')) document.body.classList.add('dark');
const qc = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 15_000 } } });
const router = createBrowserRouter([{
  path: '*',
  element: <UiProvider><AuthProvider><App /></AuthProvider></UiProvider>,
}]);

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>,
);
