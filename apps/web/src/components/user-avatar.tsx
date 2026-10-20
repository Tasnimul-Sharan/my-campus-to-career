'use client';

import { useState } from 'react';
import type { User } from '@/lib/api';
import styles from './user-avatar.module.css';

export function UserAvatar({ user, size = 'medium' }: { user: Pick<User, 'name' | 'profilePictureUrl'>; size?: 'small' | 'medium' | 'large' }) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const source = user.profilePictureUrl || '';
  const showImage = source.startsWith('/api/v1/profile/picture/') && source !== failedSource;
  const initials = user.name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word.charAt(0)).join('').toUpperCase() || '?';
  return <span className={`${styles.avatar} ${styles[size]}`}>
    {showImage ? <img src={source} alt={`${user.name}'s profile picture`} width={size === 'large' ? 112 : size === 'small' ? 33 : 37} height={size === 'large' ? 112 : size === 'small' ? 33 : 37} decoding="async" onError={() => setFailedSource(source)} /> : <span role="img" aria-label={`${user.name}'s initials`}>{initials}</span>}
  </span>;
}
