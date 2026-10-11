// /api/report?customerId=1
// One customer's full report: compliance summary, daily series (with ranks), monthly trend,
// add-ons, coverage and the saved contract. Read-only (ctm_reader).
import { readReport } from '../lib/server/report.js'
import { failure, json, methodNotAllowed } from '../lib/server/http.js'

export async function GET(request: Request): Promise<Response> {
  const customerId = Number(new URL(request.url).searchParams.get('customerId'))
  if (!Number.isSafeInteger(customerId) || customerId <= 0) {
    return json({ error: 'bad_request', message: 'Add ?customerId= with a customer number.' }, 400)
  }
  try {
    const data = await readReport(customerId)
    return data ? json(data) : json({ error: 'not_found', message: 'There is no customer with that number.' }, 404)
  } catch (err) {
    return failure(err, 'report.get')
  }
}

export const POST = () => methodNotAllowed('GET')
