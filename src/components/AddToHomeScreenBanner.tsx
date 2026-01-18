import { useEffect, useMemo, useState } from 'react'

import { Button } from './ui/button'
import { Card, CardContent } from './ui/card'

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function isStandalone() {
  const mql = window.matchMedia?.('(display-mode: standalone)')
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone
  return Boolean(mql?.matches || iosStandalone)
}

function isIos() {
  const ua = navigator.userAgent || ''
  return /iphone|ipad|ipod/i.test(ua)
}

export function AddToHomeScreenBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (isStandalone()) return
    try {
      const v = localStorage.getItem('a2hsDismissed-v1')
      if (v === '1') setDismissed(true)
    } catch {}
  }, [])

  useEffect(() => {
    if (isStandalone()) return
    function onBeforeInstallPrompt(e: Event) {
      e.preventDefault?.()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
  }, [])

  const mode = useMemo(() => {
    if (dismissed) return 'hidden'
    if (isStandalone()) return 'hidden'
    if (deferredPrompt) return 'install'
    if (isIos()) return 'ios'
    return 'hidden'
  }, [deferredPrompt, dismissed])

  if (mode === 'hidden') return null

  function hide() {
    setDismissed(true)
    try {
      localStorage.setItem('a2hsDismissed-v1', '1')
    } catch {}
  }

  async function install() {
    if (!deferredPrompt) return
    await deferredPrompt.prompt()
    try {
      await deferredPrompt.userChoice
    } finally {
      setDeferredPrompt(null)
      hide()
    }
  }

  return (
    <Card className="border-slate-200 bg-white">
      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="text-sm font-semibold">Adicionar na tela inicial</div>
          {mode === 'install' ? (
            <div className="text-xs text-slate-600">
              Instale o app para abrir mais rápido e ter um ícone no celular.
            </div>
          ) : (
            <div className="text-xs text-slate-600">
              No iPhone: abra o menu Compartilhar e toque em Adicionar à Tela de Início.
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {mode === 'install' && (
            <Button type="button" size="sm" onClick={() => void install()}>
              Adicionar
            </Button>
          )}
          <Button type="button" size="sm" variant="secondary" onClick={hide}>
            Agora não
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

