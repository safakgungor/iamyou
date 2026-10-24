'use client';

import { useEffect } from 'react';

/** Phone height in CSS pixels: an 844 px screen plus the 11 px bezel on each side. */
const DEVICE_HEIGHT = 866;

/**
 * Keeps the phone at true phone size (390 × 844) and scales it down to fit
 * short screens, so every laptop shows the same layout inside the device.
 */
export default function DeviceScale() {
  useEffect(() => {
    const set = () =>
      document.documentElement.style.setProperty(
        '--device-scale',
        String(Math.min(1, (window.innerHeight - 40) / DEVICE_HEIGHT)),
      );
    set();
    window.addEventListener('resize', set);
    return () => window.removeEventListener('resize', set);
  }, []);
  return null;
}
