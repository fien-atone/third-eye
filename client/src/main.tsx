import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App.tsx'
import { initTheme } from './theme.ts'
import { I18nProvider } from './i18n'
import { startVersionPoll } from './lib/version-poll'

initTheme()

const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } } })

// Boot the version-check poller before React renders. Module-scoped
// state in version-poll.ts guarantees exactly one timer regardless
// of StrictMode double-mount or HMR.
startVersionPoll(qc)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <I18nProvider>
        <App />
      </I18nProvider>
    </QueryClientProvider>
  </StrictMode>,
)
