import { Icon } from './Icon'
import type { Theme } from '../hooks/useTheme'

type HeaderProps = {
  theme: Theme
  onToggleTheme: () => void
  onGetStarted: () => void
}

export function Header({ theme, onToggleTheme, onGetStarted }: HeaderProps) {
  return (
    <header className="site-header">
      <div className="inner">
        <a className="brand" href="#top" aria-label="HomeFix home">
          <span className="brand-mark">
            <Icon name="home" />
          </span>
          HomeFix
        </a>
        <div className="nav-actions">
          <button
            type="button"
            className="theme-toggle"
            onClick={onToggleTheme}
            aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
          >
            <Icon name={theme === 'light' ? 'moon' : 'sun'} />
          </button>
          <a className="btn btn-secondary" href="#categories">
            Browse services
          </a>
          <button type="button" className="btn btn-primary" onClick={onGetStarted}>
            Get started
          </button>
        </div>
      </div>
    </header>
  )
}
