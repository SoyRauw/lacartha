import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

/**
 * Copia el texto de los encabezados de cada tabla a sus celdas como
 * `data-label`. El CSS móvil usa ese atributo para mostrar cada fila como
 * una tarjeta con etiquetas, sin scroll horizontal.
 */
export default function TableLabels() {
  const location = useLocation()

  useEffect(() => {
    let frame = 0

    const apply = () => {
      if (frame) return
      frame = window.requestAnimationFrame(() => {
        frame = 0
        document.querySelectorAll('table.table').forEach((table) => {
          const headers = Array.from(table.tHead?.rows?.[0]?.cells || []).map(
            (cell) => cell.textContent.trim(),
          )
          table.querySelectorAll('tbody tr').forEach((row) => {
            Array.from(row.cells).forEach((cell, index) => {
              if (cell.hasAttribute('data-label')) return
              cell.setAttribute('data-label', headers[index] || '')
            })
          })
        })
      })
    }

    apply()
    const observer = new MutationObserver(apply)
    observer.observe(document.body, { childList: true, subtree: true })

    return () => {
      observer.disconnect()
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [location.pathname])

  return null
}
