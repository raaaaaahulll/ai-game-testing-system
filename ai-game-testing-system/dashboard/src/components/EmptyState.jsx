import { IconEmpty, IconBug, IconGame } from './Icons'

const iconMap = {
  empty: IconEmpty,
  bug: IconBug,
  game: IconGame,
}

export default function EmptyState({ icon, iconName, imageSrc, title, description, action, compact }) {
  const IconComponent = iconName && iconMap[iconName] ? iconMap[iconName] : null
  const iconEl = icon != null ? icon : IconComponent ? <IconComponent className="w-16 h-16" /> : <IconEmpty className="w-16 h-16" />
  const visualEl = imageSrc ? (
    <img src={imageSrc} alt="" className="w-24 h-24 object-contain opacity-80" aria-hidden />
  ) : iconEl
  return (
    <div className={`flex flex-col items-center justify-center px-6 text-center ${compact ? 'py-6' : 'py-12'}`}>
      <div className={`mb-4 flex items-center justify-center ${imageSrc ? '' : 'w-16 h-16'}`}>{visualEl}</div>
      <p className="font-display text-lg font-semibold text-textPrimary">{title}</p>
      {description && <p className="text-sm text-textMuted mt-1 max-w-sm">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
