import { createRoot } from 'react-dom/client';
import App from './App';
import './style.css';

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.warn('Aura: não foi possível registrar o service worker.', error);
    });
  });
}

createRoot(document.getElementById('root')!).render(<App />);
