// AI Studio resync: source preserved.
import React, { useState } from 'react';
import { Building2 } from 'lucide-react';

interface ResilientImageProps {
  src: string;
  alt: string;
  className?: string;
  fallbackLabel?: string;
}

export const ResilientImage: React.FC<ResilientImageProps> = ({
  src,
  alt,
  className = 'w-full h-full object-cover',
  fallbackLabel
}) => {
  const [hasError, setHasError] = useState(false);

  if (hasError || !src) {
    return (
      <div
        className={`flex flex-col items-center justify-center bg-gradient-to-br from-[#0F2942] via-[#1B3A57] to-[#0B1D30] text-stone-200 p-6 text-center ${className}`}
        role="img"
        aria-label={alt}
      >
        <Building2 className="w-8 h-8 text-stone-300/80 mb-2 shrink-0" />
        <span className="text-xs font-medium tracking-wide text-stone-200/90 max-w-[24ch] balance-text">
          {fallbackLabel || alt}
        </span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => setHasError(true)}
      className={className}
      loading="lazy"
    />
  );
};
