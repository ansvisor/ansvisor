import { ImageResponse } from 'next/og';
import { readFile } from 'fs/promises';
import path from 'path';

export const runtime = 'nodejs';
export const alt = 'Ansvisor';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

async function loadLogoDataUrl() {
  const filePath = path.join(process.cwd(), 'public', 'logo_dark.svg');
  const buffer = await readFile(filePath);
  return `data:image/svg+xml;base64,${buffer.toString('base64')}`;
}

export default async function OpengraphImage() {
  const logoSrc = await loadLogoDataUrl();

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background:
          'radial-gradient(ellipse at top right, #312e81 0%, #1e1b4b 35%, #0b0a2b 70%, #050516 100%)',
        position: 'relative',
      }}
    >
      {/* Soft glow accent */}
      <div
        style={{
          position: 'absolute',
          top: -200,
          right: -200,
          width: 700,
          height: 700,
          borderRadius: '50%',
          background:
            'radial-gradient(circle, rgba(139, 92, 246, 0.4) 0%, rgba(139, 92, 246, 0) 70%)',
          display: 'flex',
        }}
      />

      <img src={logoSrc} alt="" width={360} height={360} style={{ width: 360, height: 360 }} />
    </div>,
    { ...size },
  );
}
