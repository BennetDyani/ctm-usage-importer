// GET /api/batches?limit=20 — recent upload attempts (loaded, already loaded and refused), newest first.
import { db } from '../lib/server/db'
import { failure, json, methodNotAllowed } from '../lib/server/http'

export async function GET(request: Request): Promise<Response> {
  const limit = Math.min(Math.max(Number(new URL(request.url).searchParams.get('limit')) || 20, 1), 100)
  try {
    const sql = db('reader')
    const rows = await sql`select * from ctm.recent_batches(${limit})`
    return json({
      batches: rows.map((r) => ({
        id: Number(r.id),
        createdAt: r.created_at,
        uploaderId: r.uploader_id,
        customer: r.customer_name,
        environment: r.environment_name,
        status: r.status,
        files: r.files,
        errorCount: r.error_count,
        warningCount: r.warning_count,
      })),
    })
  } catch (err) {
    return failure(err, 'batches')
  }
}

export const POST = () => methodNotAllowed('GET')
