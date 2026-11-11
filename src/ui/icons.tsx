import type { ReactNode } from 'react';

export type IconName =
  | 'uploads'
  | 'audio'
  | 'text'
  | 'captions'
  | 'sound'
  | 'effects'
  | 'transitions'
  | 'filters'
  | 'adjust'
  | 'stickers'
  | 'more'
  | 'screen'
  | 'window'
  | 'tab'
  | 'camera'
  | 'mic'
  | 'pause'
  | 'play'
  | 'stop'
  | 'crop';

export function SvgIcon({ name, size = 18 }: { name: IconName; size?: number }): ReactNode {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.85,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };

  switch (name) {
    case 'uploads':
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="16" rx="2.5" />
          <circle cx="8.5" cy="9.5" r="1.5" />
          <path d="M21 15l-4.5-4.5L7 20" />
        </svg>
      );
    case 'audio':
      return (
        <svg {...common}>
          <path d="M9 18V5l12-2v13" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="18" cy="16" r="3" />
        </svg>
      );
    case 'text':
      return (
        <svg {...common}>
          <path d="M4 7V4h16v3" />
          <path d="M9 20h6" />
          <path d="M12 4v16" />
        </svg>
      );
    case 'captions':
      return (
        <svg {...common}>
          <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
          <path d="M7 15h4" />
          <path d="M13 15h4" />
          <path d="M7 11h6" />
          <path d="M15 11h2" />
        </svg>
      );
    case 'sound':
      return (
        <svg {...common}>
          <path d="M2 12h2" />
          <path d="M6 8v8" />
          <path d="M10 5v14" />
          <path d="M14 9v6" />
          <path d="M18 7v10" />
          <path d="M22 12h-2" />
        </svg>
      );
    case 'effects':
      return (
        <svg {...common}>
          <path d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9L12 3z" />
          <path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15z" />
        </svg>
      );
    case 'transitions':
      return (
        <svg {...common}>
          <rect x="3" y="5" width="8" height="14" rx="1.5" />
          <rect x="13" y="5" width="8" height="14" rx="1.5" />
          <path d="M9 12h6" />
        </svg>
      );
    case 'filters':
      return (
        <svg {...common}>
          <circle cx="9" cy="10" r="5" />
          <circle cx="15" cy="10" r="5" />
          <circle cx="12" cy="15" r="5" />
        </svg>
      );
    case 'adjust':
      return (
        <svg {...common}>
          <line x1="4" y1="6" x2="20" y2="6" />
          <line x1="4" y1="12" x2="20" y2="12" />
          <line x1="4" y1="18" x2="20" y2="18" />
          <circle cx="9" cy="6" r="2" />
          <circle cx="15" cy="12" r="2" />
          <circle cx="11" cy="18" r="2" />
        </svg>
      );
    case 'stickers':
      return (
        <svg {...common}>
          <path d="M12 2l2.9 6.1L21.5 9l-4.8 4.6 1.2 6.5L12 17l-5.9 3.1 1.2-6.5L2.5 9l6.6-.9L12 2z" />
        </svg>
      );
    case 'more':
      return (
        <svg {...common}>
          <circle cx="5" cy="12" r="1.6" />
          <circle cx="12" cy="12" r="1.6" />
          <circle cx="19" cy="12" r="1.6" />
        </svg>
      );
    case 'screen':
      return (
        <svg {...common}>
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <path d="M8 21h8" />
          <path d="M12 17v4" />
        </svg>
      );
    case 'window':
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <line x1="3" y1="9" x2="21" y2="9" />
          <circle cx="6.5" cy="6.5" r="0.8" />
          <circle cx="9.5" cy="6.5" r="0.8" />
        </svg>
      );
    case 'tab':
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M3 9h18" />
          <path d="M9 4v5" />
        </svg>
      );
    case 'camera':
      return (
        <svg {...common}>
          <rect x="2.5" y="6" width="13.5" height="12" rx="2" />
          <path d="M16 10.5l5-3v9l-5-3v-3z" />
        </svg>
      );
    case 'mic':
      return (
        <svg {...common}>
          <rect x="9" y="2.5" width="6" height="11" rx="3" />
          <path d="M5 10.5a7 7 0 0 0 14 0" />
          <line x1="12" y1="17.5" x2="12" y2="21.5" />
          <line x1="8" y1="21.5" x2="16" y2="21.5" />
        </svg>
      );
    case 'pause':
      return (
        <svg {...common}>
          <rect x="6" y="4" width="4" height="16" rx="1" />
          <rect x="14" y="4" width="4" height="16" rx="1" />
        </svg>
      );
    case 'play':
      return (
        <svg {...common}>
          <polygon points="6 4 20 12 6 20 6 4" />
        </svg>
      );
    case 'stop':
      return (
        <svg {...common}>
          <rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor" />
        </svg>
      );
    case 'crop':
      return (
        <svg {...common}>
          <rect x="4" y="4" width="16" height="16" rx="1.5" />
          <path d="M4 4h8v8" />
          <path d="M12 4h8v8" />
          <path d="M4 12h8v8" />
          <path d="M12 12h8v8" />
        </svg>
      );
  }
}
