import { playMenuClick } from '@/lib/sounds';
import { ARENA_THEMES } from '@/lib/arenaThemes';
import { useArenaTheme } from '@/hooks/useArenaTheme';

interface ThemeSelectorProps {
  compact?: boolean;
}

export default function ThemeSelector({ compact = false }: ThemeSelectorProps) {
  const { themeId, themesEnabled, setThemeId } = useArenaTheme();

  if (!themesEnabled) return null;

  return (
    <div className={`theme-selector ${compact ? 'theme-selector-compact' : ''}`} aria-label="Theme selector">
      {ARENA_THEMES.map((theme) => (
        <button
          key={theme.id}
          type="button"
          className={`theme-choice ${themeId === theme.id ? 'is-active' : ''}`}
          onClick={() => {
            setThemeId(theme.id);
            playMenuClick();
          }}
          aria-pressed={themeId === theme.id}
        >
          <span className="theme-choice-swatches" aria-hidden="true">
            {theme.swatches.map((swatch) => (
              <span key={swatch} style={{ backgroundColor: swatch }} />
            ))}
          </span>
          <span className="theme-choice-label">{compact ? theme.shortLabel : theme.label.toUpperCase()}</span>
        </button>
      ))}
    </div>
  );
}
