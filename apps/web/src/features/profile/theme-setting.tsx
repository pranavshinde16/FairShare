import { Monitor, Moon, Sun } from 'lucide-react';
import { setTheme, THEMES, useTheme, type Theme } from '../../lib/theme';
import { cn } from '../../lib/utils';
import { segmentItem, segmentTrack } from '../../components/ui/segmented-control';

const OPTIONS: Record<Theme, { label: string; icon: typeof Sun }> = {
  system: { label: 'System', icon: Monitor },
  light: { label: 'Light', icon: Sun },
  dark: { label: 'Dark', icon: Moon },
};

/** System / Light / Dark, saved on this device. Native radios, as a segmented control (§4). */
export function ThemeSetting() {
  const theme = useTheme();
  return (
    <fieldset>
      <legend className="sr-only">Theme</legend>
      <div className={segmentTrack}>
        {THEMES.map((value) => {
          const { label, icon: Icon } = OPTIONS[value];
          return (
            <label
              key={value}
              className={cn(
                segmentItem(theme === value),
                'cursor-pointer has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-focus-ring',
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
