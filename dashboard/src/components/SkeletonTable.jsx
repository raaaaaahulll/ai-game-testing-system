export default function SkeletonTable({ rows = 5, cols = 6 }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-gray-200 dark:border-gray-700">
            {Array.from({ length: cols }).map((_, i) => (
              <th key={i} className="p-3">
                <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded animate-pulse w-16" />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, ri) => (
            <tr key={ri} className="border-b border-gray-100 dark:border-gray-800">
              {Array.from({ length: cols }).map((_, ci) => (
                <td key={ci} className="p-3">
                  <div className="h-4 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" style={{ width: ci === 0 ? '80%' : ci === cols - 1 ? '60%' : '90%' }} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
