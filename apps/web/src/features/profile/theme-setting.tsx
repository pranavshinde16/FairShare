import { Monitor, Moon, Sun } from 'lucide-react';
import { setTheme, THEMES, useTheme, type Theme } from '../../lib/theme';
import { cn } from '../../lib/utils';

const OPTIONS: Record<Theme, { label: string; icon: typeof Sun }> = {
  system: { label: 'System', icon: Monitor },
  light: { label: 'Light', icon: Sun },
  dark: { label: 'Dark', icon: Moon },
};

/** System / Light / Dark, saved on this device. Native radios, styled as a segmented control. */
export function ThemeSetting() {
  const theme = useTheme();
  return (
    <fieldset>
      <legend className="sr-only">Theme</legend>
      <div className="grid grid-cols-3 gap-2">
        {THEMES.map((value) => {
          const { label, icon: Icon } = OPTIONS[value];
          return (
            <label
              key={value}
              className={cn(
                'flex h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border text-sm font-medium transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
                theme === value
                  ? 'border-primary bg-accent text-accent-foreground'
                  : 'hover:bg-muted',
              )}
            >
              <input
                type="radio"
                name="theme"
                value={value}
                checked={theme === value}
                onChange={() => setTheme(value)}
                className="sr-only"
              />
              <Icon aria-hidden className="size-4" />
              {label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
