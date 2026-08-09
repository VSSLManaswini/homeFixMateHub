type IconProps = {
  name: string
}

export function Icon({ name }: IconProps) {
  const common = {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }

  switch (name) {
    case 'home':
      return (
        <svg {...common}>
          <path d="M4 11.5 12 4l8 7.5" />
          <path d="M6.5 10.8V20h11V10.8" />
        </svg>
      )
    case 'sun':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      )
    case 'moon':
      return (
        <svg {...common}>
          <path d="M20 14.5A7.5 7.5 0 1 1 9.5 4 6 6 0 0 0 20 14.5z" />
        </svg>
      )
    case 'pipe':
      return (
        <svg {...common}>
          <path d="M4 10h8v4H4zM12 12h4M16 8v8M16 8h4M16 16h4" />
        </svg>
      )
    case 'bolt':
      return (
        <svg {...common}>
          <path d="M13 2 6 13h5l-1 9 7-11h-5l1-9z" />
        </svg>
      )
    case 'kitchen':
      return (
        <svg {...common}>
          <path d="M5 4h14v4H5zM7 8v12M17 8v12M5 20h14" />
        </svg>
      )
    case 'appliance':
      return (
        <svg {...common}>
          <rect x="5" y="3" width="14" height="18" rx="2" />
          <path d="M5 8h14M9 13h6" />
        </svg>
      )
    case 'sparkle':
      return (
        <svg {...common}>
          <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" />
        </svg>
      )
    case 'paint':
      return (
        <svg {...common}>
          <path d="M14 4 4 14l6 6 10-10-6-6z" />
          <path d="M10 20c0 1.5-1.5 2-3 2s-2-.8-2-2 1.5-2 3-2" />
        </svg>
      )
    case 'hammer':
      return (
        <svg {...common}>
          <path d="M14 5 19 10M10 9l5 5M5 19l6-6" />
          <path d="M13 4h7v4l-4 4" />
        </svg>
      )
    case 'shield':
      return (
        <svg {...common}>
          <path d="M12 3 5 6v5c0 4.5 3 7.8 7 9 4-1.2 7-4.5 7-9V6l-7-3z" />
        </svg>
      )
    case 'droplet':
      return (
        <svg {...common}>
          <path d="M12 3s6 6.2 6 10.2a6 6 0 0 1-12 0C6 9.2 12 3 12 3z" />
        </svg>
      )
    case 'flame':
      return (
        <svg {...common}>
          <path d="M12 3c2 3 5 4.5 5 9a5 5 0 0 1-10 0c0-2.5 1.5-4 3-5.5C11 7.5 11 9 12 10V3z" />
        </svg>
      )
    case 'wrench':
      return (
        <svg {...common}>
          <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 0 0 5.4-5.4L15 12l-1.3-1.3 1-4.4z" />
        </svg>
      )
    case 'leaf':
      return (
        <svg {...common}>
          <path d="M5 19c8 0 12-6 14-14-8 2-14 6-14 14z" />
          <path d="M9 15c2-2 4.5-3.5 8-4" />
        </svg>
      )
    case 'camera':
      return (
        <svg {...common}>
          <rect x="3" y="7" width="18" height="12" rx="2" />
          <circle cx="12" cy="13" r="3" />
          <path d="M8 7 9.5 5h5L16 7" />
        </svg>
      )
    case 'wifi':
      return (
        <svg {...common}>
          <path d="M5 12.5a9.5 9.5 0 0 1 14 0M8 15.5a5.5 5.5 0 0 1 8 0" />
          <circle cx="12" cy="19" r="1.2" fill="currentColor" stroke="none" />
        </svg>
      )
    case 'truck':
      return (
        <svg {...common}>
          <path d="M3 7h11v10H3zM14 10h4l3 3v4h-7" />
          <circle cx="7" cy="18" r="1.5" />
          <circle cx="17" cy="18" r="1.5" />
        </svg>
      )
    case 'shirt':
      return (
        <svg {...common}>
          <path d="M8 5 12 8l4-3 3 2-2 3v9H7V10L5 7l3-2z" />
        </svg>
      )
    case 'spa':
      return (
        <svg {...common}>
          <path d="M12 20c4-4 6-7.5 6-11a6 6 0 0 0-12 0c0 3.5 2 7 6 11z" />
          <path d="M12 9v4" />
        </svg>
      )
    case 'heart':
      return (
        <svg {...common}>
          <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2 4 4 0 0 1 7 2c0 5.6-7 10-7 10z" />
        </svg>
      )
    case 'book':
      return (
        <svg {...common}>
          <path d="M5 5.5A2.5 2.5 0 0 1 7.5 3H19v16H7.5A2.5 2.5 0 0 0 5 21.5z" />
          <path d="M5 5.5V21.5" />
        </svg>
      )
    default:
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="7" />
        </svg>
      )
  }
}
