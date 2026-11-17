'use client';

/**
 * Read the locale/theme/content shell. Must render inside `LandingProvider`
 * 
 */

import { useContext } from 'react';
import { ShellContext } from './LandingProvider';

export function useLanding() {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error('useLanding must be used inside LandingProvider');
  return ctx;
}
