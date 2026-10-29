'use client'

import * as AvatarPrimitive from '@radix-ui/react-avatar'
import { cn } from '@/lib/utils'

const PALETTE = [
  'bg-[hsl(231_44%_48%)] text-white',
  'bg-[hsl(172_42%_38%)] text-white',
  'bg-[hsl(268_44%_52%)] text-white',
  'bg-[hsl(33_72%_46%)] text-white',
  'bg-[hsl(210_58%_46%)] text-white',
  'bg-[hsl(0_52%_50%)] text-white',
]

function hashIndex(seed: string) {
  let hash = 0
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) % 997
  return hash % PALETTE.length
}

export function Avatar({
  name,
  src,
  className,
  ring = false,
}: {
  name: string
  src?: string | null
  className?: string
  ring?: boolean
}) {
  const initial = name?.trim().slice(0, 1) || '?'
  return (
    <AvatarPrimitive.Root
      className={cn(
        'relative inline-flex size-8 shrink-0 select-none items-center justify-center overflow-hidden rounded-full text-xs font-medium',
        !src && PALETTE[hashIndex(name || '?')],
        ring && 'ring-2 ring-background',
        className,
      )}
    >
      {src ? (
        <AvatarPrimitive.Image src={src} alt={name} className="size-full object-cover" />
      ) : (
        <span>{initial}</span>
      )}
      <AvatarPrimitive.Fallback className="sr-only">{initial}</AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  )
}
