// GET /api/customers — customers that have data, with their environments and date range.
import { db } from '../lib/server/db.js'
import { failure, json, methodNotAllowed } from '../lib/server/http.js'

export async function GET(): Promise<Response> {
  try {
    const sql = db('reader')
    const rows = await sql`select * from ctm.list_customers()`
    return json({
      customers: rows.map((r) => ({
        id: Number(r.id),
        name: r.name,
        environments: r.environments,
        firstDay: r.first_day ? new Date(r.first_day).toISOString().slice(0, 10) : null,
        lastDay: r.last_day ? new Date(r.last_day).toISOString().slice(0, 10) : null,
      })),
    })
  } catch (err) {
    return failure(err, 'customers')
  }
}

export const POST = () => methodNotAllowed('GET')
