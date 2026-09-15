import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import LanguageToggle from '@/components/LanguageToggle';
import PlayTermsText from '@/components/PlayTermsText';
import { LANGUAGE_STORAGE_KEY, localize, setLanguage, translateText, useLanguage } from './i18n';
import { describeMove } from './moveHistoryDescription';

afterEach(() => { cleanup(); setLanguage('en'); localStorage.removeItem(LANGUAGE_STORAGE_KEY); vi.restoreAllMocks(); });

describe('Simplified Chinese language selection', () => {
  it('switches copy, accessibility language and saved preference without resetting active state', () => {
    function Harness() {
      useLanguage(); const [moves, setMoves] = useState(0);
      return <><LanguageToggle/><button onClick={() => setMoves(moves + 1)}>{translateText('Play computer')}</button><output>{moves}</output></>;
    }
    render(<Harness/>);
    fireEvent.click(screen.getByRole('button', { name: 'Play computer' }));
    fireEvent.click(screen.getByRole('button', { name: '简体中文' }));
    expect(screen.getByRole('button', { name: '对战电脑' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('1');
    expect(document.documentElement.lang).toBe('zh-CN');
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('zh-CN');
    fireEvent.click(screen.getByRole('button', { name: 'EN' }));
    expect(screen.getByRole('button', { name: 'Play computer' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('1');
  });
  it('keeps amounts, unknown user text and addresses unchanged while translating dynamic prompts', () => {
    setLanguage('zh-CN');
    expect(translateText('Confirm 0.005 ETH & play')).toBe('确认 0.005 ETH 并开始');
    expect(translateText('Quote expires in 17 seconds.')).toBe('报价将在 17 秒后过期。');
    expect(localize('0x1111111111111111111111111111111111111111')).toBe('0x1111111111111111111111111111111111111111');
    expect(localize('My custom player name')).toBe('My custom player name');
    expect(localize(50n)).toBe(50n);
  });
  it('works when preference storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(() => setLanguage('zh-CN')).not.toThrow();
    expect(translateText('Settings')).toBe('设置');
  });
  it('translates consent conditions and preserves the original external terms links', () => {
    setLanguage('zh-CN'); render(<PlayTermsText/>);
    expect(screen.getByText(/15 分钟内/)).toBeInTheDocument();
    expect(screen.getByText(/不是 Robux/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Uniswap 服务条款' })).toHaveAttribute('href', 'https://support.uniswap.org/hc/en-us/articles/30935100859661');
    expect(screen.getByRole('link', { name: '隐私政策' })).toHaveAttribute('href', 'https://support.uniswap.org/hc/en-us/articles/30934457771405');
  });
  it('translates chess descriptions while retaining square notation', () => {
    expect(describeMove({piece:'n',from:'g1',to:'f3'},'zh-CN')).toBe('马 G1 走至 F3');
    expect(describeMove({piece:'p',from:'e7',to:'e8',promotion:'q',isCheckmate:true},'zh-CN')).toBe('兵 E7 走至 E8，升变为后，将死');
    expect(describeMove({isKingsideCastle:true},'zh-CN')).toBe('王翼易位');
  });
});
