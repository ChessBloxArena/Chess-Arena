import { translateText, useLanguage } from '@/lib/i18n';
import { lazy, Suspense } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, MapPinOff } from 'lucide-react';
const TitleChessScene = lazy(() => import('@/components/TitleChessScene'));

export default function NotFound() {
  useLanguage();
  return <main className="blox-lost">
    <div className="blox-lost-world"><Suspense fallback={null}><TitleChessScene /></Suspense></div>
    <section className="retro-panel blox-lost-panel">
      <MapPinOff size={38} aria-hidden="true" />
      <p className="blox-eyebrow">{translateText("404 · UNCHARTED TERRITORY")}</p>
      <h1>{translateText("Off the board.")}</h1>
      <p>{translateText("This island doesn’t exist. Your next match is back home.")}</p>
      <Link className="retro-btn retro-btn-gold" to="/"><ArrowLeft size={18} />{translateText(" BACK TO ISLAND")}</Link>
    </section>
  </main>;
}
