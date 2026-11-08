// Settings: forecast odds (spec 2026-11-03, section 2) and the Rate leads link.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import PageHeader from '../components/PageHeader'
import { supabase, isDemoMode } from '../lib/supabase'
import { resolveForecast } from '../lib/forecast'
import { refreshForecastInputs } from '../lib/useForecastInputs'

const FIELDS = [
  ['temp_odds', 'hot', 'Hot odds', '%'],
  ['temp_odds', 'warm', 'Warm odds', '%'],
  ['temp_odds', 'cold', 'Cold odds', '%'],
  ['arive_odds', 'prospect', 'Arive prospect odds', '%'],
  ['arive_odds', 'processing', 'Arive processing odds', '%'],
  ['arive_odds', 'closing', 'Arive closing odds', '%'],
  ['close_offset_months', 'hot', 'Hot closes in (months)', ''],
  ['close_offset_months', 'warm', 'Warm closes in (months)', ''],
  ['close_offset_months', 'cold', 'Cold closes in (months)', ''],
]

export default function Settings() {
  const [form, setForm] = useState(() => resolveForecast(null))
  const [status, setStatus] = useState(null)
  // Save stays off until the stored odds have loaded: saving the defaults
  // over a failed or pending load would overwrite the real ones.
  const [loaded, setLoaded] = useState(isDemoMode)

  useEffect(() => {
    if (isDemoMode) return undefined
    let live = true
    Promise.resolve(supabase.from('settings').select('value').eq('key', 'forecast').maybeSingle())
      .then(({ data, error }) => {
        if (!live) return
        if (error) setStatus(`Could not load saved odds: ${error.message}`)
        else {
          setForm(resolveForecast(data?.value))
          setLoaded(true)
        }
      })
      .catch((e) => live && setStatus(`Could not load saved odds: ${e?.message || e}`))
    return () => {
      live = false
    }
  }, [])

  const set = (group, k, v) => setForm((f) => ({ ...f, [group]: { ...f[group], [k]: v } }))

  const save = async () => {
    if (isDemoMode) {
      setStatus('Not saved: demo mode')
      return
    }
    // resolveForecast turns the text inputs back into numbers and fills blanks.
    const value = resolveForecast(form)
    let error
    try {
      ;({ error } = await supabase.from('settings').upsert({ key: 'forecast', value }, { onConflict: 'key' }))
    } catch (e) {
      error = e
    }
    setStatus(error ? `Not saved: ${error.message || error}` : 'Saved')
    if (!error) {
      setForm(value)
      refreshForecastInputs().catch(() => {})
    }
  }

  return (
    <div>
      <PageHeader title="Settings" subtitle="Forecast odds and lead temperature." />
      <section className="mt-6 max-w-xl rounded-card border border-line bg-panel p-5">
        <h3 className="text-ui font-semibold">Forecast</h3>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {FIELDS.map(([group, k, label, unit]) => (
            <label key={`${group}.${k}`} className="flex flex-col gap-1 text-body text-muted">
              {label}
              <span className="flex items-center gap-1">
                <input
                  aria-label={label}
                  inputMode="numeric"
                  value={String(form[group][k] ?? '')}
                  onChange={(e) => set(group, k, e.target.value.replace(/[^\d]/g, ''))}
                  className="w-20 rounded-lg border border-line2 bg-panel px-2 py-1.5 text-body text-[color:var(--text)]"
                />
                {unit}
              </span>
            </label>
          ))}
          <label className="flex flex-col gap-1 text-body text-muted sm:col-span-3">
            MPG est. residual per account (until residuals arrive)
            <input
              aria-label="MPG est. residual per account"
              inputMode="numeric"
              value={form.mpg_est_residual_per_account == null ? '' : String(form.mpg_est_residual_per_account)}
              onChange={(e) => setForm((f) => ({ ...f, mpg_est_residual_per_account: e.target.value.replace(/[^\d]/g, '') || null }))}
              className="w-28 rounded-lg border border-line2 bg-panel px-2 py-1.5 text-body text-[color:var(--text)]"
            />
          </label>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={save}
            disabled={!loaded}
            className="btn-primary rounded-lg px-4 py-2 text-body font-semibold disabled:opacity-50"
          >
            Save odds
          </button>
          {status && <span className="text-body text-muted">{status}</span>}
        </div>
      </section>
      <section className="mt-4 max-w-xl rounded-card border border-line bg-panel p-5 text-body">
        <h3 className="text-ui font-semibold">Lead temperature</h3>
        <p className="mt-1 text-muted">Rate the leads you've already called, one at a time.</p>
        <Link to="/rate" className="mt-3 inline-flex min-h-[38px] items-center rounded-lg border border-line2 px-3.5 text-body font-semibold text-ink2 hover:bg-hoverbg">
          Open Rate leads
        </Link>
      </section>
    </div>
  )
}
