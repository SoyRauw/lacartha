import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'

export function useOnline() {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine)

  useEffect(() => {
    const onOnline = () => setOnline(true)
    const onOffline = () => setOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  return online
}

export function usePendingCount() {
  return (
    useLiveQuery(async () => {
      const [sales, cash] = await Promise.all([
        db.pending_sales.where('sync_status').anyOf('pending', 'error').count(),
        db.cash_sessions.where('sync_status').equals('pending').count(),
      ])
      return { sales, cash, total: sales + cash }
    }, []) || { sales: 0, cash: 0, total: 0 }
  )
}
