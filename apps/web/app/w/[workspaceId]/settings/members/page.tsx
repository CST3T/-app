'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { Search, ShieldCheck, Trash2, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import {
  useInviteMember,
  useMe,
  useMemberDirectory,
  useMembers,
  useRemoveMember,
  useUpdateMemberRole,
} from '@/lib/api/hooks'
import { ApiError } from '@/lib/api/client'
import { ROLE_META, formatDate } from '@/lib/format'
import {
  ROLES,
  type MemberCandidate,
  type Role,
  type WorkspaceMember,
} from '@/lib/api/types'
import { Avatar } from '@/components/ui/avatar'
import {
  Badge,
  Button,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  ErrorState,
  FieldError,
  Input,
  Label,
  Skeleton,
} from '@/components/ui/primitives'
import {
  Dialog,
  DialogContent,
  DialogTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/overlay'

/** 邀请/指派可选角色：不含 owner（所有者唯一，不可被指派） */
const ASSIGNABLE_ROLES: Role[] = ['admin', 'member', 'viewer']

const PHONE_RE = /^1[3-9]\d{9}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

interface AddErrors {
  name?: string
  phone?: string
  email?: string
}

export default function MembersPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const { data: me } = useMe()

  const workspace = me?.workspaces.find((w) => w.id === workspaceId)
  const myRole: Role | undefined = workspace?.role
  const isAdmin = myRole === 'owner' || myRole === 'admin'
  const myUserId = me?.user.id

  const { data: members, isPending, isError, error, refetch } = useMembers(workspaceId)

  const [addOpen, setAddOpen] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<Role>('member')
  const [directoryQuery, setDirectoryQuery] = useState('')
  const [errors, setErrors] = useState<AddErrors>({})
  const [pickedName, setPickedName] = useState<string | null>(null)
  const [removing, setRemoving] = useState<WorkspaceMember | null>(null)

  const invite = useInviteMember(workspaceId)
  const updateRole = useUpdateMemberRole(workspaceId)
  const removeMember = useRemoveMember(workspaceId)
  const directory = useMemberDirectory(workspaceId, addOpen && isAdmin)

  const resetAdd = () => {
    setName('')
    setPhone('')
    setEmail('')
    setInviteRole('member')
    setDirectoryQuery('')
    setErrors({})
    setPickedName(null)
  }

  const pickCandidate = (candidate: MemberCandidate) => {
    setName(candidate.name)
    setPhone(candidate.phone)
    setEmail(candidate.email)
    setPickedName(candidate.name)
    setErrors({})
  }

  const onAdd = async () => {
    const nextErrors: AddErrors = {}
    if (!name.trim()) nextErrors.name = '请填写成员姓名'
    if (!PHONE_RE.test(phone.trim())) nextErrors.phone = '请输入正确的 11 位手机号'
    if (email.trim() && !EMAIL_RE.test(email.trim())) nextErrors.email = '邮箱格式不正确'
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    try {
      await invite.mutateAsync({
        name: name.trim(),
        phone: phone.trim(),
        email: email.trim() || undefined,
        role: inviteRole,
      })
      toast.success(`已添加 ${name.trim()}（${phone.trim()}），角色：${ROLE_META[inviteRole].label}`)
      setAddOpen(false)
      resetAdd()
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 409) {
          toast.error(err.message)
          return
        }
        if (err.status === 400) {
          const details = err.details ?? {}
          const mapped: AddErrors = {}
          for (const key of ['name', 'phone', 'email'] as const) {
            const value = details[key]
            if (typeof value === 'string') mapped[key] = value
          }
          if (Object.keys(mapped).length > 0) {
            setErrors(mapped)
            return
          }
          toast.error(err.message)
          return
        }
        toast.error(err.message)
        return
      }
      toast.error('添加失败，请稍后重试')
    }
  }

  const onRoleChange = async (member: WorkspaceMember, role: Role) => {
    try {
      await updateRole.mutateAsync({ uid: member.user_id, role })
      toast.success(`已将 ${member.name} 设为${ROLE_META[role].label}`)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '修改角色失败')
    }
  }

  const onRemove = async () => {
    if (!removing) return
    try {
      await removeMember.mutateAsync(removing.user_id)
      toast.success(`已移除 ${removing.name}`)
      setRemoving(null)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '移除失败')
    }
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 lg:py-10">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">成员</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {workspace?.name ?? '工作区'} · 共 {members?.length ?? 0} 位成员
          </p>
        </div>
        {isAdmin && (
          <Dialog
            open={addOpen}
            onOpenChange={(open) => {
              setAddOpen(open)
              if (!open) resetAdd()
            }}
          >
            <DialogTrigger asChild>
              <Button data-sound="primary">
                <UserPlus className="size-4" />
                添加成员
              </Button>
            </DialogTrigger>
            <DialogContent
              title="添加成员"
              description="从人员库调用已注册人员，或直接填写姓名与手机号"
            >
              <div className="space-y-4">
                {/* 人员库调用 */}
                <div className="rounded-lg border border-border/60 bg-surface/40 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-medium text-muted-foreground">人员库调用</p>
                    {pickedName && <Badge tone="primary">已选择 {pickedName}</Badge>}
                  </div>
                  <div className="relative mt-2">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      className="h-8 pl-8 text-xs"
                      placeholder="搜索姓名或手机号"
                      value={directoryQuery}
                      onChange={(event) => setDirectoryQuery(event.target.value)}
                      aria-label="搜索人员库"
                    />
                  </div>
                  <div className="scroll-thin mt-2 max-h-32 overflow-y-auto">
                    {directory.isPending ? (
                      <p className="px-2 py-1.5 text-xs text-muted-foreground">正在加载人员库…</p>
                    ) : (
                      (() => {
                        const keyword = directoryQuery.trim()
                        const candidates = (directory.data ?? []).filter(
                          (candidate) =>
                            !candidate.in_workspace &&
                            (!keyword ||
                              candidate.name.includes(keyword) ||
                              candidate.phone.includes(keyword)),
                        )
                        if (candidates.length === 0) {
                          return (
                            <p className="px-2 py-1.5 text-xs text-muted-foreground">
                              人员库暂无可添加的人员，请直接填写下方信息
                            </p>
                          )
                        }
                        return candidates.map((candidate) => (
                          <button
                            key={candidate.user_id}
                            type="button"
                            onClick={() => pickCandidate(candidate)}
                            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                          >
                            <Avatar name={candidate.name} src={candidate.avatar_url} className="size-6" />
                            <span className="min-w-0 flex-1 truncate text-xs font-medium">
                              {candidate.name}
                            </span>
                            <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                              {candidate.phone}
                            </span>
                          </button>
                        ))
                      })()
                    )}
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="member-name">
                      姓名 <span className="text-status-failed">*</span>
                    </Label>
                    <Input
                      id="member-name"
                      className="mt-1.5"
                      placeholder="成员姓名"
                      value={name}
                      aria-invalid={Boolean(errors.name)}
                      onChange={(event) => {
                        setName(event.target.value)
                        setPickedName(null)
                        if (errors.name) setErrors((prev) => ({ ...prev, name: undefined }))
                      }}
                    />
                    <FieldError message={errors.name} />
                  </div>
                  <div>
                    <Label htmlFor="member-phone">
                      手机号 <span className="text-status-failed">*</span>
                    </Label>
                    <Input
                      id="member-phone"
                      inputMode="tel"
                      maxLength={11}
                      className="mt-1.5 tabular-nums"
                      placeholder="11 位手机号"
                      value={phone}
                      aria-invalid={Boolean(errors.phone)}
                      onChange={(event) => {
                        setPhone(event.target.value.replace(/\D/g, ''))
                        setPickedName(null)
                        if (errors.phone) setErrors((prev) => ({ ...prev, phone: undefined }))
                      }}
                    />
                    <FieldError message={errors.phone} />
                  </div>
                </div>

                <div>
                  <Label htmlFor="member-email">邮箱（选填）</Label>
                  <Input
                    id="member-email"
                    type="email"
                    inputMode="email"
                    className="mt-1.5"
                    placeholder="用于接收会议邀请"
                    value={email}
                    aria-invalid={Boolean(errors.email)}
                    onChange={(event) => {
                      setEmail(event.target.value)
                      setPickedName(null)
                      if (errors.email) setErrors((prev) => ({ ...prev, email: undefined }))
                    }}
                  />
                  <FieldError message={errors.email} />
                </div>

                <div>
                  <Label>角色</Label>
                  <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as Role)}>
                    <SelectTrigger className="mt-1.5">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ASSIGNABLE_ROLES.map((role) => (
                        <SelectItem key={role} value={role}>
                          {ROLE_META[role].label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    {ROLE_META[inviteRole].description}
                  </p>
                </div>

                <div className="flex justify-end gap-2 pt-1">
                  <Button variant="ghost" onClick={() => setAddOpen(false)}>
                    取消
                  </Button>
                  <Button loading={invite.isPending} onClick={onAdd}>
                    添加
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </header>

      {isPending ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="panel flex items-center gap-3 p-4">
              <Skeleton className="size-8 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3.5 w-32" />
                <Skeleton className="h-3 w-48" />
              </div>
              <Skeleton className="h-8 w-24" />
            </div>
          ))}
        </div>
      ) : isError ? (
        <ErrorState
          title={(error as ApiError)?.status === 403 ? '仅管理员及以上可查看' : '成员加载失败'}
          message={(error as Error)?.message}
          onRetry={() => refetch()}
        />
      ) : !members || members.length === 0 ? (
        <EmptyState
          icon={<ShieldCheck className="size-5" />}
          title="还没有其他成员"
          description="邀请同事加入，一起协作会议纪要。"
        />
      ) : (
        <>
          {/* 桌面端表格 */}
          <div className="panel hidden overflow-hidden p-0 md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-5 py-3 font-medium">成员</th>
                  <th className="px-5 py-3 font-medium">角色</th>
                  <th className="px-5 py-3 font-medium">加入时间</th>
                  <th className="px-5 py-3 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {members.map((member) => (
                  <tr key={member.user_id} className="border-b border-border/40 last:border-0">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar name={member.name} src={member.avatar_url} />
                        <div className="min-w-0">
                          <p className="truncate font-medium">{member.name}</p>
                          <p className="truncate text-xs text-muted-foreground tabular-nums">
                            {member.phone ?? '未填写手机号'}
                            {member.email ? ` · ${member.email}` : ''}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <RoleCell member={member} isAdmin={isAdmin} onChange={onRoleChange} />
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">{formatDate(member.joined_at)}</td>
                    <td className="px-5 py-3 text-right">
                      <RemoveButton
                        member={member}
                        isAdmin={isAdmin}
                        self={myUserId === member.user_id}
                        onClick={() => setRemoving(member)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 移动端卡片列表 */}
          <ul className="space-y-3 md:hidden">
            {members.map((member) => (
              <li key={member.user_id} className="panel p-4">
                <div className="flex items-center gap-3">
                  <Avatar name={member.name} src={member.avatar_url} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{member.name}</p>
                    <p className="truncate text-xs text-muted-foreground tabular-nums">
                      {member.phone ?? '未填写手机号'}
                      {member.email ? ` · ${member.email}` : ''}
                    </p>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <RoleCell member={member} isAdmin={isAdmin} onChange={onRoleChange} />
                  <span className="text-xs text-muted-foreground">
                    加入于 {formatDate(member.joined_at)}
                  </span>
                </div>
                {member.role !== 'owner' && isAdmin && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-2 w-full text-destructive"
                    onClick={() => setRemoving(member)}
                  >
                    <Trash2 className="size-3.5" />
                    {myUserId === member.user_id ? '退出工作区' : '移除成员'}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {/* 角色权限说明 */}
      <Card className="mt-6">
        <CardHeader>
          <div>
            <CardTitle>角色权限说明</CardTitle>
            <CardDescription>不同角色可执行的操作范围不同</CardDescription>
          </div>
        </CardHeader>
        <ul className="space-y-3">
          {ROLES.map((role) => (
            <li key={role} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <Badge tone={role === 'owner' ? 'primary' : 'neutral'}>{ROLE_META[role].label}</Badge>
              <span className="text-sm text-muted-foreground">{ROLE_META[role].description}</span>
            </li>
          ))}
        </ul>
      </Card>

      {/* 移除二次确认 */}
      <Dialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <DialogContent
          title="移除成员"
          description={
            removing
              ? `确定将 ${removing.name}${removing.phone ? `（${removing.phone}）` : ''} 移出该工作区？`
              : undefined
          }
        >
          <p className="text-sm text-muted-foreground">
            移除后该成员将失去本工作区的访问权限，此操作不可撤销。
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRemoving(null)}>
              取消
            </Button>
            <Button variant="destructive" loading={removeMember.isPending} onClick={onRemove}>
              确认移除
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function RoleCell({
  member,
  isAdmin,
  onChange,
}: {
  member: WorkspaceMember
  isAdmin: boolean
  onChange: (member: WorkspaceMember, role: Role) => void
}) {
  // 所有者角色固定不可改
  if (member.role === 'owner') {
    return <Badge tone="primary">{ROLE_META.owner.label}</Badge>
  }
  if (!isAdmin) {
    return <Badge tone="neutral">{ROLE_META[member.role].label}</Badge>
  }
  return (
    <Select value={member.role} onValueChange={(v) => onChange(member, v as Role)}>
      <SelectTrigger className="h-8 w-32">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ASSIGNABLE_ROLES.map((role) => (
          <SelectItem key={role} value={role}>
            {ROLE_META[role].label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function RemoveButton({
  member,
  isAdmin,
  self,
  onClick,
}: {
  member: WorkspaceMember
  isAdmin: boolean
  self: boolean
  onClick: () => void
}) {
  if (member.role === 'owner' || !isAdmin) {
    return <span className="text-xs text-muted-foreground">—</span>
  }
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-8 px-2 text-destructive hover:bg-destructive/10"
      onClick={onClick}
    >
      <Trash2 className="size-3.5" />
      {self ? '退出' : '移除'}
    </Button>
  )
}
