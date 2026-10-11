import { useEffect, useRef, useState } from 'react'
import type { MonthRow } from '../lib/api'
import { daysInMonth, fmt, fmtCompact, fmtDay } from '../lib/format'

interface Props {
  months: MonthRow[]
  unit: string
  fourthDate: string | null
  contract?: number
}

const H = 230
const PAD = { top: 22, right: 12, bottom: 44, left: 44 }
const monthName = new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' })
const monthYear = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const asDate = (iso: string) => new Date(`${iso}T00:00:00Z`)

function niceMax(v: number) {
  if (v <= 0) return 1
  const p = 10 ** Math.floor(Math.log10(v))
  return [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((m) => m * p).find((m) => m >= v)!
}

/** Bars path with 4px rounded top corners, square at the baseline. */
function barPath(x: number, y: number, w: number, h: number) {
  const r = Math.min(4, w / 2, h)
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`
}

/** One bar per month: the busiest day in that month, with a tick for the average day. */
export default function MonthlyTrend({ months, unit, fourthDate, contract }: Props) {
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

  const peak = Math.max(0, ...months.map((m) => m.peak))
  const yMax = niceMax(Math.max(peak, contract ?? 0) * 1.08)
  const plotW = width - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const slot = plotW / Math.max(months.length, 1)
  const barW = Math.min(48, Math.max(6, slot - 6)) // at least a 6px surface gap between bars
  const y = (v: number) => PAD.top + plotH - (v / yMax) * plotH
  const cx = (i: number) => PAD.left + slot * i + slot / 2
  const labelEvery = slot < 30 ? 2 : 1
  const fourthMonth = fourthDate?.slice(0, 7)
  const busiest = months.reduce((b, m, i) => (m.peak > (months[b]?.peak ?? -1) ? i : b), 0)
  const ticks = [0, yMax / 2, yMax]

  const onKey = (e: React.KeyboardEvent) => {
    const cur = hover ?? busiest
    const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, Home: -99, End: 99 }
    if (e.key in moves) {
      e.preventDefault()
      setHover(Math.min(months.length - 1, Math.max(0, cur + moves[e.key])))
    } else if (e.key === 'Escape') setHover(null)
  }

  const h = hover !== null ? months[hover] : null
  // Tooltip sits beside the bar, on whichever side has room (240px wide).
  const tipLeft = hover === null ? 0
    : cx(hover) > width / 2 ? Math.max(0, cx(hover) - barW / 2 - 8 - 240) : Math.min(cx(hover) + barW / 2 + 8, width - 240)

  return (
    <div className="strip trend" ref={ref}>
      <svg width={width} height={H} viewBox={`0 0 ${width} ${H}`} role="img" tabIndex={0}
        aria-label={`Busiest day and average day of ${unit} for each of ${months.length} months. Use arrow keys to read each month.`}
        onKeyDown={onKey} onMouseLeave={() => setHover(null)} onBlur={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line className={t === 0 ? 'axis' : 'grid'} x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} />
            <text className="tick num" x={PAD.left - 8} y={y(t) + 4} textAnchor="end">{fmtCompact(t)}</text>
          </g>
        ))}

        {months.map((m, i) => {
          const full = daysInMonth(m.month)
          const partial = m.days < full
          const cls = ['month-bar', m.month.slice(0, 7) === fourthMonth ? 'is-fourth' : '', partial ? 'is-partial' : ''].join(' ')
          const x = cx(i) - barW / 2
          const top = y(m.peak)
          const avgY = y(m.average)
          const d = asDate(m.month)
          return (
            <g key={m.month} className={hover === i ? 'is-hover' : undefined}>
              <path className={cls} d={barPath(x, top, barW, Math.max(m.peak > 0 ? 1 : 0, PAD.top + plotH - top))} style={{ ['--i' as string]: i }} />
              {m.average > 0 && <line className="avg-tick" x1={x - 3} x2={x + barW + 3} y1={avgY} y2={avgY} />}
              {i === busiest && m.peak > 0 && (
                <text className="bar-label num" x={cx(i)} y={top - 6} textAnchor="middle">{fmtCompact(m.peak)}</text>
              )}
              {i % labelEvery === 0 && (
                <text className="tick" x={cx(i)} y={PAD.top + plotH + 16} textAnchor="middle">
                  {d.getUTCMonth() === 0 || i === 0 ? `${monthName.format(d)} ${String(d.getUTCFullYear()).slice(2)}` : monthName.format(d)}
                </text>
              )}
              {partial && (
                <text className="tick partial-note" x={cx(i)} y={PAD.top + plotH + 31} textAnchor="middle">
                  {m.days} {m.days === 1 ? 'day' : 'days'}
                </text>
              )}
              {/* Hit target: the whole column, much bigger than the bar. */}
              <rect className="hit" x={PAD.left + slot * i} y={PAD.top} width={slot} height={plotH}
                onMouseEnter={() => setHover(i)} />
            </g>
          )
        })}

        {contract !== undefined && contract > 0 && (
          <g pointerEvents="none">
            <line className="contract-line" x1={PAD.left} x2={width - PAD.right} y1={y(contract)} y2={y(contract)} />
            <text className="contract-label num" x={width - PAD.right} y={y(contract) - 6} textAnchor="end">Contract {fmt(contract)}</text>
          </g>
        )}
      </svg>

      {h && (
        <div className="tooltip trend-tip" style={{ left: tipLeft, top: 8 }} role="status">
          <strong>{monthYear.format(asDate(h.month))}</strong>
          <div className="row"><span>Busiest day ({fmtDay(h.peakDate)})</span><span className="num">{fmt(h.peak)}</span></div>
          <div className="row"><span>Average day</span><span className="num">{fmt(Math.round(h.average))}</span></div>
          <div className="muted">
            {h.days < daysInMonth(h.month) ? `Partial month: ${h.days} of ${daysInMonth(h.month)} days in the data` : `${h.days} days`}
          </div>
          {h.month.slice(0, 7) === fourthMonth && fourthDate && (
            <div className="muted">Holds the 4th-busiest day ({fmtDay(fourthDate)})</div>
          )}
        </div>
      )}
    </div>
  )
}
