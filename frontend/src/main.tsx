import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { LocaleProvider } from './i18n';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <LocaleProvider>
      <App />
    </LocaleProvider>
  </BrowserRouter>
);
