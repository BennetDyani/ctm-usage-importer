// Small inline icon set (1.75 stroke, 20px). Decorative: callers provide text labels.
import type { ReactNode } from 'react'

const Svg = ({ children, size = 20 }: { children: ReactNode; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
)

export const ReportIcon = () => <Svg><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></Svg>
export const UploadIcon = () => <Svg><path d="M12 15V3M7 8l5-5 5 5M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" /></Svg>
export const ContractIcon = () => <Svg><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6M8 13h8M8 17h5" /></Svg>
export const AskIcon = () => <Svg><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" /></Svg>
export const CheckIcon = ({ size = 18 }: { size?: number }) => <Svg size={size}><path d="M20 6 9 17l-5-5" /></Svg>
export const AlertIcon = ({ size = 18 }: { size?: number }) => <Svg size={size}><path d="M12 9v4M12 17h.01" /><circle cx="12" cy="12" r="9" /></Svg>
export const CloseIcon = () => <Svg><path d="M18 6 6 18M6 6l12 12" /></Svg>
export const MoonIcon = () => <Svg size={16}><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></Svg>
export const SunIcon = () => <Svg size={16}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></Svg>
export const DotIcon = () => <Svg size={18}><circle cx="12" cy="12" r="3" /></Svg>
