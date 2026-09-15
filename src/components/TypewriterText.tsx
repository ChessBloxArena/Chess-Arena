import { translateText, localize, useLanguage } from '@/lib/i18n';
import { useState, useEffect } from 'react';

interface TypewriterTextProps {
  text: string;
  speed?: number;
  className?: string;
  style?: React.CSSProperties;
}

export default function TypewriterText({
  text,
  speed = 40,
  className = '',
  style
}: TypewriterTextProps) {
  useLanguage();
  text = translateText(text);
  const [displayedText, setDisplayedText] = useState('');
  const [isTyping, setIsTyping] = useState(true);

  useEffect(() => {
    setDisplayedText('');
    setIsTyping(true);

    if (!text) return;

    let currentIndex = 0;
    const interval = setInterval(() => {
      if (currentIndex < text.length) {
        setDisplayedText(text.slice(0, currentIndex + 1));
        currentIndex++;
      } else {
        setIsTyping(false);
        clearInterval(interval);
      }
    }, speed);

    return () => clearInterval(interval);
  }, [text, speed]);

  return (
    <span className={className} style={style}>
      "{displayedText}
      {localize(isTyping && <span className="retro-blink">▌</span>)}
      {localize(!isTyping && '"')}
    </span>
  );
}
