import { useState, useEffect } from 'react'
import { API_BASE } from '../api'

export default function SystemHealth() {
    const [info, setInfo] = useState({ cpu_percent: 0, ram_percent: 0, backend_status: 'loading', uptime: 0 })

    useEffect(() => {
        async function fetchInfo() {
            try {
                const res = await fetch(`${API_BASE}/system/info`)
                if (res.ok) {
                    const data = await res.json()
                    setInfo(data)
                }
            } catch (e) {
                setInfo((prev) => ({ ...prev, backend_status: 'offline' }))
            }
        }
        fetchInfo()
        const iv = setInterval(fetchInfo, 5000)
        return () => clearInterval(iv)
    }, [])

    const formatUptime = (sec) => {
        const h = Math.floor(sec / 3600)
        const m = Math.floor((sec % 3600) / 60)
        const s = sec % 60
        return `${h}h ${m}m ${s}s`
    }

    return (
        <div className="glass-card mb-8">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h2 className="font-display font-semibold text-lg text-textPrimary dark:text-gray-100">System Environment</h2>
                    <p className="text-sm text-textMuted dark:text-gray-400 mt-0.5">Real-time resource monitoring and backend health</p>
                </div>
                <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-300 text-xs font-semibold">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    {info.backend_status.toUpperCase()}
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                {/* CPU Usage */}
                <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                        <span className="text-textMuted dark:text-gray-400 font-medium">CPU Load</span>
                        <span className="text-textPrimary dark:text-gray-100 font-mono font-bold">{info.cpu_percent}%</span>
                    </div>
                    <div className="h-2 w-full bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                        <div
                            className="h-full bg-blue-500 transition-all duration-1000 ease-in-out"
                            style={{ width: `${info.cpu_percent}%` }}
                        />
                    </div>
                </div>

                {/* RAM Usage */}
                <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                        <span className="text-textMuted dark:text-gray-400 font-medium">Memory Usage</span>
                        <span className="text-textPrimary dark:text-gray-100 font-mono font-bold">{info.ram_percent}%</span>
                    </div>
                    <div className="h-2 w-full bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                        <div
                            className="h-full bg-purple-500 transition-all duration-1000 ease-in-out"
                            style={{ width: `${info.ram_percent}%` }}
                        />
                    </div>
                </div>

                {/* Uptime */}
                <div className="flex flex-col justify-center">
                    <span className="text-textMuted dark:text-gray-400 text-xs font-medium uppercase tracking-wider">Backend Uptime</span>
                    <span className="text-textPrimary dark:text-gray-100 font-mono text-xl font-bold mt-1">
                        {formatUptime(info.uptime)}
                    </span>
                </div>
            </div>
        </div>
    )
}
