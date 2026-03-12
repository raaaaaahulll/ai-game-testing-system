export default function SkeletonBlock({ className = '', lines = 1 }) {
  return (
    <div className={className}>
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="h-4 bg-gray-200 rounded animate-pulse mb-2 last:mb-0" />
      ))}
    </div>
  )
}
