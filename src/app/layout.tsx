import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: '理髮店預約系統',
  description: '線上預約理髮服務',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh-TW">
      <body>{children}</body>
    </html>
  )
}
