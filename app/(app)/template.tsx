import { ViewTransition } from 'react';

/**
 * Re-mounts on every navigation, so each screen gets one shared entrance: the
 * old screen fades out, the new one rises in. The tab bar and status bar live
 * in the layout and stay put. Browsers without view transitions just swap.
 */
export default function AppTemplate({ children }: { children: React.ReactNode }) {
  return (
    <ViewTransition enter="screen-in" exit="screen-out" default="none">
      {children}
    </ViewTransition>
  );
}
