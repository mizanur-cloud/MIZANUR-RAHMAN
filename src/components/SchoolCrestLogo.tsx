import React from 'react';
import { SCHOOL_LOGO_URL } from '../services/logoAsset';

export { SCHOOL_LOGO_URL };

interface SchoolCrestLogoProps {
  className?: string;
  bare?: boolean;
  alt?: string;
}

/**
 * Official school emblem for Icon Dreams School & College.
 * Uses the authentic institution crest image on white backing so it renders
 * crisply in both light and dark themes as well as print/export previews.
 */
export const SchoolCrestLogo: React.FC<SchoolCrestLogoProps> = ({
  className = 'w-9 h-9',
  bare = false,
  alt = 'Icon Dreams School & College Logo',
}) => {
  const framingClasses = bare
    ? 'object-contain'
    : 'object-contain bg-white rounded-lg p-[1.5px] ring-1 ring-stone-200/90 dark:ring-slate-700/80 shadow-2xs';

  return (
    <img
      src={SCHOOL_LOGO_URL}
      alt={alt}
      loading="eager"
      decoding="async"
      className={`${framingClasses} ${className}`}
    />
  );
};
