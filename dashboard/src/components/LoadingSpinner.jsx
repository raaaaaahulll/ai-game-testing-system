export default function LoadingSpinner({ size = 'md', label }) {
  const sizeClass = size === 'sm' ? 'w-6 h-6' : size === 'lg' ? 'w-12 h-12' : 'w-10 h-10'
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-8">
      <div className={`${sizeClass} border-2 border-accent/30 border-t-accent rounded-full animate-spin`} />
      {label && <p className="font-display text-accent text-sm">{label}</p>}
    </div>
  )
}
