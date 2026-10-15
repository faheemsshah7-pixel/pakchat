import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import LangProvider from './LangProvider.tsx'
import { applyTheme, savedTheme } from './theme'

// Put your saved look on before anything is drawn, so the page doesn't flash.
applyTheme(savedTheme(), false)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LangProvider>
      <App />
    </LangProvider>
  </StrictMode>,
)
