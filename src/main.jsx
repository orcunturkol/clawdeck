import { createRoot } from 'react-dom/client';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-sans/400-italic.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './styles.css';
import App from './App.jsx';

// One icon pixel = a whole number of screen pixels, so the pixel icons stay sharp.
function iconSize() {
  const r = window.devicePixelRatio || 1;
  document.documentElement.style.setProperty('--icon', `${(16 * Math.max(1, Math.round(r))) / r}px`);
}
iconSize();
window.addEventListener('resize', iconSize);

createRoot(document.getElementById('root')).render(<App />);
