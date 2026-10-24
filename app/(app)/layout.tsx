import Link from 'next/link';
import QRCode from 'qrcode';
import './device.css';

const APP_URL = 'https://www.iamyou.si/app';

/**
 * Every app screen lives inside a phone. On a desktop the screens render in a
 * device frame (status bar, Dynamic Island, home indicator) with a QR code to
 * open the app on a real phone; on a phone the frame disappears and the app is
 * full-screen. Pages scroll inside the device screen, which is also the
 * container for container queries and for any fixed-position element.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const qr = await QRCode.toString(APP_URL, {
    type: 'svg',
    margin: 0,
    color: { dark: '#18212e', light: '#ffffff00' },
  });

  return (
    <div className="device-stage">
      <Link href="/" className="device-back label">
        ← iamyou.si
      </Link>

      <aside className="device-aside glass" aria-label="Open the app on your phone">
        <span className="label text-cyan-ink">Made for your phone</span>
        <div className="device-qr" aria-hidden="true" dangerouslySetInnerHTML={{ __html: qr }} />
        <p>Scan to open iamyou on your phone, or try it right here.</p>
        <span className="label">iamyou.si/app</span>
      </aside>

      <div className="device">
        <div className="device-screen @container">
          <StatusBar />
          <div className="device-content">{children}</div>
          <span className="device-home" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}

function StatusBar() {
  return (
    <div className="device-statusbar" aria-hidden="true">
      <span className="device-time">9:41</span>
      <span className="device-island" />
      <span className="device-icons">
        <svg width="18" height="12" viewBox="0 0 18 12" fill="currentColor">
          <rect x="0" y="8" width="3" height="4" rx="1" />
          <rect x="5" y="5.5" width="3" height="6.5" rx="1" />
          <rect x="10" y="3" width="3" height="9" rx="1" />
          <rect x="15" y="0" width="3" height="12" rx="1" />
        </svg>
        <svg width="16" height="12" viewBox="0 0 16 12" fill="currentColor">
          <path d="M8 2.2c2.4 0 4.6.9 6.3 2.5l1.2-1.3A10.6 10.6 0 0 0 8 .4 10.6 10.6 0 0 0 .5 3.4l1.2 1.3A8.9 8.9 0 0 1 8 2.2Zm0 3.6c1.4 0 2.7.5 3.7 1.4l1.2-1.3A7.2 7.2 0 0 0 8 4a7.2 7.2 0 0 0-4.9 1.9l1.2 1.3c1-.9 2.3-1.4 3.7-1.4Zm0 3.5c-.5 0-1 .2-1.4.5L8 11.6l1.4-1.8c-.4-.3-.9-.5-1.4-.5Z" />
        </svg>
        <svg width="27" height="13" viewBox="0 0 27 13" fill="none">
          <rect x="0.5" y="0.5" width="23" height="12" rx="3.5" stroke="currentColor" opacity="0.4" />
          <rect x="2" y="2" width="18" height="9" rx="2" fill="currentColor" />
          <path d="M25 4.5v4c.8-.3 1.5-1.1 1.5-2s-.7-1.7-1.5-2Z" fill="currentColor" opacity="0.4" />
        </svg>
      </span>
    </div>
  );
}
