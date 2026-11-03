import type { ReactNode, SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function Stroke({ children, ...props }: IconProps & { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      {children}
    </svg>
  );
}

// File-type marks for downloads: a page with its folded corner and the format drawn in stroke
// letters, after Tabler's file-type-* set (MIT).
const FileCorner = () => (
  <>
    <path d="M14 3v4a1 1 0 0 0 1 1h4" />
    <path d="M5 12V5a2 2 0 0 1 2-2h7l5 5v4" />
  </>
);
export const FilePdfIcon = (p: IconProps) => (
  <Stroke {...p}>
    <FileCorner />
    <path d="M5 18h1.5a1.5 1.5 0 0 0 0-3H5v6" />
    <path d="M17 18h2" />
    <path d="M20 15h-3v6" />
    <path d="M11 15v6h1a2 2 0 0 0 2-2v-2a2 2 0 0 0-2-2z" />
  </Stroke>
);
export const FileCsvIcon = (p: IconProps) => (
  <Stroke {...p}>
    <FileCorner />
    <path d="M7 16.5a1.5 1.5 0 0 0-3 0v3a1.5 1.5 0 0 0 3 0" />
    <path d="M10 20.25c0 .414.336.75.75.75H12a1 1 0 0 0 1-1v-1a1 1 0 0 0-1-1h-1a1 1 0 0 1-1-1v-1a1 1 0 0 1 1-1h1.25a.75.75 0 0 1 .75.75" />
    <path d="M16 15l2 6 2-6" />
  </Stroke>
);
export const FileXlsIcon = (p: IconProps) => (
  <Stroke {...p}>
    <FileCorner />
    <path d="M4 15l4 6" />
    <path d="M4 21l4-6" />
    <path d="M17 20.25c0 .414.336.75.75.75H19a1 1 0 0 0 1-1v-1a1 1 0 0 0-1-1h-1a1 1 0 0 1-1-1v-1a1 1 0 0 1 1-1h1.25a.75.75 0 0 1 .75.75" />
    <path d="M11 15v6h3" />
  </Stroke>
);

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
export const CalendarWeekIcon = (p: IconProps) => (
  <Stroke {...p}>
    <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
    <path d="M3.5 10h17M8 3v4M16 3v4M7 14.5h10" />
  </Stroke>
);
export const BanknoteIcon = (p: IconProps) => (
  <Stroke {...p}>
    <rect x="2.5" y="6" width="19" height="12" rx="2" />
    <circle cx="12" cy="12" r="2.5" />
    <path d="M6 12h.01M18 12h.01" />
  </Stroke>
);
export const HourglassIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M7 3h10M7 21h10" />
    <path d="M8 3v2.5a4 4 0 0 0 1.7 3.3l2.3 1.7 2.3-1.7A4 4 0 0 0 16 5.5V3M8 21v-2.5a4 4 0 0 1 1.7-3.3l2.3-1.7 2.3 1.7a4 4 0 0 1 1.7 3.3V21" />
  </Stroke>
);
export const AlertIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M10.3 4.2 2.6 17.5a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z" />
    <path d="M12 9.5v4M12 17h.01" />
  </Stroke>
);
export const InboxIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M3.5 13.5V18A1.5 1.5 0 0 0 5 19.5h14a1.5 1.5 0 0 0 1.5-1.5v-4.5l-2.6-7.8a1.5 1.5 0 0 0-1.4-1.2h-9a1.5 1.5 0 0 0-1.4 1.2z" />
    <path d="M3.5 13.5h5l1.2 2.5h4.6l1.2-2.5h5" />
  </Stroke>
);
export const RefundIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
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
export const StarIcon = (p: IconProps) => (
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

// Fine-line nautical set for specs, facilities and contact rows.
export const AnchorIcon = (p: IconProps) => (
  <Stroke {...p}>
    <circle cx="12" cy="5" r="2.5" />
    <path d="M12 7.5V21M8 11h8M4 13.5c0 4.2 3.6 7.5 8 7.5s8-3.3 8-7.5M4 13.5L2.5 16M4 13.5L6.5 15M20 13.5l1.5 2.5M20 13.5L17.5 15" />
  </Stroke>
);
export const HelmIcon = (p: IconProps) => (
  <Stroke {...p}>
    <circle cx="12" cy="12" r="7.5" />
    <circle cx="12" cy="12" r="2.2" />
    <path d="M12 1.8v8M12 14.2v8M1.8 12h8M14.2 12h8M6.7 6.7l3.75 3.75M13.55 13.55l3.75 3.75M6.7 17.3l3.75-3.75M13.55 10.45l3.75-3.75" />
  </Stroke>
);
export const SailboatIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M12 3v12.5M12 3.5l7 12h-7zM9.5 7.5L5 15.5h4.5zM3 18h18l-2 3H5z" />
  </Stroke>
);
export const CrownIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M3.5 8l4.2 3.6L12 5l4.3 6.6L20.5 8l-1.8 10H5.3zM5.3 21h13.4" />
  </Stroke>
);
export const RulerIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M3 16.5L16.5 3 21 7.5 7.5 21zM7 12.5l2 2M10 9.5l2.5 2.5M13 6.5l2 2" />
  </Stroke>
);
export const BeamIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M3 5v14M21 5v14M6.5 12h11M9.5 9l-3 3 3 3M14.5 9l3 3-3 3" />
  </Stroke>
);
export const BedIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M3 6v13M3 16h18M21 19v-5a2.5 2.5 0 0 0-2.5-2.5H3M6 11.5V10a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 12 10v1.5" />
  </Stroke>
);
export const BathIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M3 12h18v2.5a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5zM6 19.5L5 21M18 19.5l1 1.5M6 12V6a2 2 0 0 1 2-2h.5a2 2 0 0 1 2 2" />
  </Stroke>
);
export const GaugeIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M4.2 18a9 9 0 1 1 15.6 0M13 13.3l3.5-4.3M12 5v1.5M5 12h1.5M17.5 12H19" />
    <circle cx="12" cy="14.5" r="1.6" />
  </Stroke>
);
export const ClockIcon = (p: IconProps) => (
  <Stroke {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7v5l3.2 2" />
  </Stroke>
);
export const MoonIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.8 6.8 0 0 0 10.5 10.5z" />
  </Stroke>
);
export const RouteIcon = (p: IconProps) => (
  <Stroke {...p}>
    <circle cx="6" cy="18.5" r="2.2" />
    <circle cx="18" cy="5.5" r="2.2" />
    <path d="M8.2 18.5h7.3a3 3 0 0 0 0-6.5h-7a3 3 0 0 1 0-6.5h7.3" />
  </Stroke>
);
export const TagIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M3.5 12.5V5A1.5 1.5 0 0 1 5 3.5h7.5l8 8a1.5 1.5 0 0 1 0 2.1l-7 7a1.5 1.5 0 0 1-2.1 0z" />
    <circle cx="8" cy="8" r="1.4" />
  </Stroke>
);
export const SealCheckIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M12 2.8l2.4 1.7 2.9-.2 1 2.8 2.4 1.7-.9 2.8.9 2.8-2.4 1.7-1 2.8-2.9-.2-2.4 1.7-2.4-1.7-2.9.2-1-2.8-2.4-1.7.9-2.8-.9-2.8 2.4-1.7 1-2.8 2.9.2zM8.7 12.2l2.2 2.2 4.4-4.8" />
  </Stroke>
);
export const CheckIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M5 12.5l4.5 4.5L19 7" />
  </Stroke>
);
export const CloseIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Stroke>
);
export const CardIcon = (p: IconProps) => (
  <Stroke {...p}>
    <rect x="2.5" y="5" width="19" height="14" rx="2" />
    <path d="M2.5 9.5h19M6 15h4" />
  </Stroke>
);
export const MailIcon = (p: IconProps) => (
  <Stroke {...p}>
    <rect x="3" y="5.5" width="18" height="13" rx="2" />
    <path d="M3.5 7l8.5 6 8.5-6" />
  </Stroke>
);
export const PhoneIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M6.6 3.5h2.3l1.6 4.4-2 1.6a12.5 12.5 0 0 0 5.9 5.9l1.6-2 4.4 1.6v2.3a2.3 2.3 0 0 1-2.5 2.3C10.7 19.1 4.9 13.3 4.3 6a2.3 2.3 0 0 1 2.3-2.5z" />
  </Stroke>
);
// The WhatsApp mark (speech bubble with handset) drawn in the same stroke as the other contact
// icons, so the footer row reads as one set. Outline after Tabler's brand-whatsapp (MIT).
export const WhatsAppIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M3 21l1.65-3.8a9 9 0 1 1 3.4 2.9L3 21" />
    <path d="M9 10a.5.5 0 0 0 1 0V9a.5.5 0 0 0-1 0v1a5 5 0 0 0 5 5h1a.5.5 0 0 0 0-1h-1a.5.5 0 0 0 0 1" />
  </Stroke>
);

const SnowflakeIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M12 2.5v19M3.8 7.2l16.4 9.6M20.2 7.2L3.8 16.8M12 6L9.8 4M12 6l2.2-2M12 18l-2.2 2M12 18l2.2 2M6.8 10l-3-.8M6.8 10L6 7M17.2 14l3 .8M17.2 14l.8 3M17.2 10l3-.8M17.2 10l.8-3M6.8 14l-3 .8M6.8 14L6 17" />
  </Stroke>
);
const WifiIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M2.5 9.5a14 14 0 0 1 19 0M6 13.2a9 9 0 0 1 12 0M9.4 16.7a4 4 0 0 1 5.2 0M12 19.7h.01" />
  </Stroke>
);
const SpeakerIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M4 9.5v5h3.5l5 4.5V5l-5 4.5zM15.8 9a4.2 4.2 0 0 1 0 6M18.4 6.5a8 8 0 0 1 0 11" />
  </Stroke>
);
const ShowerIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M4 21V6.5a3 3 0 0 1 6 0V8M6.8 11a3.2 3.2 0 0 1 6.4 0zM8 14.5v1M10 14.5v1M12 14.5v1M7.5 18v1M10 18v1M12.5 18v1" />
  </Stroke>
);
const SnorkelIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M3.5 9.5h13A1.5 1.5 0 0 1 18 11v3a3 3 0 0 1-3 3h-1.7a2.5 2.5 0 0 1-2.1-1.1l-.4-.6a1.6 1.6 0 0 0-2.6 0l-.4.6A2.5 2.5 0 0 1 5.7 17H5a3 3 0 0 1-3-3v-3a1.5 1.5 0 0 1 1.5-1.5zM21 4v13a3.5 3.5 0 0 1-3.5 3.5H15" />
  </Stroke>
);
const PaddleIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M15 9L6.5 17.5M15.2 4.6a2.8 2.8 0 0 1 4 0l.2.2a2.8 2.8 0 0 1 0 4L17 11.2a2 2 0 0 1-2.8 0l-1.4-1.4a2 2 0 0 1 0-2.8zM4.2 15.2l4.6 4.6" />
  </Stroke>
);
const ForkKnifeIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M7 3v18M4.5 3v5a2.5 2.5 0 0 0 5 0V3M17 21v-7M17 3c-2.2 1-3.2 3.6-3.2 7.2 0 2.2 1.2 3.8 3.2 3.8z" />
  </Stroke>
);
const GrillIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M4 9.5h16a8 8 0 0 1-16 0zM8.2 16L6 21M15.8 16l2.2 5M12 17.5V21M9 6.5c0-1.4 1.2-1.6 1.2-3M14 6.5c0-1.4 1.2-1.6 1.2-3" />
  </Stroke>
);
const SunbedIcon = (p: IconProps) => (
  <Stroke {...p}>
    <circle cx="17.5" cy="6" r="2.5" />
    <path d="M3.5 10l5 6.5H21M7 16.5L5.5 20M18.5 16.5L20 20" />
  </Stroke>
);
const LifebuoyIcon = (p: IconProps) => (
  <Stroke {...p}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="3.8" />
    <path d="M5.6 5.6l3.7 3.7M14.7 14.7l3.7 3.7M18.4 5.6l-3.7 3.7M9.3 14.7l-3.7 3.7" />
  </Stroke>
);
const WavesIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M2.5 7c2 0 2.4-1.6 4.7-1.6S9.7 7 12 7s2.5-1.6 4.8-1.6S19.3 7 21.5 7M2.5 12.5c2 0 2.4-1.6 4.7-1.6s2.5 1.6 4.8 1.6 2.5-1.6 4.8-1.6 2.5 1.6 4.7 1.6M2.5 18c2 0 2.4-1.6 4.7-1.6S9.7 18 12 18s2.5-1.6 4.8-1.6S19.3 18 21.5 18" />
  </Stroke>
);

const facilityIcons: Record<string, (p: IconProps) => ReactNode> = {
  "air-conditioning": SnowflakeIcon,
  wifi: WifiIcon,
  "sound-system": SpeakerIcon,
  shower: ShowerIcon,
  snorkeling: SnorkelIcon,
  paddleboard: PaddleIcon,
  kitchen: ForkKnifeIcon,
  bbq: GrillIcon,
  sundeck: SunbedIcon,
  "life-jackets": LifebuoyIcon,
  cabins: BedIcon,
  "jet-ski": WavesIcon,
};

// Facilities are created in the admin panel, so a name outside this set still gets a mark.
export function FacilityIcon({ name, ...props }: IconProps & { name?: string }) {
  const Icon = (name && facilityIcons[name]) || AnchorIcon;
  return <Icon {...props} />;
}

export const YachtMark = (p: IconProps) => (
  <svg viewBox="0 0 54 30" fill="currentColor" aria-hidden="true" {...p}>
    <path d="M21.5 1h3.2l1 2.6 6.3.5 4.5 3.4-14.2-.5z" />
    <path d="M14.5 9.2l22.8.8 5 4.3-33.8-.8z" />
    <path d="M1.5 15.3l50.8 1.1c-2.4 3.6-6.3 5.5-11.7 5.8l-31.8.4c-3 0-5-1.4-6.2-4.2z" />
    <path d="M0 26.2c7.8 2 15 2.3 23.2 1.2 10.8-1.5 19.3-2.3 30.8-1.7-11.6-2.9-20.7-2.3-31.3-.7-8.1 1.2-14.8 2-22.7 1.2z" />
  </svg>
);
