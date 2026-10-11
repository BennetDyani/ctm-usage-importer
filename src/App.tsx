import { useCallback, useEffect, useState } from 'react'
import AskPanel from './components/AskPanel'
import { AskIcon, ContractIcon, MoonIcon, ReportIcon, SunIcon, UploadIcon } from './components/Icons'
import ContractsPage from './pages/ContractsPage'
import ReportPage from './pages/ReportPage'
import UploadPage from './pages/UploadPage'
import { getContract, listCustomers } from './lib/api'
import { CUSTOMERS, type Contract, type Page } from './lib/types'

type Theme = 'light' | 'dark'

const NAV: { id: Page; label: string; icon: () => React.JSX.Element }[] = [
  { id: 'report', label: 'Report', icon: ReportIcon },
  { id: 'upload', label: 'Upload', icon: UploadIcon },
  { id: 'contracts', label: 'Contracts', icon: ContractIcon },
]

function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem('ctm-theme')
    if (saved === 'light' || saved === 'dark') return saved
  } catch { /* storage unavailable */ }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export default function App() {
  const [page, setPage] = useState<Page>('report')
  const [customerName, setCustomerName] = useState(CUSTOMERS[0].name)
  const [contracts, setContracts] = useState<Record<string, Contract>>({})
  const [askOpen, setAskOpen] = useState(false)
  const [theme, setTheme] = useState<Theme>(initialTheme)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try { localStorage.setItem('ctm-theme', theme) } catch { /* ignore */ }
  }, [theme])

  // Saved contracts come from the database (Phase 5). The report itself moves to live data in Phase 6.
  useEffect(() => {
    let live = true
    listCustomers().then(async (r) => {
      if (r.kind !== 'ok') return
      for (const c of r.data.customers) {
        const d = await getContract(c.id)
        if (!live || d.kind !== 'ok') continue
        const k = d.data.contract
        setContracts((all) => ({
          ...all,
          [c.name]: {
            tasks: k.TASKS?.value, sep: k.SEP?.value, mips: k.MIPS?.value,
            validFrom: k.TASKS?.validFrom ?? undefined,
            licensed: d.data.addons.filter((a) => a.licensed).map((a) => a.product),
          },
        }))
      }
    })
    return () => { live = false }
  }, [])

  const customer = CUSTOMERS.find((c) => c.name === customerName) ?? CUSTOMERS[0]
  const closeAsk = useCallback(() => setAskOpen(false), [])

  return (
    <div className="shell">
      <header className="rail">
        <div className="brand">
          <img src="/favicon.svg" alt="" width={30} height={30} />
          <span>Usage Importer<small>Control-M renewals</small></span>
        </div>
        <nav aria-label="Main">
          {NAV.map(({ id, label, icon: Icon }) => (
            <button key={id} className="nav-item" aria-current={page === id ? 'page' : undefined} onClick={() => setPage(id)}>
              <Icon />{label}
            </button>
          ))}
          <button className="nav-item" onClick={() => setAskOpen(true)}><AskIcon />Ask</button>
        </nav>
        <div className="rail-foot">
          <p className="rail-note">Uploads and contracts are saved to the database. The report charts still use the bundled sample files until they are connected.</p>
          <button className="ghost-btn" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>
            {theme === 'dark' ? <SunIcon /> : <MoonIcon />}{theme === 'dark' ? 'Light' : 'Dark'}
          </button>
        </div>
      </header>

      <main className="main">
        {page === 'report' && (
          <ReportPage customer={customer} onCustomer={setCustomerName} contract={contracts[customer.name]}
            onEditContract={() => setPage('contracts')} onAsk={() => setAskOpen(true)} />
        )}
        {page === 'upload' && <UploadPage />}
        {page === 'contracts' && (
          <ContractsPage customerName={customer.name} onCustomer={setCustomerName}
            onSaved={(name, c) => setContracts((all) => ({ ...all, [name]: c }))} onViewReport={() => setPage('report')} />
        )}
      </main>

      {askOpen && <AskPanel customer={customer.name} onClose={closeAsk} />}
    </div>
  )
}
