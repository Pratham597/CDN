import './globals.css'

export const metadata = {
  title: 'CDN Trace Dashboard',
  description: 'Real-time CDN request tracing visualization',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
