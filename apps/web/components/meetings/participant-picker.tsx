'use client'

import * as React from 'react'
import { Crown, UserPlus, Users, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Avatar } from '@/components/ui/avatar'
import { Badge, Button, Label } from '@/components/ui/primitives'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/overlay'
import { MEETING_ROLE_META } from '@/lib/format'
import { MEETING_ROLES, type MeetingRole, type WorkspaceMember } from '@/lib/api/types'

/** 会议身份选择器：创建页与详情页共用 */
export function MeetingRoleSelect({
  value,
  onValueChange,
  disabled,
  className,
  ariaLabel,
}: {
  value: MeetingRole
  onValueChange: (role: MeetingRole) => void
  disabled?: boolean
  className?: string
  ariaLabel?: string
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => onValueChange(next as MeetingRole)}
      disabled={disabled}
    >
      <SelectTrigger
        aria-label={ariaLabel ?? '会议身份'}
        className={cn('h-8 w-[92px] px-2 text-xs', className)}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {MEETING_ROLES.map((role) => (
          <SelectItem key={role} value={role} title={MEETING_ROLE_META[role].hint}>
            {MEETING_ROLE_META[role].label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/* ------------------------- 创建会议：邀请成员 ------------------------- */

/**
 * 创建会议时的成员邀请区：从工作区成员中挑选，并为每个人单独设置会议身份。
 * 创建者固定为主持人，不可移除。
 */
export function ParticipantPicker({
  creator,
  members,
  value,
  onChange,
  disabled,
}: {
  creator: { name: string; email: string } | null
  members: WorkspaceMember[]
  value: Array<{ user_id: string; meeting_role: MeetingRole }>
  onChange: (next: Array<{ user_id: string; meeting_role: MeetingRole }>) => void
  disabled?: boolean
}) {
  const selectedIds = React.useMemo(() => new Set(value.map((p) => p.user_id)), [value])
  const available = members.filter((m) => !selectedIds.has(m.user_id))

  const add = (member: WorkspaceMember) => {
    onChange([...value, { user_id: member.user_id, meeting_role: 'participant' }])
  }
  const remove = (userId: string) => {
    onChange(value.filter((p) => p.user_id !== userId))
  }
  const setRole = (userId: string, role: MeetingRole) => {
    onChange(value.map((p) => (p.user_id === userId ? { ...p, meeting_role: role } : p)))
  }

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <Label className="flex items-center gap-1.5">
          参会成员
          <Badge tone="neutral">{value.length + 1}</Badge>
        </Label>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" size="sm" disabled={disabled || available.length === 0}>
              <UserPlus className="size-3.5" />
              添加成员
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-72 w-64 overflow-y-auto scroll-thin">
            <DropdownMenuLabel>工作区成员</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {available.length === 0 ? (
              <p className="px-2 py-3 text-xs text-muted-foreground">工作区成员都已加入本场会议</p>
            ) : (
              available.map((member) => (
                <DropdownMenuItem key={member.user_id} onSelect={() => add(member)}>
                  <div className="flex min-w-0 items-center gap-2">
                    <Avatar name={member.name} className="size-6" />
                    <div className="min-w-0">
                      <p className="truncate text-sm">{member.name}</p>
                      <p className="truncate text-[11px] text-muted-foreground">{member.email}</p>
                    </div>
                  </div>
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {creator && (
        <div className="flex items-center gap-2.5 rounded-lg border border-primary/25 bg-primary/6 px-3 py-2">
          <Avatar name={creator.name} className="size-8" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{creator.name}</p>
            <p className="truncate text-[11px] text-muted-foreground">{creator.email}</p>
          </div>
          <Badge tone="primary" className="gap-1">
            <Crown className="size-3" />
            主持人
          </Badge>
        </div>
      )}

      {value.length === 0 ? (
        <div className="flex flex-col items-center gap-1.5 rounded-lg border border-dashed border-border/70 bg-surface/30 px-4 py-6 text-center">
          <Users className="size-5 text-muted-foreground" />
          <p className="text-xs text-muted-foreground">
            还没有邀请其他成员，可添加成员并分别设置会议身份
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {value.map((participant) => {
            const member = members.find((m) => m.user_id === participant.user_id)
            if (!member) return null
            return (
              <li
                key={participant.user_id}
                className="flex items-center gap-2.5 rounded-lg border border-border/60 bg-card/60 px-3 py-2"
              >
                <Avatar name={member.name} className="size-8" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{member.name}</p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {member.email} · {MEETING_ROLE_META[participant.meeting_role].hint}
                  </p>
                </div>
                <MeetingRoleSelect
                  value={participant.meeting_role}
                  onValueChange={(role) => setRole(participant.user_id, role)}
                  disabled={disabled}
                  ariaLabel={`${member.name} 的会议身份`}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="size-8"
                  aria-label={`移除 ${member.name}`}
                  disabled={disabled}
                  onClick={() => remove(participant.user_id)}
                >
                  <X className="size-4" />
                </Button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

