'use client'

import * as React from 'react'
import { Crown, UserMinus, UserPlus, Users } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar } from '@/components/ui/avatar'
import { Badge, Button, EmptyState, Skeleton } from '@/components/ui/primitives'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/overlay'
import { MeetingRoleSelect } from '@/components/meetings/participant-picker'
import { useAddParticipant, useMembers, useRemoveParticipant, useUpdateParticipantRole } from '@/lib/api/hooks'
import { MEETING_ROLE_META } from '@/lib/format'
import type { MeetingParticipant, MeetingRole } from '@/lib/api/types'

/** 详情页「成员」Tab：会议身份可随时调整，成员可移除 */
export function ParticipantPanel({
  meetingId,
  workspaceId,
  participants,
  canManage,
}: {
  meetingId: string
  workspaceId: string
  participants: MeetingParticipant[]
  canManage: boolean
}) {
  const { data: members = [], isLoading } = useMembers(workspaceId, canManage)
  const add = useAddParticipant(meetingId)
  const changeRole = useUpdateParticipantRole(meetingId)
  const remove = useRemoveParticipant(meetingId)

  const joinedIds = React.useMemo(() => new Set(participants.map((p) => p.user_id)), [participants])
  const available = members.filter((m) => !joinedIds.has(m.user_id))

  const handleAdd = (userId: string, name: string) => {
    add.mutate(
      { user_id: userId, meeting_role: 'participant' },
      {
        onSuccess: () => toast.success(`已邀请 ${name} 加入会议`),
        onError: (err) => toast.error(err.message),
      },
    )
  }

  const handleRole = (participant: MeetingParticipant, role: MeetingRole) => {
    changeRole.mutate(
      { userId: participant.user_id, meeting_role: role },
      {
        onSuccess: () =>
          toast.success(`${participant.name} 的会议身份已改为「${MEETING_ROLE_META[role].label}」`),
        onError: (err) => toast.error(err.message),
      },
    )
  }

  const handleRemove = (participant: MeetingParticipant) => {
    remove.mutate(participant.user_id, {
      onSuccess: () => toast.success(`已移除 ${participant.name}`),
      onError: (err) => toast.error(err.message),
    })
  }

  const hosts = participants.filter((p) => p.meeting_role === 'host')

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium">参会成员</p>
          <Badge tone="neutral">{participants.length}</Badge>
          {hosts.length > 0 && (
            <span className="text-[11px] text-muted-foreground">
              主持人：{hosts.map((h) => h.name).join('、')}
            </span>
          )}
        </div>

        {canManage && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" disabled={isLoading || available.length === 0}>
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
                  <DropdownMenuItem
                    key={member.user_id}
                    onSelect={() => handleAdd(member.user_id, member.name)}
                  >
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
        )}
      </div>

      {participants.length === 0 ? (
        <EmptyState
          icon={<Users className="size-5" />}
          title="还没有参会成员"
          description={canManage ? '添加成员后可为每个人设置会议身份' : '这场会议还没有添加参会成员'}
        />
      ) : (
        <ul className="space-y-2">
          {participants.map((participant) => {
            const meta = MEETING_ROLE_META[participant.meeting_role]
            return (
              <li
                key={participant.user_id}
                className="flex items-center gap-2.5 rounded-lg border border-border/60 bg-card/50 px-3 py-2"
              >
                <Avatar name={participant.name} className="size-8" />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <p className="truncate text-sm font-medium">{participant.name}</p>
                    {participant.is_creator && (
                      <span className="flex shrink-0 items-center gap-0.5 text-[10px] text-muted-foreground">
                        <Crown className="size-3 text-primary" />
                        创建者
                      </span>
                    )}
                  </div>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {participant.email} · {meta.hint}
                  </p>
                </div>

                {canManage && !participant.is_creator ? (
                  <MeetingRoleSelect
                    value={participant.meeting_role}
                    onValueChange={(role) => handleRole(participant, role)}
                    ariaLabel={`${participant.name} 的会议身份`}
                  />
                ) : (
                  <Badge tone={meta.tone}>{meta.label}</Badge>
                )}

                {canManage && !participant.is_creator && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="size-8"
                    aria-label={`移除 ${participant.name}`}
                    title="移出这场会议"
                    loading={remove.isPending && remove.variables === participant.user_id}
                    onClick={() => handleRemove(participant)}
                  >
                    <UserMinus className="size-4" />
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {canManage && isLoading && (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      )}
    </div>
  )
}
