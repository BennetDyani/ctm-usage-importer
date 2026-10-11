// /api/contracts
//   GET  ?customerId=1   -> saved contract, licensed add-ons, installed add-ons and the current verdicts
//   POST (JSON)          -> save contract values and licensed add-ons (one transaction, ctm.save_contract)
//        { customerId, validFrom?, enteredBy, values: { TASKS?, SEP?, MIPS? }, licensed?: [...] }
//        A null value removes that measure ("not contracted").
import { validateContract } from '../lib/server/contracts.js'
import { db } from '../lib/server/db.js'
import { failure, json } from '../lib/server/http.js'

const day = (d: unknown) => (d ? new Date(d as string).toISOString().slice(0, 10) : null)

async function readContract(customerId: number) {
  const sql = db('reader')
  const [customer] = await sql`select id, name from ctm.list_customers() where id = ${customerId}`
  if (!customer) return null
  const [contract, addons, summary] = await Promise.all([
    sql`select * from ctm.get_contract(${customerId})`,
    sql`select * from ctm.addon_usage(${customerId})`,
    sql`select * from ctm.compliance_summary(${customerId})`,
  ])
  return {
    customer: { id: Number(customer.id), name: customer.name },
    contract: Object.fromEntries(contract.map((c) => [c.metric, {
      value: Number(c.contracted_value), validFrom: day(c.valid_from), enteredBy: c.entered_by, enteredAt: c.entered_at,
    }])),
    addons: addons.map((a) => ({ product: a.product, licensed: a.licensed, installedIn: a.installed_in })),
    summary: Object.fromEntries(summary.map((s) => [s.metric, {
      fourthHighest: s.fourth_highest === null ? null : Number(s.fourth_highest),
      fourthDate: day(s.fourth_date),
      contracted: s.contracted === null ? null : Number(s.contracted),
      headroom: s.headroom === null ? null : Number(s.headroom),
      status: s.status,
    }])),
  }
}

export async function GET(request: Request): Promise<Response> {
  const customerId = Number(new URL(request.url).searchParams.get('customerId'))
  if (!Number.isSafeInteger(customerId) || customerId <= 0) {
    return json({ error: 'bad_request', message: 'Add ?customerId= with a customer number.' }, 400)
  }
  try {
    const data = await readContract(customerId)
    return data ? json(data) : json({ error: 'not_found', message: 'There is no customer with that number.' }, 404)
  } catch (err) {
    return failure(err, 'contracts.get')
  }
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ error: 'bad_request', message: 'Send the contract as JSON.' }, 400)
  }
  const v = validateContract(body)
  if (!v.ok) return json({ error: 'invalid', message: v.errors.join(' '), errors: v.errors }, 422)
  try {
    const loader = db('loader')
    await loader`select ctm.save_contract(${loader.json({
      customerId: v.value.customerId, validFrom: v.value.validFrom, enteredBy: v.value.enteredBy,
      values: v.value.values, licensed: v.value.licensed,
    } as never)})`
    // Read back through the reader, so the response shows exactly what is now stored.
    const data = await readContract(v.value.customerId)
    return json({ status: 'saved', ...data })
  } catch (err) {
    const e = err as { code?: string; message?: string }
    if (e?.code === '22023' && /unknown customer/.test(e.message ?? '')) {
      return json({ error: 'not_found', message: 'There is no customer with that number.' }, 404)
    }
    return failure(err, 'contracts.post')
  }
}
