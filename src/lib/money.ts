export function formatBrlFromCents(cents: number) {
  const value = cents / 100
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value)
}

export function parseBrlToCents(raw: string) {
  const normalized = raw
    .trim()
    .replace(/\s/g, '')
    .replace(/^R\$/i, '')
    .replace(/\./g, '')
    .replace(',', '.')

  if (!normalized) return 0

  const value = Number(normalized)
  if (Number.isNaN(value) || !Number.isFinite(value)) return 0

  return Math.round(value * 100)
}

