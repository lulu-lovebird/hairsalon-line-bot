import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // LIFF requires HTTPS in production; allow cross-origin for LINE WebApp
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'ALLOWALL' },
          { key: 'Content-Security-Policy', value: 'frame-ancestors *' },
        ],
      },
    ]
  },
}

export default nextConfig
