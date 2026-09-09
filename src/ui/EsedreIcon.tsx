import React from 'react';

export interface EsedreIconProps extends React.SVGProps<SVGSVGElement> {
  size?: number | string;
  className?: string;
  variant?: 'standard' | 'inverted';
  pillarColor?: string;
  figureColor?: string;
}

export const EsedreIcon: React.FC<EsedreIconProps> = ({
  size = 24,
  className = '',
  variant = 'standard',
  pillarColor,
  figureColor,
  ...props
}) => {
  const isInverted = variant === 'inverted';
  const defaultPillarColor = isInverted ? '#a855f7' : '#0284c7';
  const defaultFigureColor = isInverted ? '#0284c7' : '#a855f7';

  const resolvedPillarColor = pillarColor || defaultPillarColor;
  const resolvedFigureColor = figureColor || defaultFigureColor;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 48 48"
      width={size}
      height={size}
      fill="none"
      className={className}
      aria-hidden="true"
      {...props}
    >
      {/* Central Arch Vault connecting the 2 middle pillars */}
      <path
        d="M 14.5 40 L 14.5 16 C 14.5 5.5 33.5 5.5 33.5 16 L 33.5 40"
        stroke={resolvedPillarColor}
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />

      {/* 2 Outer Framing Pillars (Total 4 pillars) */}
      <rect x="3.5" y="16" width="4" height="24" rx="1.2" fill={resolvedPillarColor} />
      <rect x="40.5" y="16" width="4" height="24" rx="1.2" fill={resolvedPillarColor} />

      {/* Minimalist Woman Figure inside Central Arch (Well-spaced & visible) */}
      <g fill={resolvedFigureColor}>
        <circle cx="24" cy="20" r="2.8" />
        <path d="M 22.2 24.2 C 23 23.2 25 23.2 25.8 24.2 L 28.5 40 L 19.5 40 Z" />
      </g>

      {/* Clean Base Foundation */}
      <rect x="2" y="40" width="44" height="3.2" rx="1.2" fill={resolvedPillarColor} />
    </svg>
  );
};
