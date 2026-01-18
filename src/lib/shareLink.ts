import type { Expense, Participant } from '../store/churrasStore'

export type ShareStateV1 = {
  v: 1
  participants: Participant[]
  expenses: Expense[]
}

function base64UrlEncodeBytes(bytes: Uint8Array) {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function base64UrlDecodeToBytes(input: string) {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((input.length + 3) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function encodeShareStateV1(input: Omit<ShareStateV1, 'v'>) {
  const payload: ShareStateV1 = { v: 1, ...input }
  const json = JSON.stringify(payload)
  const bytes = new TextEncoder().encode(json)
  return base64UrlEncodeBytes(bytes)
}

function isString(x: unknown): x is string {
  return typeof x === 'string'
}

function isNumber(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x)
}

export function decodeShareStateV1(token: string): ShareStateV1 | null {
  try {
    const bytes = base64UrlDecodeToBytes(token)
    const json = new TextDecoder().decode(bytes)
    const raw = JSON.parse(json) as unknown
    if (!raw || typeof raw !== 'object') return null
    const o = raw as Record<string, unknown>
    if (o.v !== 1) return null
    if (!Array.isArray(o.participants) || !Array.isArray(o.expenses)) return null

    const participants: Participant[] = o.participants
      .map((p) => {
        if (!p || typeof p !== 'object') return null
        const pp = p as Record<string, unknown>
        if (!isString(pp.id) || !isString(pp.name)) return null
        const pixKey = pp.pixKey
        return {
          id: pp.id,
          name: pp.name,
          ...(pixKey === undefined ? {} : isString(pixKey) ? { pixKey } : {}),
        } satisfies Participant
      })
      .filter((x): x is Participant => x !== null)

    const expenses: Expense[] = o.expenses
      .map((e) => {
        if (!e || typeof e !== 'object') return null
        const ee = e as Record<string, unknown>
        if (
          !isString(ee.id) ||
          !isString(ee.itemName) ||
          !isNumber(ee.totalCents) ||
          !isString(ee.payerId) ||
          !Array.isArray(ee.consumerIds) ||
          !isNumber(ee.createdAt)
        )
          return null

        const consumerIds = ee.consumerIds.filter(isString)
        if (consumerIds.length === 0) return null

        return {
          id: ee.id,
          itemName: ee.itemName,
          totalCents: Math.max(0, Math.round(ee.totalCents)),
          payerId: ee.payerId,
          consumerIds,
          createdAt: Math.round(ee.createdAt),
        } satisfies Expense
      })
      .filter((x): x is Expense => x !== null)

    return { v: 1, participants, expenses }
  } catch {
    return null
  }
}

