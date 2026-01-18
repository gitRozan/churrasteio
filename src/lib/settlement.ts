export function splitCents(totalCents: number, parts: number) {
  if (parts <= 0) return []
  const base = Math.floor(totalCents / parts)
  const remainder = totalCents - base * parts
  return Array.from({ length: parts }, (_, idx) => base + (idx < remainder ? 1 : 0))
}

export type Transfer<TId extends string = string> = {
  fromId: TId
  toId: TId
  cents: number
}

function netFromRawPairs<TId extends string>(raw: Map<string, number>, ids: TId[]) {
  const result: Transfer<TId>[] = []
  const sorted = ids.slice().sort((a, b) => String(a).localeCompare(String(b)))

  for (let a = 0; a < sorted.length; a++) {
    for (let b = a + 1; b < sorted.length; b++) {
      const idA = sorted[a]
      const idB = sorted[b]
      const ab = raw.get(`${idA}||${idB}`) ?? 0
      const ba = raw.get(`${idB}||${idA}`) ?? 0
      if (ab === ba) continue
      if (ab > ba) result.push({ fromId: idA, toId: idB, cents: ab - ba })
      else result.push({ fromId: idB, toId: idA, cents: ba - ab })
    }
  }

  result.sort(
    (x, y) =>
      y.cents - x.cents ||
      String(x.fromId).localeCompare(String(y.fromId)) ||
      String(x.toId).localeCompare(String(y.toId)),
  )

  return result
}

export function computeTransfers<TId extends string>(
  balances: Array<{ id: TId; name: string; netCents: number }>,
) {
  const debtors = balances
    .filter((b) => b.netCents < 0)
    .map((b) => ({ id: b.id, name: b.name, remaining: Math.abs(b.netCents) }))
    .sort((a, b) => b.remaining - a.remaining || a.name.localeCompare(b.name))

  const creditors = balances
    .filter((b) => b.netCents > 0)
    .map((b) => ({ id: b.id, name: b.name, remaining: b.netCents }))
    .sort((a, b) => b.remaining - a.remaining || a.name.localeCompare(b.name))

  const transfers: Transfer<TId>[] = []

  let i = 0
  let j = 0
  while (i < debtors.length && j < creditors.length) {
    const d = debtors[i]
    const c = creditors[j]

    const amount = Math.min(d.remaining, c.remaining)
    if (amount > 0) {
      transfers.push({ fromId: d.id, toId: c.id, cents: amount })
      d.remaining -= amount
      c.remaining -= amount
    }

    if (d.remaining === 0) i++
    if (c.remaining === 0) j++
  }

  return transfers
}

export function computePairwiseTransfers<TId extends string>(input: {
  participantIds: TId[]
  expenses: Array<{
    totalCents: number
    payerId: TId
    consumerIds: TId[]
  }>
}) {
  const participantSet = new Set<TId>(input.participantIds)
  const raw = new Map<string, number>()

  for (const e of input.expenses) {
    const consumers = e.consumerIds
      .filter((id) => participantSet.has(id))
      .slice()
      .sort((a, b) => String(a).localeCompare(String(b)))

    if (!participantSet.has(e.payerId)) continue
    if (consumers.length === 0) continue

    const shares = splitCents(Math.max(0, Math.round(e.totalCents)), consumers.length)
    for (let i = 0; i < consumers.length; i++) {
      const fromId = consumers[i]
      if (fromId === e.payerId) continue
      const key = `${fromId}||${e.payerId}`
      raw.set(key, (raw.get(key) ?? 0) + shares[i])
    }
  }

  return netFromRawPairs(raw, Array.from(participantSet))
}

export type ConsumptionGroup<TId extends string = string> = {
  consumerIds: TId[]
  itemNames: string[]
  totalCents: number
  expenses: Array<{ payerId: TId; totalCents: number }>
}

export function computeConsumptionGroups<TId extends string>(input: {
  participantIds: TId[]
  expenses: Array<{
    itemName: string
    totalCents: number
    payerId: TId
    consumerIds: TId[]
  }>
}) {
  const participantSet = new Set<TId>(input.participantIds)

  const groups = new Map<
    string,
    {
      consumerIds: TId[]
      itemNames: string[]
      totalCents: number
      raw: Map<string, number>
      ids: Set<TId>
      expenses: Array<{ payerId: TId; totalCents: number }>
    }
  >()

  for (const e of input.expenses) {
    const consumers = e.consumerIds
      .filter((id) => participantSet.has(id))
      .slice()
      .sort((a, b) => String(a).localeCompare(String(b)))

    if (consumers.length === 0) continue
    if (!participantSet.has(e.payerId)) continue

    const key = consumers.join('|')
    const g =
      groups.get(key) ??
      (() => {
        const next = {
          consumerIds: consumers,
          itemNames: [] as string[],
          totalCents: 0,
          raw: new Map<string, number>(),
          ids: new Set<TId>(consumers),
          expenses: [] as Array<{ payerId: TId; totalCents: number }>,
        }
        groups.set(key, next)
        return next
      })()

    g.itemNames.push(e.itemName)
    g.totalCents += Math.max(0, Math.round(e.totalCents))
    g.ids.add(e.payerId)
    g.expenses.push({ payerId: e.payerId, totalCents: Math.max(0, Math.round(e.totalCents)) })

    const shares = splitCents(Math.max(0, Math.round(e.totalCents)), consumers.length)
    for (let i = 0; i < consumers.length; i++) {
      const fromId = consumers[i]
      if (fromId === e.payerId) continue
      const pair = `${fromId}||${e.payerId}`
      g.raw.set(pair, (g.raw.get(pair) ?? 0) + shares[i])
    }
  }

  const result: ConsumptionGroup<TId>[] = Array.from(groups.values()).map((g) => ({
    consumerIds: g.consumerIds,
    itemNames: g.itemNames,
    totalCents: g.totalCents,
    expenses: g.expenses,
  }))

  result.sort((a, b) => b.totalCents - a.totalCents || a.consumerIds.length - b.consumerIds.length)

  return result
}

export type GroupPayerTier = { count: number; cents: number }

export type ReceiverTransferSummary<TId extends string = string> = {
  toId: TId
  totalCents: number
  incoming: Array<{ fromId: TId; cents: number }>
  tiers: GroupPayerTier[]
}

export function summarizeTransfersByReceiver<TId extends string>(transfers: Transfer<TId>[]) {
  const byReceiver = new Map<TId, Array<{ fromId: TId; cents: number }>>()
  for (const t of transfers) {
    const list = byReceiver.get(t.toId) ?? []
    list.push({ fromId: t.fromId, cents: t.cents })
    byReceiver.set(t.toId, list)
  }

  const summaries: ReceiverTransferSummary<TId>[] = []
  for (const [toId, incoming] of byReceiver.entries()) {
    const tiersMap = new Map<number, number>()
    let totalCents = 0
    for (const inc of incoming) {
      totalCents += inc.cents
      tiersMap.set(inc.cents, (tiersMap.get(inc.cents) ?? 0) + 1)
    }
    const tiers: GroupPayerTier[] = Array.from(tiersMap.entries())
      .map(([cents, count]) => ({ cents, count }))
      .sort((a, b) => b.cents - a.cents || b.count - a.count)

    summaries.push({ toId, totalCents, incoming, tiers })
  }

  summaries.sort(
    (a, b) => b.totalCents - a.totalCents || String(a.toId).localeCompare(String(b.toId)),
  )
  return summaries
}

