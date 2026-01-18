import * as React from 'react'

import { cn } from '../../lib/utils'

export type LabelProps = React.LabelHTMLAttributes<HTMLLabelElement>

export function Label({ className, ...props }: LabelProps) {
  return (
    <label
      className={cn('text-sm font-medium leading-none text-slate-900', className)}
      {...props}
    />
  )
}

