import { useEffect, useMemo, useState } from 'react'
import {
  Beer,
  Plus,
  ReceiptText,
  Share2,
  Trash2,
  Users,
} from 'lucide-react'

import { Button } from './components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from './components/ui/card'
import { Input } from './components/ui/input'
import { Label } from './components/ui/label'
import { AddToHomeScreenBanner } from './components/AddToHomeScreenBanner'
import { cn } from './lib/utils'
import { formatBrlFromCents, parseBrlToCents } from './lib/money'
import { decodeShareStateV1, encodeShareStateV1 } from './lib/shareLink'
import {
  computeConsumptionGroups,
  computePairwiseTransfers,
  summarizeTransfersByReceiver,
} from './lib/settlement'
import { computeBalances, useChurrasStore } from './store/churrasStore'

type Tab = 'participants' | 'expenses' | 'settlement'

function buildWhatsappMessage(
  totalPartyCents: number,
  balances: ReturnType<typeof computeBalances>['balances'],
  pairwiseTransfers: Array<{ fromId: string; toId: string; cents: number }>,
  consumptionGroups: ReturnType<typeof computeConsumptionGroups>,
) {
  const byId = new Map(balances.map((b) => [b.participant.id, b.participant] as const))

  const lines: string[] = []
  lines.push('*Resumo do Churrasteio*')
  lines.push(`Total da Festa: ${formatBrlFromCents(totalPartyCents)}`)
  lines.push('----------------')
  lines.push('*Quem manda pra quem:*')
  if (pairwiseTransfers.length === 0) {
    lines.push('- Ninguém')
  } else {
    const receivers = summarizeTransfersByReceiver(pairwiseTransfers)
    for (const rcv of receivers) {
      const to = byId.get(rcv.toId)
      if (!to) continue
      lines.push(`- Para ${to.name}: ${formatBrlFromCents(rcv.totalCents)}`)
      if (to.pixKey) lines.push(`  Pix: ${to.pixKey}`)
      const senders = rcv.incoming
        .slice()
        .sort((a, b) => b.cents - a.cents || String(a.fromId).localeCompare(String(b.fromId)))
      for (const s of senders) {
        const from = byId.get(s.fromId)
        if (!from) continue
        lines.push(`  - ${from.name}: ${formatBrlFromCents(s.cents)}`)
      }
    }
  }
  lines.push('')

  if (consumptionGroups.length > 0) {
    lines.push('')
    lines.push('----------------')
    lines.push('*Detalhado por consumo:*')
    for (const g of consumptionGroups) {
      const items = g.itemNames.filter(Boolean).join(', ')
      lines.push('')
      const members = g.consumerIds
        .map((id) => byId.get(id)?.name)
        .filter(Boolean)
        .join(', ')

      lines.push(`Grupo: ${items} (${members})`)
      const groupTransfers = computePairwiseTransfers({
        participantIds: Array.from(
          new Set([...g.consumerIds, ...g.expenses.map((e) => e.payerId)]),
        ),
        expenses: g.expenses.map((e) => ({
          totalCents: e.totalCents,
          payerId: e.payerId,
          consumerIds: g.consumerIds,
        })),
      })
      const receivers = summarizeTransfersByReceiver(groupTransfers)
      if (receivers.length === 0) {
        lines.push('Mande: ninguém')
        continue
      }
      for (const s of receivers) {
        const to = byId.get(s.toId)
        if (!to) continue
        const tiers = s.tiers.map((t) => `${t.count}x ${formatBrlFromCents(t.cents)}`).join(' + ')
        lines.push(`Mande para ${to.name}: ${formatBrlFromCents(s.totalCents)} (${tiers})`)
        if (to.pixKey) lines.push(`Pix (${to.name}): ${to.pixKey}`)
      }
    }
  }
  lines.push('----------------')
  lines.push('Gerado pelo Churrasteio App')
  return lines.join('\n')
}

export default function App() {
  const [tab, setTab] = useState<Tab>('participants')

  const participants = useChurrasStore((s) => s.participants)
  const expenses = useChurrasStore((s) => s.expenses)
  const addParticipant = useChurrasStore((s) => s.addParticipant)
  const removeParticipant = useChurrasStore((s) => s.removeParticipant)
  const updateParticipant = useChurrasStore((s) => s.updateParticipant)
  const addExpense = useChurrasStore((s) => s.addExpense)
  const updateExpense = useChurrasStore((s) => s.updateExpense)
  const removeExpense = useChurrasStore((s) => s.removeExpense)
  const resetAll = useChurrasStore((s) => s.resetAll)

  const { totalPartyCents, balances } = useMemo(
    () => computeBalances(participants, expenses),
    [participants, expenses],
  )

  const pairwiseTransfers = useMemo(
    () =>
      computePairwiseTransfers({
        participantIds: participants.map((p) => p.id),
        expenses: expenses.map((e) => ({
          totalCents: e.totalCents,
          payerId: e.payerId,
          consumerIds: e.consumerIds,
        })),
      }),
    [participants, expenses],
  )

  const consumptionGroups = useMemo(
    () =>
      computeConsumptionGroups({
        participantIds: participants.map((p) => p.id),
        expenses: expenses.map((e) => ({
          itemName: e.itemName,
          totalCents: e.totalCents,
          payerId: e.payerId,
          consumerIds: e.consumerIds,
        })),
      }),
    [participants, expenses],
  )

  const shareMessage = useMemo(
    () => buildWhatsappMessage(totalPartyCents, balances, pairwiseTransfers, consumptionGroups),
    [totalPartyCents, balances, pairwiseTransfers, consumptionGroups],
  )

  const shareUrl = useMemo(() => {
    if (participants.length === 0 || expenses.length === 0) return ''
    const url = new URL(window.location.href)
    const token = encodeShareStateV1({ participants, expenses })
    url.searchParams.set('s', token)
    return url.toString()
  }, [participants, expenses])

  const [pName, setPName] = useState('')
  const [pPix, setPPix] = useState('')
  const [editingParticipantId, setEditingParticipantId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [editingPix, setEditingPix] = useState('')

  const [eItem, setEItem] = useState('')
  const [eTotal, setETotal] = useState('')
  const [ePayer, setEPayer] = useState('')
  const [eConsumers, setEConsumers] = useState<Record<string, boolean>>({})
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null)
  const [editingEItem, setEditingEItem] = useState('')
  const [editingETotal, setEditingETotal] = useState('')
  const [editingEPayer, setEditingEPayer] = useState('')
  const [editingEConsumers, setEditingEConsumers] = useState<Record<string, boolean>>({})
  const [shareOpen, setShareOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)
  const [expensesCopied, setExpensesCopied] = useState(false)

  const canShare = expenses.length > 0 && (balances.some((b) => b.netCents !== 0) || totalPartyCents > 0)

  function openShareFlow() {
    if (!canShare) return
    setTab('settlement')
    setShareOpen(true)
  }

  useEffect(() => {
    const url = new URL(window.location.href)
    const token = url.searchParams.get('s')
    if (!token) return
    const decoded = decodeShareStateV1(token)
    if (!decoded) return
    const apply = () => {
      useChurrasStore.setState({ participants: decoded.participants, expenses: decoded.expenses })
      setTab('settlement')
    }
    const p = (useChurrasStore as typeof useChurrasStore & { persist?: any }).persist
    if (p?.hasHydrated?.()) {
      apply()
      return
    }
    if (p?.onFinishHydration) {
      p.onFinishHydration(apply)
      return
    }
    apply()
  }, [])

  function toggleConsumer(id: string) {
    setEConsumers((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  function toggleEditingConsumer(id: string) {
    setEditingEConsumers((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  async function copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
      return
    } catch {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.setAttribute('readonly', 'true')
      ta.style.position = 'fixed'
      ta.style.left = '-9999px'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    }
  }

  async function copyExpenses() {
    const lines: string[] = []
    lines.push('Despesas')
    for (const e of expenses.slice().reverse()) {
      const payer = participants.find((p) => p.id === e.payerId)?.name ?? '—'
      const consumers = e.consumerIds
        .map((id) => participants.find((p) => p.id === id)?.name)
        .filter(Boolean)
        .join(', ')
      lines.push(
        `- ${e.itemName}: ${formatBrlFromCents(e.totalCents)} | Pagou: ${payer} | Consumiu: ${consumers}`,
      )
    }
    const text = lines.join('\n')
    await copyToClipboard(text)
    setExpensesCopied(true)
    window.setTimeout(() => setExpensesCopied(false), 1200)
  }

  function openWhatsapp(text: string) {
    const url = `https://wa.me/?text=${encodeURIComponent(text)}`
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="min-h-full bg-slate-50 text-slate-900">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4 pb-24">
        <header className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-slate-900 text-white">
              <Beer className="h-5 w-5" />
            </div>
            <div className="leading-tight">
              <div className="text-base font-semibold">Churrasteio</div>
              <div className="text-xs text-slate-500">Divisão justa e rápida</div>
            </div>
          </div>
          <Button variant="secondary" onClick={() => resetAll()}>
            Resetar
          </Button>
        </header>

        <nav className="grid grid-cols-3 gap-2">
          <Button
            variant={tab === 'participants' ? 'default' : 'secondary'}
            onClick={() => setTab('participants')}
          >
            <Users className="h-4 w-4" />
            Participantes
          </Button>
          <Button
            variant={tab === 'expenses' ? 'default' : 'secondary'}
            onClick={() => setTab('expenses')}
          >
            <ReceiptText className="h-4 w-4" />
            Despesas
          </Button>
          <Button
            variant={tab === 'settlement' ? 'default' : 'secondary'}
            onClick={() => setTab('settlement')}
          >
            <Beer className="h-4 w-4" />
            Acerto
          </Button>
        </nav>

        <AddToHomeScreenBanner />

        {tab === 'participants' && (
          <div className="flex flex-col gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Novo participante</CardTitle>
              </CardHeader>
              <CardContent>
                <form
                  className="grid gap-3"
                  onSubmit={(e) => {
                    e.preventDefault()
                    addParticipant({ name: pName, pixKey: pPix })
                    setPName('')
                    setPPix('')
                  }}
                >
                  <div className="grid gap-1">
                    <Label htmlFor="pName">Nome</Label>
                    <Input
                      id="pName"
                      value={pName}
                      onChange={(e) => setPName(e.target.value)}
                      placeholder="Ex: João"
                    />
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor="pPix">Chave Pix (opcional)</Label>
                    <Input
                      id="pPix"
                      value={pPix}
                      onChange={(e) => setPPix(e.target.value)}
                      placeholder="Ex: telefone, e-mail, CPF..."
                    />
                  </div>
                  <Button type="submit">
                    <Plus className="h-4 w-4" />
                    Adicionar
                  </Button>
                </form>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Participantes</CardTitle>
              </CardHeader>
              <CardContent>
                {participants.length === 0 ? (
                  <div className="text-sm text-slate-500">
                    Adicione pelo menos 2 participantes para começar.
                  </div>
                ) : (
                  <div className="grid gap-2">
                    {participants.map((p) => {
                      const used = expenses.some(
                        (e) => e.payerId === p.id || e.consumerIds.includes(p.id),
                      )
                      const isEditing = editingParticipantId === p.id
                      return (
                        <div
                          key={p.id}
                          className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3"
                        >
                          <div className="min-w-0">
                            {isEditing ? (
                              <form
                                className="grid gap-2"
                                onSubmit={(e) => {
                                  e.preventDefault()
                                  updateParticipant(p.id, { name: editingName, pixKey: editingPix })
                                  setEditingParticipantId(null)
                                }}
                              >
                                <div className="grid gap-1">
                                  <Label htmlFor={`editName-${p.id}`}>Nome</Label>
                                  <Input
                                    id={`editName-${p.id}`}
                                    value={editingName}
                                    onChange={(e) => setEditingName(e.target.value)}
                                  />
                                </div>
                                <div className="grid gap-1">
                                  <Label htmlFor={`editPix-${p.id}`}>Pix (opcional)</Label>
                                  <Input
                                    id={`editPix-${p.id}`}
                                    value={editingPix}
                                    onChange={(e) => setEditingPix(e.target.value)}
                                  />
                                </div>
                                <div className="flex flex-wrap gap-2">
                                  <Button type="submit" size="sm">
                                    Salvar
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => setEditingParticipantId(null)}
                                  >
                                    Cancelar
                                  </Button>
                                </div>
                              </form>
                            ) : (
                              <>
                                <div className="truncate text-sm font-medium">{p.name}</div>
                                <div className="truncate text-xs text-slate-500">
                                  {p.pixKey ? `Pix: ${p.pixKey}` : 'Pix: —'}
                                </div>
                                {used && (
                                  <div className="truncate text-xs text-slate-500">
                                    Em uso nas despesas
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                          {!isEditing && (
                            <div className="flex items-center gap-1">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setEditingParticipantId(p.id)
                                  setEditingName(p.name)
                                  setEditingPix(p.pixKey ?? '')
                                }}
                              >
                                Editar
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                disabled={used}
                                onClick={() => removeParticipant(p.id)}
                                aria-label={`Remover ${p.name}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {tab === 'expenses' && (
          <div className="flex flex-col gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Nova despesa</CardTitle>
              </CardHeader>
              <CardContent>
                {participants.length === 0 ? (
                  <div className="text-sm text-slate-500">
                    Cadastre participantes antes de lançar despesas.
                  </div>
                ) : (
                  <form
                    className="grid gap-3"
                    onSubmit={(e) => {
                      e.preventDefault()
                      const consumerIds = participants
                        .filter((p) => eConsumers[p.id])
                        .map((p) => p.id)
                      addExpense({
                        itemName: eItem,
                        totalCents: parseBrlToCents(eTotal),
                        payerId: ePayer,
                        consumerIds,
                      })
                      setEItem('')
                      setETotal('')
                      setEPayer('')
                      setEConsumers({})
                    }}
                  >
                    <div className="grid gap-1">
                      <Label htmlFor="eItem">Nome do item</Label>
                      <Input
                        id="eItem"
                        value={eItem}
                        onChange={(e) => setEItem(e.target.value)}
                        placeholder="Ex: Fardo de Cerveja"
                      />
                    </div>

                    <div className="grid gap-1">
                      <Label htmlFor="eTotal">Valor total (R$)</Label>
                      <Input
                        id="eTotal"
                        value={eTotal}
                        onChange={(e) => setETotal(e.target.value)}
                        inputMode="decimal"
                        placeholder="Ex: 100,00"
                      />
                    </div>

                    <div className="grid gap-1">
                      <Label htmlFor="ePayer">Quem pagou?</Label>
                      <select
                        id="ePayer"
                        value={ePayer}
                        onChange={(e) => setEPayer(e.target.value)}
                        className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                      >
                        <option value="">Selecione...</option>
                        {participants.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="grid gap-2">
                      <Label>Para quem?</Label>
                      <div className="grid gap-2">
                        {participants.map((p) => (
                          <label
                            key={p.id}
                            className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                          >
                            <input
                              type="checkbox"
                              checked={!!eConsumers[p.id]}
                              onChange={() => toggleConsumer(p.id)}
                              className="h-4 w-4 accent-slate-900"
                            />
                            <span className="truncate">{p.name}</span>
                          </label>
                        ))}
                      </div>
                    </div>

                    <Button type="submit">
                      <Plus className="h-4 w-4" />
                      Adicionar despesa
                    </Button>
                  </form>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <CardTitle>Despesas</CardTitle>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => void copyExpenses()}
                    disabled={expenses.length === 0}
                  >
                    {expensesCopied ? 'Copiado' : 'Copiar despesas'}
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {expenses.length === 0 ? (
                  <div className="text-sm text-slate-500">Nenhuma despesa ainda.</div>
                ) : (
                  <div className="grid gap-2">
                    {expenses.map((e) => {
                      const payerName =
                        participants.find((p) => p.id === e.payerId)?.name ?? '—'
                      const isEditing = editingExpenseId === e.id
                      return (
                        <div
                          key={e.id}
                          className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3"
                        >
                          <div className="min-w-0 flex-1">
                            {isEditing ? (
                              <form
                                className="grid gap-3"
                                onSubmit={(ev) => {
                                  ev.preventDefault()
                                  const consumerIds = participants
                                    .filter((p) => editingEConsumers[p.id])
                                    .map((p) => p.id)
                                  updateExpense(e.id, {
                                    itemName: editingEItem,
                                    totalCents: parseBrlToCents(editingETotal),
                                    payerId: editingEPayer,
                                    consumerIds,
                                  })
                                  setEditingExpenseId(null)
                                }}
                              >
                                <div className="grid gap-1">
                                  <Label htmlFor={`editEItem-${e.id}`}>Item</Label>
                                  <Input
                                    id={`editEItem-${e.id}`}
                                    value={editingEItem}
                                    onChange={(x) => setEditingEItem(x.target.value)}
                                  />
                                </div>
                                <div className="grid gap-1">
                                  <Label htmlFor={`editETotal-${e.id}`}>Valor total (R$)</Label>
                                  <Input
                                    id={`editETotal-${e.id}`}
                                    value={editingETotal}
                                    onChange={(x) => setEditingETotal(x.target.value)}
                                    inputMode="decimal"
                                  />
                                </div>
                                <div className="grid gap-1">
                                  <Label htmlFor={`editEPayer-${e.id}`}>Quem pagou?</Label>
                                  <select
                                    id={`editEPayer-${e.id}`}
                                    value={editingEPayer}
                                    onChange={(x) => setEditingEPayer(x.target.value)}
                                    className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                                  >
                                    <option value="">Selecione...</option>
                                    {participants.map((p) => (
                                      <option key={p.id} value={p.id}>
                                        {p.name}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                                <div className="grid gap-2">
                                  <Label>Para quem?</Label>
                                  <div className="grid gap-2">
                                    {participants.map((p) => (
                                      <label
                                        key={p.id}
                                        className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                                      >
                                        <input
                                          type="checkbox"
                                          checked={!!editingEConsumers[p.id]}
                                          onChange={() => toggleEditingConsumer(p.id)}
                                          className="h-4 w-4 accent-slate-900"
                                        />
                                        <span className="truncate">{p.name}</span>
                                      </label>
                                    ))}
                                  </div>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                  <Button type="submit" size="sm">
                                    Salvar
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => setEditingExpenseId(null)}
                                  >
                                    Cancelar
                                  </Button>
                                </div>
                              </form>
                            ) : (
                              <>
                                <div className="truncate text-sm font-medium">{e.itemName}</div>
                                <div className="text-xs text-slate-500">
                                  {formatBrlFromCents(e.totalCents)} • Pagou: {payerName} • Para:{' '}
                                  {e.consumerIds.length}
                                </div>
                              </>
                            )}
                          </div>
                          {!isEditing && (
                            <div className="flex items-center gap-1">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setEditingExpenseId(e.id)
                                  setEditingEItem(e.itemName)
                                  setEditingETotal(String(e.totalCents / 100).replace('.', ','))
                                  setEditingEPayer(e.payerId)
                                  const next: Record<string, boolean> = {}
                                  for (const p of participants) next[p.id] = e.consumerIds.includes(p.id)
                                  setEditingEConsumers(next)
                                }}
                              >
                                Editar
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => removeExpense(e.id)}
                                aria-label={`Remover ${e.itemName}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {tab === 'settlement' && (
          <div className="flex flex-col gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Resumo</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-600">Total da festa</span>
                  <span className="font-semibold">{formatBrlFromCents(totalPartyCents)}</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Quem manda pra quem</CardTitle>
              </CardHeader>
              <CardContent>
                {balances.length === 0 ? (
                  <div className="text-sm text-slate-500">
                    Cadastre participantes e despesas para ver o acerto.
                  </div>
                ) : pairwiseTransfers.length === 0 ? (
                  <div className="text-sm text-slate-500">Ninguém precisa transferir.</div>
                ) : (
                  (() => {
                    const byReceiver = new Map<
                      string,
                      { totalCents: number; incoming: Array<{ fromId: string; cents: number }> }
                    >()
                    for (const t of pairwiseTransfers) {
                      const existing = byReceiver.get(t.toId) ?? {
                        totalCents: 0,
                        incoming: [] as Array<{ fromId: string; cents: number }>,
                      }
                      existing.totalCents += t.cents
                      existing.incoming.push({ fromId: t.fromId, cents: t.cents })
                      byReceiver.set(t.toId, existing)
                    }

                    const receiversSorted = Array.from(byReceiver.entries())
                      .map(([toId, v]) => ({ toId, ...v }))
                      .sort(
                        (a, b) =>
                          b.totalCents - a.totalCents ||
                          String(a.toId).localeCompare(String(b.toId)),
                      )

                    return (
                      <div className="grid gap-2">
                        {receiversSorted.map((r) => {
                          const to = balances.find((b) => b.participant.id === r.toId)?.participant
                          if (!to) return null
                          const incoming = r.incoming
                            .slice()
                            .sort(
                              (a, b) =>
                                b.cents - a.cents ||
                                String(a.fromId).localeCompare(String(b.fromId)),
                            )

                          return (
                            <div
                              key={r.toId}
                              className="rounded-lg border border-slate-200 bg-white p-3"
                            >
                              <div className="flex items-center justify-between gap-4">
                                <div className="min-w-0 text-sm font-semibold">
                                  Para <span className="truncate">{to.name}</span>
                                </div>
                                <div className="shrink-0 rounded-full bg-slate-900 px-3 py-1 text-sm font-semibold text-white">
                                  {formatBrlFromCents(r.totalCents)}
                                </div>
                              </div>
                              {to.pixKey && (
                                <div className="mt-1 truncate text-xs text-slate-500">
                                  Pix: {to.pixKey}
                                </div>
                              )}
                              <div className="mt-2 grid gap-1">
                                {incoming.map((inc, idx) => {
                                  const from = balances.find(
                                    (b) => b.participant.id === inc.fromId,
                                  )?.participant
                                  if (!from) return null
                                  return (
                                    <div
                                      key={`${r.toId}-${inc.fromId}-${idx}`}
                                      className="flex items-center justify-between gap-3 rounded-md bg-slate-50 px-3 py-2 text-sm"
                                    >
                                      <div className="min-w-0 truncate">{from.name}</div>
                                      <div className="shrink-0 font-semibold">
                                        {formatBrlFromCents(inc.cents)}
                                      </div>
                                    </div>
                                  )
                                })}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )
                  })()
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Saldo por pessoa</CardTitle>
              </CardHeader>
              <CardContent>
                {balances.length === 0 ? (
                  <div className="text-sm text-slate-500">
                    Cadastre participantes e despesas para ver o acerto.
                  </div>
                ) : (
                  <div className="grid gap-2">
                    {balances.map((b) => (
                      <div
                        key={b.participant.id}
                        className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white p-3"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">
                            {b.participant.name}
                          </div>
                          <div className="truncate text-xs text-slate-500">
                            Pagou {formatBrlFromCents(b.paidCents)} • Consumiu{' '}
                            {formatBrlFromCents(b.consumedCents)}
                          </div>
                          {b.netCents > 0 && b.participant.pixKey && (
                            <div className="truncate text-xs text-slate-500">
                              Pix: {b.participant.pixKey}
                            </div>
                          )}
                        </div>
                        <div
                          className={cn(
                            'shrink-0 rounded-full px-3 py-1 text-sm font-semibold',
                            b.netCents > 0 && 'bg-emerald-50 text-emerald-700',
                            b.netCents < 0 && 'bg-red-50 text-red-700',
                            b.netCents === 0 && 'bg-slate-100 text-slate-700',
                          )}
                        >
                          {b.netCents > 0 && `+${formatBrlFromCents(b.netCents)}`}
                          {b.netCents < 0 && `-${formatBrlFromCents(Math.abs(b.netCents))}`}
                          {b.netCents === 0 && formatBrlFromCents(0)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Detalhado por consumo</CardTitle>
              </CardHeader>
              <CardContent>
                {consumptionGroups.length === 0 ? (
                  <div className="text-sm text-slate-500">Sem grupos para detalhar.</div>
                ) : (
                  <div className="grid gap-2">
                    {consumptionGroups.map((g, idx) => {
                      const items = g.itemNames.filter(Boolean).join(', ')
                      const members = g.consumerIds
                        .map((id) => participants.find((p) => p.id === id)?.name)
                        .filter(Boolean)
                        .join(', ')
                      const groupTransfers = computePairwiseTransfers({
                        participantIds: Array.from(
                          new Set([...g.consumerIds, ...g.expenses.map((e) => e.payerId)]),
                        ),
                        expenses: g.expenses.map((e) => ({
                          totalCents: e.totalCents,
                          payerId: e.payerId,
                          consumerIds: g.consumerIds,
                        })),
                      })
                      const receivers = summarizeTransfersByReceiver(groupTransfers)
                      return (
                        <div
                          key={`${g.consumerIds.join('|')}-${idx}`}
                          className="rounded-lg border border-slate-200 bg-white p-3"
                        >
                          <div className="text-sm font-semibold">Grupo: {items}</div>
                          <div className="mt-1 text-xs text-slate-500">Integrantes: {members}</div>
                          <div className="mt-2 grid gap-1">
                            {receivers.length === 0 ? (
                              <div className="text-sm text-slate-500">
                                Ninguém precisa transferir nesse grupo.
                              </div>
                            ) : (
                              receivers.map((s, sIdx) => {
                                const to = participants.find((p) => p.id === s.toId)
                                if (!to) return null
                                const tiers = s.tiers
                                  .map((t) => `${t.count}x ${formatBrlFromCents(t.cents)}`)
                                  .join(' + ')
                                return (
                                  <div
                                    key={`${s.toId}-${sIdx}`}
                                    className="rounded-md bg-slate-50 px-3 py-2"
                                  >
                                    <div className="flex items-center justify-between gap-3 text-sm">
                                      <div className="min-w-0 truncate">
                                        Mande para {to.name}
                                      </div>
                                      <div className="shrink-0 font-semibold">
                                        {formatBrlFromCents(s.totalCents)}
                                      </div>
                                    </div>
                                    <div className="mt-1 text-xs text-slate-500">{tiers}</div>
                                    {to.pixKey && (
                                      <div className="mt-1 text-xs text-slate-500">
                                        Pix: {to.pixKey}
                                      </div>
                                    )}
                                  </div>
                                )
                              })
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        <Card className={cn(!canShare && 'opacity-60')}>
          <CardContent className="grid gap-2 p-4">
            <div className="text-sm font-semibold">Finalizar</div>
            <div className="text-xs text-slate-600">
              {expenses.length === 0
                ? 'Adicione pelo menos uma despesa para liberar o link da simulação.'
                : 'Abra o acerto e compartilhe um link com tudo preenchido.'}
            </div>
            <Button type="button" className="w-full" onClick={openShareFlow} disabled={!canShare}>
              <Share2 className="h-4 w-4" />
              Finalizar e compartilhar
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="fixed bottom-4 left-0 right-0 mx-auto flex w-full max-w-3xl justify-end px-4">
        <Button
          className={cn('h-12 w-12 rounded-full shadow-lg', !canShare && 'opacity-50')}
          size="icon"
          onClick={openShareFlow}
          aria-label="Compartilhar"
        >
          <Share2 className="h-5 w-5" />
        </Button>
      </div>

      {shareOpen && (
        <div className="fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setShareOpen(false)}
          />
          <div className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-3xl p-4">
            <Card className="shadow-xl">
              <CardHeader>
                <CardTitle>Compartilhar simulação</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3">
                <div className="text-sm text-slate-600">
                  O link abre o app com participantes e despesas já preenchidos.
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="shareLink">Link da simulação</Label>
                  <Input
                    id="shareLink"
                    readOnly
                    value={shareUrl}
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <div className="text-xs text-slate-500">
                    Quem receber pode conferir os valores e o acerto exatamente como você montou.
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    onClick={() => {
                      if (!shareUrl) return
                      void copyToClipboard(shareUrl)
                      setLinkCopied(true)
                      window.setTimeout(() => setLinkCopied(false), 1200)
                    }}
                    disabled={!shareUrl}
                  >
                    {linkCopied ? 'Link copiado' : 'Copiar link da simulação'}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      if (!shareUrl) return
                      openWhatsapp(shareUrl)
                    }}
                    disabled={!shareUrl}
                  >
                    Enviar link no WhatsApp
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setShareOpen(false)}>
                    Fechar
                  </Button>
                </div>

                <div className="h-px w-full bg-slate-200" />

                <div className="grid gap-2">
                  <div className="text-sm font-semibold">Resumo (opcional)</div>
                  <div className="text-xs text-slate-600">
                    Se preferir, você também pode enviar o texto do acerto.
                  </div>
                </div>
                <textarea
                  readOnly
                  value={shareMessage}
                  className="min-h-48 w-full resize-none rounded-md border border-slate-200 bg-white p-3 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                />
                <div className="flex flex-wrap gap-2">
                  <Button type="button" onClick={() => copyToClipboard(shareMessage)}>
                    {copied ? 'Copiado' : 'Copiar resumo'}
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => openWhatsapp(shareMessage)}>
                    Enviar resumo no WhatsApp
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  )
}
