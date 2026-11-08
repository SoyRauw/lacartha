import { LOGO_URL } from '../lib/assets'

export default function Logo({ className = '', style, alt = 'La Cartha by Valentina Castro' }) {
  return <img src={LOGO_URL} alt={alt} className={className} style={style} />
}
