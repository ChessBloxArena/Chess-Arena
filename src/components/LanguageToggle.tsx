import { Languages } from 'lucide-react';
import { setLanguage, useLanguage } from '@/lib/i18n';

export default function LanguageToggle() {
  const language = useLanguage();
  return <div className="language-toggle" role="group" aria-label={language === 'en' ? 'Language' : '语言'}>
    <Languages size={15} aria-hidden="true" />
    <button type="button" lang="en" aria-pressed={language === 'en'} onClick={() => setLanguage('en')}>EN</button>
    <span aria-hidden="true">/</span>
    <button type="button" lang="zh-CN" aria-pressed={language === 'zh-CN'} onClick={() => setLanguage('zh-CN')}>简体中文</button>
  </div>;
}
