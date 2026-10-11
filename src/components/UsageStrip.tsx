import { useEffect, useMemo, useRef, useState } from 'react'
import type { Summary } from '../lib/compliance'
import { fmt, fmtCompact, fmtDate, fmtDay } from '../lib/format'
import { envColor } from '../lib/types'

interface Props {
  envs: string[]
  summary: Summary
  unit: string
  contract?: number
}

const H = 240
const PAD = { top: 34, right: 12, bottom: 26, left: 44 }

function niceMax(v: number) {
  if (v <= 0) return 1
  const p = 10 ** Math.floor(Math.log10(v))
  return [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((m) => m * p).find((m) => m >= v)!
}

/** 365 thin bars, one per day of combined usage. The 4th-highest day is drawn in ink and called out. */
export default function UsageStrip({ envs, summary, unit, contract }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(900)
  const [hover, setHover] = useState<number | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(320, Math.round(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const { days, fourth } = summary
  const peak = summary.ranked[0]?.total ?? 0
  const yMax = niceMax(Math.max(peak, contract ?? 0) * 1.05)
  const plotW = width - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const step = plotW / Math.max(days.length, 1)
  const barW = Math.max(1, step > 3 ? step - 1 : step * 0.8)
  const x = (i: number) => PAD.left + i * step
  const y = (v: number) => PAD.top + plotH - (v / yMax) * plotH

  // Month labels: thin them out on narrow screens so they never collide (~44px each).
  const months = useMemo(() => {
    const all = days.map((d, i) => ({ d, i })).filter(({ d }) => d.date.endsWith('-01'))
    const every = Math.max(1, Math.ceil((all.length * 44) / Math.max(plotW, 1)))
    return all.filter((_, k) => k % every === 0)
  }, [days, plotW])
  const fourthIndex = fourth ? days.findIndex((d) => d.date === fourth.date) : -1
  const ticks = [0, yMax / 2, yMax]

  const indexAt = (clientX: number) => {
    const rect = ref.current!.getBoundingClientRect()
    const i = Math.floor((clientX - rect.left - PAD.left) / step)
    return Math.min(days.length - 1, Math.max(0, i))
  }
  const onKey = (e: React.KeyboardEvent) => {
    const cur = hover ?? fourthIndex ?? 0
    const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, PageUp: -30, PageDown: 30, Home: -9999, End: 9999 }
    if (e.key in moves) {
      e.preventDefault()
      setHover(Math.min(days.length - 1, Math.max(0, cur + moves[e.key])))
    } else if (e.key === 'Escape') setHover(null)
  }

  // Callout label for the 4th-highest day, kept inside the plot.
  const calloutText = fourth ? `4th busiest, ${fmtDay(fourth.date)}` : ''
  const calloutW = calloutText.length * 6.6
  const cx = fourthIndex >= 0 ? x(fourthIndex) + barW / 2 : 0
  const labelX = Math.min(Math.max(cx, PAD.left + calloutW / 2), width - PAD.right - calloutW / 2)

  const h = hover !== null ? days[hover] : null
  const tipLeft = hover !== null ? Math.min(Math.max(x(hover) + 12, 0), width - 200) : 0

  return (
    <div className="strip" ref={ref}>
      <svg
        width={width}
        height={H}
        viewBox={`0 0 ${width} ${H}`}
        role="img"
        tabIndex={0}
        aria-label={`Daily combined ${unit} for ${days.length} days. ${fourth ? `4th highest: ${fmt(fourth.total)} on ${fmtDate(fourth.date)}.` : ''} Use arrow keys to read each day.`}
        onMouseMove={(e) => setHover(indexAt(e.clientX))}
        onMouseLeave={() => setHover(null)}
        onKeyDown={onKey}
        onBlur={() => setHover(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line className={t === 0 ? 'axis' : 'grid'} x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} />
            <text className="tick num" x={PAD.left - 8} y={y(t) + 4} textAnchor="end">{fmtCompact(t)}</text>
          </g>
        ))}
        {months.map(({ d, i }) => (
          <text key={d.date} className="tick" x={x(i)} y={H - 6}>
            {d.date.slice(5, 7) === '01'
              ? d.date.slice(0, 4)
              : new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' }).format(new Date(`${d.date}T00:00:00Z`))}
          </text>
        ))}

        <g className="bars">
          {[...days.keys()].sort((a, b) => Number(days[a].rank <= 4) - Number(days[b].rank <= 4)).map((i) => {
            const d = days[i]
            const top = y(d.total)
            const cls = d.rank === 4 ? 'bar-fourth' : d.rank <= 3 ? 'bar-top' : 'bar-day'
            // Highlighted days are drawn at least 3px wide (centred) so they stay visible among 365 bars.
            const w = d.rank <= 4 ? Math.max(barW, 3) : barW
            return (
              <rect key={d.date} className={cls} x={x(i) + (barW - w) / 2} y={top} width={w}
                height={Math.max(d.total > 0 ? 1 : 0, PAD.top + plotH - top)} rx={barW >= 4 ? 2 : 0}
                style={{ ['--i' as string]: i }} />
            )
          })}
        </g>

        {contract !== undefined && contract > 0 && (
          <g>
            <line className="contract-line" x1={PAD.left} x2={width - PAD.right} y1={y(contract)} y2={y(contract)} />
            {/* Label sits on the side away from the 4th-day callout so the two never collide. */}
            <text className="contract-label num" y={y(contract) - 6}
              x={cx > width / 2 ? PAD.left + 4 : width - PAD.right}
              textAnchor={cx > width / 2 ? 'start' : 'end'}>
              Contract {fmt(contract)}
            </text>
          </g>
        )}

        {fourth && fourth.total > 0 && (
          <g className="callout">
            <line className="callout-line" x1={cx} x2={cx} y1={y(fourth.total) - 3} y2={14} />
            <text className="callout-text" x={labelX} y={10} textAnchor="middle">{calloutText}</text>
          </g>
        )}

        {hover !== null && <line className="hover-line" x1={x(hover) + barW / 2} x2={x(hover) + barW / 2} y1={PAD.top} y2={PAD.top + plotH} />}
      </svg>

      {h && (
        <div className="tooltip" style={{ left: tipLeft, top: 8 }} role="status">
          <strong>{fmtDate(h.date)}</strong>
          {envs.map((env) => (
            <div className="row" key={env}>
              <span><i className="env-dot" style={{ background: envColor(envs, env) }} />{env}</span>
              <span className="num">{fmt(h.byEnv[env] ?? 0)}</span>
            </div>
          ))}
          <div className="row total"><span>Combined</span><span className="num">{fmt(h.total)}</span></div>
          <div className="muted">Rank {h.rank} of {days.length}</div>
        </div>
      )}
    </div>
  )
}
