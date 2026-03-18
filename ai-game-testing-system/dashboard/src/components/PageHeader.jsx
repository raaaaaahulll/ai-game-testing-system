export default function PageHeader({ title, description, icon }) {
  return (
    <header className="bg-white dark:bg-darkCard border-b border-gray-200 dark:border-darkBorder mb-8 bg-gradient-to-r from-transparent via-blue-50/10 to-transparent">
      <div className="max-w-7xl mx-auto px-6 py-6 font-display">
        <div className="flex items-center gap-3">
          {icon && <span className="text-accent">{icon}</span>}
          <div>
            <h1 className="font-display font-bold text-2xl text-textPrimary dark:text-gray-100 tracking-tight">
              {title}
            </h1>
            {description && (
              <p className="text-sm text-textMuted dark:text-gray-400 mt-1">{description}</p>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}
