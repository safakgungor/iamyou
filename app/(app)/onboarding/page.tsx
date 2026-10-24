/**
 * `app/onboarding/page.tsx` — consent & settings. (Req 2)
 *
 * The three profile choices the rest of the System keys off, plus a
 * placeholder digital-will control:
 *   - `family_history` — one of huntington | familial_alzheimers | als | none |
 *     prefer_not (Req 2.1).
 *   - `health_layer_opt_in` — boolean, defaults to `false` (Req 2.2).
 *   - `rtk_setting` — tell_me | doctor_only | record_only, shown as who hears
 *     about a change, defaults to `record_only` (Req 2.3, 2.4).
 *   - a disabled placeholder control for a future digital-will setting (Req 2.5).
 *
 * A server component for the page title; the form itself is the client
 * component `ConsentForm`, which prefills from the caller's profile and keeps
 * the Req 2 defaults for a user without one. Copy rules (Req 2.6, 2.7) live
 * with the options in `components/settings/consent.ts`.
 */

import type { Metadata } from 'next';
import ConsentForm from '@/components/settings/consent-form';

export const metadata: Metadata = { title: 'Consent & settings · iamyou' };

export default function OnboardingPage() {
  return <ConsentForm />;
}
