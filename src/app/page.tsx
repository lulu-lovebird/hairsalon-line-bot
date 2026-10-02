export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-between p-8 bg-gray-50">
      <div />
      <div className="text-center">
        <h1 className="text-3xl font-bold mb-4 text-gray-900">✂️ 理髮店預約系統</h1>
        <p className="text-gray-600">請透過 LINE 官方帳號進行線上預約與時段查詢</p>
        <p className="text-sm text-gray-400 mt-2">系統版本 v0.1.0</p>
      </div>
      <footer className="text-center text-xs text-gray-400">
        Developed with ❤️ by Bean, Bird & Badminton Tech Consulting
      </footer>
    </main>
  )
}
