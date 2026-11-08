import { Construction } from 'lucide-react'
import { PageHeader } from '../../components/ui'

export default function ComingSoon({ title, subtitle }) {
  return (
    <>
      <PageHeader title={title} subtitle={subtitle} />
      <div className="card">
        <div className="empty">
          <Construction size={34} style={{ color: 'var(--orange)', marginBottom: 10 }} />
          <p style={{ fontWeight: 700, color: 'var(--text)' }}>En construcción</p>
          <p>Esta pantalla está en la siguiente tanda de trabajo.</p>
        </div>
      </div>
    </>
  )
}
