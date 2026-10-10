import { useEffect, useState } from 'react';

/** 与 MDTBBS 论坛一致的 localStorage 键名，登录态无关（同域即可共享）。 */
const STORAGE_KEY = 'theme';

type Theme = 'light' | 'dark';

function readStoredTheme(): Theme | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'dark' || value === 'light' ? value : null;
  } catch {
    return null;
  }
}

function systemTheme(): Theme {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function currentTheme(): Theme {
  const attr = document.documentElement.getAttribute('data-theme');
  if (attr === 'dark' || attr === 'light') return attr;
  return readStoredTheme() ?? systemTheme();
}

interface ThemeToggleProps {
  /** 可访问名称，按当前语言传入；点击后含义为「切换到另一种主题」。 */
  label: string;
  className?: string;
}

/**
 * 深浅主题切换按钮。写入 data-theme 并同步 localStorage，与论坛行为一致：
 * 没有显式选择时跟随系统，显式选择后不再被系统设置覆盖。
 */
export function ThemeToggle({ label, className }: ThemeToggleProps) {
  const [theme, setTheme] = useState<Theme>(() => currentTheme());

  useEffect(() => {
    // 浏览器前进/后退恢复 bfcache 时重新对齐真实状态
    const sync = () => setTheme(currentTheme());
    window.addEventListener('pageshow', sync);
    return () => window.removeEventListener('pageshow', sync);
  }, []);

  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // 隐私模式下 localStorage 不可写：主题仅本次会话生效
    }
    setTheme(next);
  }

  return (
    <button
      type="button"
      className={className ? `theme-toggle ${className}` : 'theme-toggle'}
      onClick={toggle}
      aria-label={label}
      title={label}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        {theme === 'dark' ? (
          <circle cx="12" cy="12" r="4.4" />
        ) : (
          <path d="M20 13.4A8.4 8.4 0 1 1 10.6 4a6.9 6.9 0 0 0 9.4 9.4Z" />
        )}
      </svg>
    </button>
  );
}
