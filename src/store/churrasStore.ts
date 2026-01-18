import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import { splitCents } from '../lib/settlement'

export type Participant = {
  id: string
  name: string
  pixKey?: string
}

export type Expense = {
  id: string
  itemName: string
  totalCents: number
  payerId: string
  consumerIds: string[]
  createdAt: number
}

type State = {
  participants: Participant[]
  expenses: Expense[]
}

type Actions = {
  addParticipant: (input: { name: string; pixKey?: string }) => void
  updateParticipant: (id: string, patch: Partial<Pick<Participant, 'name' | 'pixKey'>>) => void
  removeParticipant: (id: string) => void
  addExpense: (input: {
    itemName: string
    totalCents: number
    payerId: string
    consumerIds: string[]
  }) => void
  updateExpense: (
    id: string,
    patch: Partial<Pick<Expense, 'itemName' | 'totalCents' | 'payerId' | 'consumerIds'>>,
  ) => void
  removeExpense: (id: string) => void
  resetAll: () => void
}

export type ChurrasStore = State & Actions

function uuid() {
  return crypto.randomUUID()
}

export const useChurrasStore = create<ChurrasStore>()(
  persist(
    (set, get) => ({
      participants: [],
      expenses: [],
      addParticipant: ({ name, pixKey }) => {
        const trimmed = name.trim()
        if (!trimmed) return
        set((s) => ({
          participants: [
            ...s.participants,
            { id: uuid(), name: trimmed, pixKey: pixKey?.trim() || undefined },
          ],
        }))
      },
      updateParticipant: (id, patch) => {
        set((s) => ({
          participants: s.participants.map((p) =>
            p.id === id
              ? {
                  ...p,
                  ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
                  ...(patch.pixKey !== undefined
                    ? { pixKey: patch.pixKey.trim() || undefined }
                    : {}),
                }
              : p,
          ),
        }))
      },
      removeParticipant: (id) => {
        const used =
          get().expenses.some((e) => e.payerId === id) ||
          get().expenses.some((e) => e.consumerIds.includes(id))
        if (used) return
        set((s) => ({ participants: s.participants.filter((p) => p.id !== id) }))
      },
      addExpense: ({ itemName, totalCents, payerId, consumerIds }) => {
        const name = itemName.trim()
        const total = Math.max(0, Math.round(totalCents))
        const consumersUnique = Array.from(new Set(consumerIds)).filter(Boolean)
        if (!name || total <= 0 || !payerId || consumersUnique.length === 0) return
        set((s) => ({
          expenses: [
            {
              id: uuid(),
              itemName: name,
              totalCents: total,
              payerId,
              consumerIds: consumersUnique,
              createdAt: Date.now(),
            },
            ...s.expenses,
          ],
        }))
      },
      updateExpense: (id, patch) => {
        set((s) => ({
          expenses: s.expenses.map((e) => {
            if (e.id !== id) return e

            const nextItemName = patch.itemName !== undefined ? patch.itemName.trim() : e.itemName
            const nextTotalCents =
              patch.totalCents !== undefined
                ? Math.max(0, Math.round(patch.totalCents))
                : e.totalCents
            const nextPayerId = patch.payerId !== undefined ? patch.payerId : e.payerId
            const nextConsumerIds =
              patch.consumerIds !== undefined
                ? Array.from(new Set(patch.consumerIds)).filter(Boolean)
                : e.consumerIds

            if (!nextItemName || nextTotalCents <= 0 || !nextPayerId || nextConsumerIds.length === 0)
              return e

            return {
              ...e,
              itemName: nextItemName,
              totalCents: nextTotalCents,
              payerId: nextPayerId,
              consumerIds: nextConsumerIds,
            }
          }),
        }))
      },
      removeExpense: (id) => {
        set((s) => ({ expenses: s.expenses.filter((e) => e.id !== id) }))
      },
      resetAll: () => set({ participants: [], expenses: [] }),
    }),
    {
      name: 'churrasteio-v1',
      version: 1,
    },
  ),
)

export type ParticipantBalance = {
  participant: Participant
  paidCents: number
  consumedCents: number
  netCents: number
}

export function computeBalances(participants: Participant[], expenses: Expense[]) {
  const paid = new Map<string, number>()
  const consumed = new Map<string, number>()

  for (const p of participants) {
    paid.set(p.id, 0)
    consumed.set(p.id, 0)
  }

  let totalPartyCents = 0

  for (const e of expenses) {
    totalPartyCents += e.totalCents
    paid.set(e.payerId, (paid.get(e.payerId) ?? 0) + e.totalCents)

    const validConsumers = e.consumerIds
      .filter((id) => consumed.has(id))
      .slice()
      .sort((a, b) => a.localeCompare(b))

    if (validConsumers.length === 0) continue

    const shares = splitCents(e.totalCents, validConsumers.length)
    for (let i = 0; i < validConsumers.length; i++) {
      const id = validConsumers[i]
      consumed.set(id, (consumed.get(id) ?? 0) + shares[i])
    }
  }

  const balances: ParticipantBalance[] = participants.map((participant) => {
    const paidCents = paid.get(participant.id) ?? 0
    const consumedCents = consumed.get(participant.id) ?? 0
    return {
      participant,
      paidCents,
      consumedCents,
      netCents: paidCents - consumedCents,
    }
  })

  return { totalPartyCents, balances }
}

