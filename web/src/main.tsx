import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {MotionConfig} from 'motion/react';
import {TooltipProvider} from '@/components/ui/tooltip';
import {App} from './App';
import './index.css';

// Apply the stored theme before first paint.
try{const stored=localStorage.getItem('dashboard-theme');const light=stored?stored==='light':matchMedia('(prefers-color-scheme: light)').matches;document.documentElement.classList.toggle('light',light);}catch{}

createRoot(document.getElementById('root')!).render(<StrictMode>
 <MotionConfig reducedMotion="user"><TooltipProvider delayDuration={200}><App/></TooltipProvider></MotionConfig>
</StrictMode>);
