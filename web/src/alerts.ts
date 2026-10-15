// alerts.ts: pop-up alerts for new messages, using the browser's Notification feature.
//
// On the free plan there's no server to "push" alerts, so these only work while
// PakChat is open in a tab (even a tab in the background). The paid plan adds
// Firebase Cloud Messaging, which can alert you even when PakChat is closed.

export function alertsState(): 'on' | 'off' | 'blocked' | 'unsupported' {
  if (!('Notification' in window)) return 'unsupported'
  if (Notification.permission === 'granted') return 'on'
  if (Notification.permission === 'denied') return 'blocked'
  return 'off'
}

// The browser asks "Allow PakChat to show notifications?"
export function turnOnAlerts() {
  return Notification.requestPermission()
}

export function showAlert(title: string, body: string, tag: string, onClick: () => void) {
  if (alertsState() !== 'on') return
  // tag: a newer alert from the same chat replaces the older one.
  const alert = new Notification(title, { body, tag, icon: '/favicon.svg' })
  alert.onclick = () => {
    window.focus()
    onClick()
    alert.close()
  }
}
