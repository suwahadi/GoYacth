import type { ReactNode, SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function Stroke({ children, ...props }: IconProps & { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      {children}
    </svg>
  );
}

export const ArrowRightIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M4 12h15M13 6l6 6-6 6" />
  </Stroke>
);
export const ChevronLeftIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M15 5l-7 7 7 7" />
  </Stroke>
);
export const ChevronRightIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M9 5l7 7-7 7" />
  </Stroke>
);
export const ChevronDownIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M6 9l6 6 6-6" />
  </Stroke>
);
export const GlobeIcon = (p: IconProps) => (
  <Stroke {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3c2.6 2.6 3.9 5.6 3.9 9s-1.3 6.4-3.9 9c-2.6-2.6-3.9-5.6-3.9-9S9.4 5.6 12 3zM4.4 7.5h15.2M4.4 16.5h15.2" />
  </Stroke>
);
export const SearchIcon = (p: IconProps) => (
  <Stroke {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="M20.5 20.5L16 16" />
  </Stroke>
);
export const CalendarIcon = (p: IconProps) => (
  <Stroke strokeWidth="2" {...p}>
    <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
    <path d="M3.5 10h17M8 3v4M16 3v4M8 14h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01" />
  </Stroke>
);
export const MapPinIcon = (p: IconProps) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...p}>
    <path fillRule="evenodd" d="M12 2a7.5 7.5 0 0 0-7.5 7.5c0 5.1 5.4 10.6 6.9 12.1a.9.9 0 0 0 1.2 0c1.5-1.5 6.9-7 6.9-12.1A7.5 7.5 0 0 0 12 2zm0 10.2a2.8 2.8 0 1 1 0-5.6 2.8 2.8 0 0 1 0 5.6z" />
  </svg>
);
export const UsersIcon = (p: IconProps) => (
  <Stroke strokeWidth="2" {...p}>
    <circle cx="12" cy="8" r="3.5" />
    <path d="M5.5 20c.4-3.9 3-6 6.5-6s6.1 2.1 6.5 6M17.5 5.6a3 3 0 0 1 0 5M6.5 5.6a3 3 0 0 0 0 5M20 13.6c1.4.8 2.2 2.2 2.4 4M4 13.6c-1.4.8-2.2 2.2-2.4 4" />
  </Stroke>
);
export const UserIcon = (p: IconProps) => (
  <Stroke {...p}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4.5 20.5c.6-4 3.6-6.2 7.5-6.2s6.9 2.2 7.5 6.2" />
  </Stroke>
);
export const SunIcon = (p: IconProps) => (
  <Stroke {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6L7 7M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" />
  </Stroke>
);
export const MenuIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Stroke>
);
export const CompassIcon = (p: IconProps) => (
  <Stroke {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M15.5 8.5l-2 5-5 2 2-5z" />
  </Stroke>
);

const DiamondIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M7 4h10l4 5.5L12 20.5 3 9.5zM3 9.5h18M9.5 4L8 9.5l4 11 4-11L14.5 4" />
  </Stroke>
);
const ShieldIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M12 2.8l7.5 2.7v6c0 4.7-3 8-7.5 9.7-4.5-1.7-7.5-5-7.5-9.7v-6zM8.5 12l2.5 2.5 4.5-5" />
  </Stroke>
);
const HeadsetIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M4 14v-2a8 8 0 0 1 16 0v2M4 14a2 2 0 0 1 2-2h.5A1.5 1.5 0 0 1 8 13.5v3A1.5 1.5 0 0 1 6.5 18H6a2 2 0 0 1-2-2zM20 14a2 2 0 0 0-2-2h-.5a1.5 1.5 0 0 0-1.5 1.5v3a1.5 1.5 0 0 0 1.5 1.5h.5a2 2 0 0 0 2-2zM18 18c0 1.8-1.5 3-3.5 3H12" />
  </Stroke>
);
const StarIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M12 3l2.8 5.8 6.2.9-4.5 4.4 1.1 6.3-5.6-3-5.6 3 1.1-6.3L3 9.7l6.2-.9z" />
  </Stroke>
);

// Admins pick these names in the homepage section editor; an unknown name renders no icon.
const highlightIcons: Record<string, (p: IconProps) => ReactNode> = { diamond: DiamondIcon, shield: ShieldIcon, headset: HeadsetIcon, star: StarIcon, globe: GlobeIcon };

export function HighlightIcon({ name, ...props }: IconProps & { name?: string }) {
  const Icon = name ? highlightIcons[name] : undefined;
  return Icon ? <Icon {...props} /> : null;
}

export const YachtMark = (p: IconProps) => (
  <svg viewBox="0 0 54 30" fill="currentColor" aria-hidden="true" {...p}>
    <path d="M21.5 1h3.2l1 2.6 6.3.5 4.5 3.4-14.2-.5z" />
    <path d="M14.5 9.2l22.8.8 5 4.3-33.8-.8z" />
    <path d="M1.5 15.3l50.8 1.1c-2.4 3.6-6.3 5.5-11.7 5.8l-31.8.4c-3 0-5-1.4-6.2-4.2z" />
    <path d="M0 26.2c7.8 2 15 2.3 23.2 1.2 10.8-1.5 19.3-2.3 30.8-1.7-11.6-2.9-20.7-2.3-31.3-.7-8.1 1.2-14.8 2-22.7 1.2z" />
  </svg>
);
