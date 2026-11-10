import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useOnline } from './useOnline'
import { playNewOrderSound, showOrderNotification } from '../lib/notify'

function newChannelName(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`
}

export function useNewOrdersCount({ onNew } = {}) {
  const online = useOnline()
  const [count, setCount] = useState(0)
  const onNewRef = useRef(onNew)

  useEffect(() => {
    onNewRef.current = onNew
  }, [onNew])

  const refresh = useCallback(async () => {
    if (!online) return
    const { count: total, error } = await supabase
      .from('public_orders')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'nuevo')
    if (!error) setCount(total || 0)
  }, [online])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    if (!online) return undefined

    const channel = supabase
      .channel(newChannelName('orders-alerts'))
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'public_orders' },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setCount((prev) => prev + 1)
            playNewOrderSound()
            showOrderNotification(payload.new)
            onNewRef.current?.(payload.new)
          } else {
            refresh()
          }
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [online, refresh])

  return { count, refresh }
}

export function useOrdersBoard() {
  const online = useOnline()
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const timerRef = useRef(null)

  const load = useCallback(async () => {
    setError('')
    if (!online) {
      setLoading(false)
      return
    }

    const { data, error: loadError } = await supabase
      .from('public_orders')
      .select('*, public_order_items(*, public_order_item_options(*))')
      .order('created_at', { ascending: false })
      .limit(200)

    if (loadError) {
      setError(loadError.message || 'No se pudieron cargar las comandas')
    } else {
      setOrders(data || [])
    }
    setLoading(false)
  }, [online])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!online) return undefined

    const channel = supabase
      .channel(newChannelName('orders-board'))
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'public_orders' },
        () => {
          if (timerRef.current) window.clearTimeout(timerRef.current)
          timerRef.current = window.setTimeout(() => load(), 250)
        },
      )
      .subscribe()

    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
      supabase.removeChannel(channel)
    }
  }, [online, load])

  return { orders, loading, error, refresh: load }
}
