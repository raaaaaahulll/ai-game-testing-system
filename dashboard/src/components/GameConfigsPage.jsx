import { useState, useEffect } from 'react'
import PageHeader from './PageHeader'
import LoadingSpinner from './LoadingSpinner'
import SkeletonTable from './SkeletonTable'
import EmptyState from './EmptyState'
import { IconAdd } from './Icons'
import { API_BASE } from '../api'

function parseProcessNames(value) {
  if (!value || typeof value !== 'string') return '[]'
  const trimmed = value.trim()
  if (!trimmed) return '[]'
  if (trimmed.startsWith('[')) {
    try {
      JSON.parse(trimmed)
      return trimmed
    } catch {
      return '[]'
    }
  }
  const lines = trimmed.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean)
  return JSON.stringify(lines)
}

function formatProcessNames(jsonStr) {
  try {
    const arr = JSON.parse(jsonStr || '[]')
    return Array.isArray(arr) ? arr.join('\n') : jsonStr || ''
  } catch {
    return jsonStr || ''
  }
}

export default function GameConfigsPage() {
  const [configs, setConfigs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [editing, setEditing] = useState(null)
  const [copiedKey, setCopiedKey] = useState(null)
  const [form, setForm] = useState({
    game_key: '',
    display_name: '',
    window_title: '',
    process_names: '',
    genre: 'racing',
    control_type: 'ppo',
    model_path: '',
    key_bindings: null,
    mouse_mode: 'none',
    mouse_sensitivity: '',
    menu_click_positions: '',
    minimap_left: 200,
    minimap_bottom: 150,
    minimap_size: 200,
    marker_template_path: '',
  })
  const [saving, setSaving] = useState(false)

  const loadConfigs = () => {
    fetch(`${API_BASE}/game-configs`)
      .then((r) => (r.ok ? r.json() : { configs: [] }))
      .then((d) => setConfigs(d.configs || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    loadConfigs()
  }, [])

  const openAdd = () => {
    setEditing(null)
    setForm({
      game_key: '',
      display_name: '',
      window_title: '',
      process_names: '',
      genre: 'racing',
      control_type: 'ppo',
      model_path: '',
      mouse_mode: 'none',
      mouse_sensitivity: '',
      menu_click_positions: '',
      minimap_left: 200,
      minimap_bottom: 150,
      minimap_size: 200,
      marker_template_path: '',
    })
  }

  const getTrainCommand = (c) => {
    const algo = (c.control_type || 'ppo').toLowerCase()
    return `python agents/train.py --game_key ${c.game_key} --algo ${algo}`
  }

  const copyTrainCommand = async (c) => {
    const cmd = getTrainCommand(c)
    try {
      await navigator.clipboard.writeText(cmd)
      setCopiedKey(c.game_key)
      setTimeout(() => setCopiedKey(null), 2000)
    } catch (e) {
      alert('Copy failed. Run in terminal: ' + cmd)
    }
  }

  const formatMenuClickPositions = (val) => {
    if (val == null || val === '') return ''
    if (typeof val === 'string') return val
    try {
      return typeof val === 'object' ? JSON.stringify(val, null, 2) : String(val)
    } catch {
      return String(val)
    }
  }

  const openEdit = (c) => {
    setEditing(c.game_key)
    setForm({
      game_key: c.game_key,
      display_name: c.display_name || '',
      window_title: c.window_title || '',
      process_names: formatProcessNames(c.process_names),
      genre: c.genre || 'racing',
      control_type: c.control_type || 'ppo',
      model_path: c.model_path || '',
      key_bindings: c.key_bindings && typeof c.key_bindings === 'object' ? { ...c.key_bindings } : null,
      mouse_mode: c.mouse_mode || 'none',
      mouse_sensitivity: c.mouse_sensitivity != null ? String(c.mouse_sensitivity) : '',
      menu_click_positions: formatMenuClickPositions(c.menu_click_positions),
      minimap_left: c.minimap_left != null ? c.minimap_left : 200,
      minimap_bottom: c.minimap_bottom != null ? c.minimap_bottom : 150,
      minimap_size: c.minimap_size != null ? c.minimap_size : 200,
      marker_template_path: c.marker_template_path || '',
    })
  }

  const save = async () => {
    const keyBindingsPayload = form.key_bindings && typeof form.key_bindings === 'object'
      ? Object.fromEntries(
        Object.entries(form.key_bindings)
          .filter(([, v]) => v != null && String(v).trim() !== '')
          .map(([k, v]) => [k, String(v).trim()])
      )
      : null
    const menuClickStr = (form.menu_click_positions || '').trim()
    let menu_click_positions = null
    if (menuClickStr) {
      try {
        JSON.parse(menuClickStr)
        menu_click_positions = menuClickStr
      } catch {
        alert('Menu click positions must be valid JSON.')
        return
      }
    }
    const sens = form.mouse_sensitivity !== '' && form.mouse_sensitivity != null ? parseInt(form.mouse_sensitivity, 10) : null
    const payload = {
      game_key: form.game_key.trim(),
      display_name: form.display_name.trim(),
      window_title: (form.window_title || '').trim(),
      process_names: parseProcessNames(form.process_names),
      genre: (form.genre || 'racing').trim(),
      control_type: (form.control_type || 'ppo').trim(),
      model_path: (form.model_path || '').trim() || undefined,
      key_bindings: keyBindingsPayload && Object.keys(keyBindingsPayload).length ? keyBindingsPayload : null,
      mouse_mode: (form.mouse_mode || 'none').trim() || 'none',
      mouse_sensitivity: sens != null && !isNaN(sens) ? sens : undefined,
      menu_click_positions: menu_click_positions || undefined,
      minimap_left: parseInt(form.minimap_left, 10),
      minimap_bottom: parseInt(form.minimap_bottom, 10),
      minimap_size: parseInt(form.minimap_size, 10),
    }
    if (!payload.game_key || !payload.display_name) {
      alert('Game key and display name are required.')
      return
    }
    setSaving(true)
    try {
      if (editing === null) {
        const r = await fetch(`${API_BASE}/game-configs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || r.statusText)
      } else {
        const r = await fetch(`${API_BASE}/game-configs/${encodeURIComponent(editing)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || r.statusText)
      }
      setEditing(null)
      loadConfigs()
    } catch (e) {
      alert(e.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const handleTemplateUpload = async (e) => {
    const file = e.target.files[0]
    if (!file || !editing) return
    const formData = new FormData()
    formData.append('file', file)
    setSaving(true)
    try {
      const r = await fetch(`${API_BASE}/game-configs/${encodeURIComponent(editing)}/template`, {
        method: 'POST',
        body: formData,
      })
      if (!r.ok) throw new Error('Upload failed')
      const d = await r.json()
      setForm(f => ({ ...f, marker_template_path: d.path }))
      loadConfigs()
    } catch (e) {
      alert(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Game Configs"
        description="Manage game configurations for the AI testing agent."
      />
      <div className="max-w-7xl mx-auto px-6 pb-8">
        {error && (
          <div className="mb-6 alert-error">{error}</div>
        )}
        <>
          <div className="glass-card p-8 mb-8">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center text-accent">
                <IconAdd className="w-6 h-6" />
              </div>
              <h2 className="font-display text-xl font-bold text-textPrimary dark:text-gray-100 tracking-wide">
                {editing ? 'Edit Game Config' : 'Add New Game'}
              </h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
              <div>
                <label className="form-label">Game key (id)</label>
                <input
                  type="text"
                  value={form.game_key}
                  onChange={(e) => setForm((f) => ({ ...f, game_key: e.target.value }))}
                  placeholder="e.g. nfs_rivals"
                  className="form-input"
                  disabled={!!editing}
                />
                {editing && <p className="text-[10px] text-textMuted dark:text-gray-500 mt-1 uppercase">ID cannot be changed</p>}
              </div>
              <div>
                <label className="form-label">Display name</label>
                <input
                  type="text"
                  value={form.display_name}
                  onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))}
                  placeholder="e.g. NFS Rivals"
                  className="form-input"
                />
              </div>
            </div>

            <div className="mb-6">
              <label className="form-label">Window title (partial match)</label>
              <input
                type="text"
                value={form.window_title}
                onChange={(e) => setForm((f) => ({ ...f, window_title: e.target.value }))}
                placeholder="e.g. Need for Speed™ Rivals"
                className="form-input"
              />
            </div>

            <div className="mb-6">
              <label className="form-label">Process names (one per line)</label>
              <textarea
                value={form.process_names}
                onChange={(e) => setForm((f) => ({ ...f, process_names: e.target.value }))}
                placeholder={'NFSRivals.exe'}
                rows={3}
                className="form-input font-mono text-sm"
              />
            </div>

            <div className="bg-gray-50 dark:bg-gray-900/50 p-6 rounded-lg border border-gray-100 dark:border-gray-800 mb-6">
              <label className="form-label text-accent font-bold mb-3">Key Bindings</label>
              <p className="text-xs text-textMuted dark:text-gray-500 mb-4 font-mono">Leave empty to use default arrow keys.</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {['accel', 'brake', 'left', 'right'].map((name) => (
                  <div key={name}>
                    <label className="text-[10px] text-textMuted dark:text-gray-500 uppercase font-bold block mb-1">{name}</label>
                    <input
                      type="text"
                      value={form.key_bindings && form.key_bindings[name] != null ? form.key_bindings[name] : ''}
                      onChange={(e) => {
                        const v = e.target.value.trim()
                        setForm((f) => {
                          const prev = f.key_bindings || {}
                          const next = v ? { ...prev, [name]: v } : (() => {
                            const o = { ...prev }
                            delete o[name]
                            return Object.keys(o).length ? o : null
                          })()
                          return { ...f, key_bindings: next }
                        })
                      }}
                      placeholder={name === 'accel' ? 'up' : name === 'brake' ? 'down' : name === 'left' ? 'left' : 'right'}
                      className="form-input text-sm text-center font-mono"
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
              <div>
                <label className="form-label">Genre</label>
                <select
                  value={form.genre}
                  onChange={(e) => setForm((f) => ({ ...f, genre: e.target.value }))}
                  className="form-input"
                >
                  <option value="racing">Racing</option>
                  <option value="open_world">Open world</option>
                  <option value="minimal">Minimal</option>
                </select>
              </div>
              <div>
                <label className="form-label">Control type</label>
                <select
                  value={form.control_type}
                  onChange={(e) => setForm((f) => ({ ...f, control_type: e.target.value }))}
                  className="form-input"
                >
                  <option value="ppo">PPO (Recommended)</option>
                  <option value="dqn">DQN</option>
                </select>
              </div>
              <div>
                <label className="form-label">Model path (optional)</label>
                <input
                  type="text"
                  value={form.model_path}
                  onChange={(e) => setForm((f) => ({ ...f, model_path: e.target.value }))}
                  placeholder="Leave for auto-generated"
                  className="form-input"
                />
              </div>
            </div>

            <div className="border-t border-gray-100 dark:border-gray-800 pt-6 mt-6 mb-6">
              <h3 className="form-label text-accent font-bold mb-3">Vision & GPS (Universal Analytics)</h3>
              <p className="text-xs text-textMuted dark:text-gray-500 mb-4">
                Configure where the minimap is located and upload a crop of the player marker (arrow) to enable accurate coverage tracking.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                <div>
                  <label className="form-label">Minimap X offset (px)</label>
                  <input
                    type="number"
                    value={form.minimap_left}
                    onChange={(e) => setForm((f) => ({ ...f, minimap_left: e.target.value }))}
                    className="form-input"
                  />
                </div>
                <div>
                  <label className="form-label">Minimap Bottom offset (px)</label>
                  <input
                    type="number"
                    value={form.minimap_bottom}
                    onChange={(e) => setForm((f) => ({ ...f, minimap_bottom: e.target.value }))}
                    className="form-input"
                  />
                </div>
                <div>
                  <label className="form-label">Minimap Size (px)</label>
                  <input
                    type="number"
                    value={form.minimap_size}
                    onChange={(e) => setForm((f) => ({ ...f, minimap_size: e.target.value }))}
                    className="form-input"
                  />
                </div>
              </div>

              <div className="bg-gray-50 dark:bg-gray-900/50 p-4 rounded-lg border border-dashed border-gray-200 dark:border-gray-700">
                <label className="form-label mb-2 block">Player Marker Template</label>
                <div className="flex items-center gap-4">
                  {form.marker_template_path ? (
                    <div className="w-12 h-12 bg-black rounded border border-gray-700 flex items-center justify-center overflow-hidden">
                      <img
                        src={`${API_BASE.replace('/api', '')}/${form.marker_template_path}`}
                        alt="Template"
                        className="max-w-full max-h-full object-contain"
                        onError={(e) => { e.target.src = 'https://via.placeholder.com/48?text=Err' }}
                      />
                    </div>
                  ) : (
                    <div className="w-12 h-12 bg-gray-200 dark:bg-gray-800 rounded border border-gray-300 dark:border-gray-700 flex items-center justify-center text-[10px] text-textMuted text-center px-1">
                      No marker
                    </div>
                  )}
                  <div className="flex-1">
                    <input
                      type="file"
                      accept="image/*"
                      id="template-upload"
                      className="hidden"
                      onChange={handleTemplateUpload}
                      disabled={!editing || saving}
                    />
                    <label
                      htmlFor="template-upload"
                      className={`btn-secondary text-xs px-4 py-2 cursor-pointer inline-block ${(!editing || saving) ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      {form.marker_template_path ? 'Change Marker' : 'Upload Marker'}
                    </label>
                    <p className="text-[10px] text-textMuted dark:text-gray-500 mt-1">
                      {!editing ? 'Save the game first to enable template upload.' : 'Upload a small crop (e.g. 24x24) of the player arrow.'}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="border-t border-gray-100 dark:border-gray-800 pt-6 mt-6 mb-6">
              <h3 className="form-label text-accent font-bold mb-3">Mouse Automation</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="form-label">Mouse mode</label>
                  <select
                    value={form.mouse_mode}
                    onChange={(e) => setForm((f) => ({ ...f, mouse_mode: e.target.value }))}
                    className="form-input"
                  >
                    <option value="none">None</option>
                    <option value="menus_only">Menus only</option>
                    <option value="gameplay">Gameplay (camera)</option>
                  </select>
                </div>
                {form.mouse_mode === 'gameplay' && (
                  <div>
                    <label className="form-label">Sensitivity (px/step)</label>
                    <input
                      type="number"
                      min={1}
                      max={200}
                      value={form.mouse_sensitivity}
                      onChange={(e) => setForm((f) => ({ ...f, mouse_sensitivity: e.target.value }))}
                      className="form-input"
                    />
                  </div>
                )}
              </div>
              {form.mouse_mode === 'menus_only' && (
                <div className="mt-4">
                  <label className="form-label">Menu click positions (JSON)</label>
                  <textarea
                    value={form.menu_click_positions}
                    onChange={(e) => setForm((f) => ({ ...f, menu_click_positions: e.target.value }))}
                    placeholder='{"start":[0.5,0.4]}'
                    rows={3}
                    className="form-input font-mono text-xs"
                  />
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 pt-4">
              {editing && (
                <button type="button" onClick={openAdd} className="btn-secondary px-6">
                  Cancel
                </button>
              )}
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="btn-primary px-8"
              >
                {saving ? 'Saving…' : (editing ? 'Update Game' : 'Add Game')}
              </button>
            </div>
          </div>

          <div className="glass-card overflow-hidden">
            <div className="p-5 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between bg-gray-50/50 dark:bg-gray-900/30">
              <h2 className="font-display font-bold text-textPrimary dark:text-gray-100 uppercase tracking-widest text-sm">Saved Games</h2>
              <div className="px-3 py-1 bg-gray-100 dark:bg-gray-800 rounded font-mono text-[10px] text-textMuted dark:text-gray-500 border border-gray-200 dark:border-gray-700">
                {configs.length} TOTAL
              </div>
            </div>
            {loading ? (
              <SkeletonTable rows={5} cols={8} />
            ) : configs.length === 0 ? (
              <div className="p-12">
                <EmptyState
                  imageSrc="/empty-state-games.svg"
                  title="No game configs"
                  description="Add your first game above to start testing."
                  action={
                    <button type="button" onClick={openAdd} className="btn-primary btn-icon">
                      <IconAdd />
                      Add game
                    </button>
                  }
                />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-gray-50/50 dark:bg-gray-900/50 border-b border-gray-100 dark:border-gray-800 text-[10px] font-bold text-textMuted dark:text-gray-500 lg:tracking-wider uppercase">
                      <th className="p-4">Key</th>
                      <th className="p-4">Display Name</th>
                      <th className="p-4">Genre</th>
                      <th className="p-4">Control</th>
                      <th className="p-4">Mouse</th>
                      <th className="p-4">Window</th>
                      <th className="p-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 dark:divide-gray-800/50">
                    {configs.map((c) => (
                      <tr key={c.game_key} className="hover:bg-gray-50/50 dark:hover:bg-gray-900/20 transition-colors">
                        <td className="p-4 font-mono text-xs font-bold text-accent dark:text-blue-400">{c.game_key}</td>
                        <td className="p-4 text-sm font-medium text-textPrimary dark:text-gray-200">{c.display_name}</td>
                        <td className="p-4 text-xs">
                          <span className="px-2 py-1 rounded bg-gray-100 dark:bg-gray-800 text-textMuted dark:text-gray-400">
                            {c.genre || 'racing'}
                          </span>
                        </td>
                        <td className="p-4 text-xs font-mono">{c.control_type || 'ppo'}</td>
                        <td className="p-4 text-[10px] uppercase font-bold text-textMuted dark:text-gray-500">
                          {c.mouse_mode || 'none'}
                        </td>
                        <td className="p-4 text-xs text-textLight dark:text-gray-600 font-mono truncate max-w-[120px]" title={c.window_title}>
                          {c.window_title || '—'}
                        </td>
                        <td className="p-4 text-right">
                          <div className="flex items-center justify-end gap-3">
                            <button
                              type="button"
                              onClick={() => copyTrainCommand(c)}
                              className="text-[10px] uppercase font-bold text-textLight dark:text-gray-500 hover:text-accent dark:hover:text-blue-400 transition-colors"
                            >
                              {copiedKey === c.game_key ? 'COPIED' : 'COPY CMD'}
                            </button>
                            <button
                              type="button"
                              onClick={() => openEdit(c)}
                              className="text-[10px] uppercase font-bold text-accent dark:text-blue-400 hover:underline"
                            >
                              EDIT
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      </div>
    </>
  )
}
