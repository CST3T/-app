'use client'

import * as React from 'react'
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { CalendarDays, GripVertical, ListTodo, MoreHorizontal, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Avatar } from '@/components/ui/avatar'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  Label,
  Skeleton,
} from '@/components/ui/primitives'
import {
  Dialog,
  DialogContent,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/overlay'
import {
  useActionItems,
  useCreateActionItem,
  useDeleteActionItem,
  useMembers,
  useUpdateActionItem,
} from '@/lib/api/hooks'
import { ACTION_STATUSES, PRIORITIES, type ActionItem, type ActionStatus, type Priority } from '@/lib/api/types'
import { ACTION_STATUS_META, PRIORITY_META, formatDate } from '@/lib/format'

/** Radix Select 不允许空字符串作为受控值，用哨兵表示「未指派 / 无截止日期」 */
const NONE = '__none__'

const PRIORITY_TONE: Record<Priority, string> = {
  high: 'border-priority-high/30 bg-priority-high/12 text-priority-high',
  medium: 'border-priority-medium/30 bg-priority-medium/12 text-priority-medium',
  low: 'border-priority-low/30 bg-priority-low/12 text-priority-low',
}

/** 已完成项不判逾期；截止日当天不算逾期 */
function isOverdue(dueDate: string | null, status: ActionStatus) {
  if (!dueDate || status === 'done') return false
  const due = new Date(`${dueDate.slice(0, 10)}T00:00:00`)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return due.getTime() < today.getTime()
}

export function ActionBoard({
  meetingId,
  workspaceId,
  canEdit,
  members,
}: {
  meetingId: string
  workspaceId: string
  canEdit: boolean
  members: Array<{ user_id: string; name: string; email: string }>
}): React.JSX.Element {
  const { data, isLoading, isError, error, refetch } = useActionItems(meetingId)
  // 调用方未传入成员时回退到工作区成员接口，保证负责人下拉可用
  const { data: fetchedMembers } = useMembers(workspaceId, members.length === 0)
  const memberList = React.useMemo(
    () => (members.length > 0 ? members : (fetchedMembers ?? [])),
    [members, fetchedMembers],
  )

  const updateItem = useUpdateActionItem(meetingId)
  const [pendingDelete, setPendingDelete] = React.useState<ActionItem | null>(null)
  const deleteItem = useDeleteActionItem(meetingId)

  const items = data ?? []

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const grouped = React.useMemo(() => {
    const map: Record<ActionStatus, ActionItem[]> = { todo: [], in_progress: [], done: [] }
    items.forEach((item) => map[item.status].push(item))
    return map
  }, [items])

  const changeStatus = (item: ActionItem, next: ActionStatus) => {
    if (item.status === next) return
    updateItem.mutate(
      { itemId: item.id, status: next },
      {
        onSuccess: () => toast.success(`已移动到「${ACTION_STATUS_META[next].label}」`),
        onError: () => toast.error('状态更新失败，已还原'),
      },
    )
  }

  const onDragEnd = (event: DragEndEvent) => {
    const overId = event.over?.id
    if (typeof overId !== 'string') return
    const item = items.find((i) => i.id === event.active.id)
    if (!item) return

    // 落在列容器上 → 直接取列 id；落在卡片上 → 取那张卡片所在列
    let next: ActionStatus | null = ACTION_STATUSES.includes(overId as ActionStatus)
      ? (overId as ActionStatus)
      : null
    if (!next) {
      const overItem = items.find((i) => i.id === overId)
      next = overItem?.status ?? null
    }
    if (!next) return
    changeStatus(item, next)
  }

  const confirmDelete = () => {
    if (!pendingDelete) return
    const target = pendingDelete
    setPendingDelete(null)
    deleteItem.mutate(target.id, {
      onSuccess: () => toast.success('待办已删除'),
      onError: (err) => toast.error(err.message || '删除失败，请重试'),
    })
  }

  if (isLoading) {
    return (
      <div className="flex gap-4 overflow-x-auto pb-2 scroll-thin">
        {ACTION_STATUSES.map((status) => (
          <div key={status} className="w-[300px] shrink-0 space-y-3">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ))}
      </div>
    )
  }

  if (isError) {
    return (
      <ErrorState
        title="待办加载失败"
        message={(error as Error | null)?.message}
        onRetry={() => void refetch()}
      />
    )
  }

  return (
    <div className="space-y-4">
      {canEdit && <AddItemCard meetingId={meetingId} members={memberList} />}

      {items.length === 0 ? (
        <EmptyState
          icon={<ListTodo className="size-5" />}
          title="还没有待办"
          description="还没有待办，可从摘要生成或手动添加"
        />
      ) : (
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          <div className="flex gap-4 overflow-x-auto pb-2 scroll-thin">
            {ACTION_STATUSES.map((status) => (
              <BoardColumn
                key={status}
                status={status}
                items={grouped[status]}
                canEdit={canEdit}
                members={memberList}
                onStatusChange={changeStatus}
                onRequestDelete={setPendingDelete}
              />
            ))}
          </div>
        </DndContext>
      )}

      <Dialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <DialogContent
          title="删除待办"
          description="删除后不可恢复，确定要删除这条待办吗？"
          className="max-w-sm"
        >
          <p className="mb-5 truncate rounded-lg bg-surface px-3 py-2 text-sm text-muted-foreground">
            {pendingDelete?.title}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setPendingDelete(null)}>
              取消
            </Button>
            <Button variant="destructive" loading={deleteItem.isPending} onClick={confirmDelete}>
              删除
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/* ------------------------------ 列容器 ------------------------------ */

function BoardColumn({
  status,
  items,
  canEdit,
  members,
  onStatusChange,
  onRequestDelete,
}: {
  status: ActionStatus
  items: ActionItem[]
  canEdit: boolean
  members: Array<{ user_id: string; name: string; email: string }>
  onStatusChange: (item: ActionItem, next: ActionStatus) => void
  onRequestDelete: (item: ActionItem) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status, disabled: !canEdit })
  const meta = ACTION_STATUS_META[status]

  return (
    <section
      ref={setNodeRef}
      className={cn(
        'flex w-[300px] shrink-0 flex-col rounded-xl border border-border/60 bg-surface/40 p-3 transition-colors',
        isOver && canEdit && 'border-primary/60 bg-primary/5',
      )}
    >
      <header className="mb-3 flex items-center justify-between gap-2 px-1">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">{meta.label}</h3>
            <Badge tone="neutral">{items.length}</Badge>
          </div>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{meta.columnHint}</p>
        </div>
      </header>

      <div className="flex min-h-[120px] flex-1 flex-col gap-2.5">
        {items.length === 0 ? (
          <p className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-border/60 px-3 py-8 text-center text-xs text-muted-foreground">
            {canEdit ? '拖拽卡片到这里' : '暂无内容'}
          </p>
        ) : (
          items.map((item) => (
            <ActionCard
              key={item.id}
              item={item}
              canEdit={canEdit}
              members={members}
              onStatusChange={onStatusChange}
              onRequestDelete={onRequestDelete}
            />
          ))
        )}
      </div>
    </section>
  )
}

/* ------------------------------ 卡片 ------------------------------ */

function ActionCard({
  item,
  canEdit,
  members,
  onStatusChange,
  onRequestDelete,
}: {
  item: ActionItem
  canEdit: boolean
  members: Array<{ user_id: string; name: string; email: string }>
  onStatusChange: (item: ActionItem, next: ActionStatus) => void
  onRequestDelete: (item: ActionItem) => void
}) {
  const updateItem = useUpdateActionItem(item.meeting_id)
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: item.id,
    disabled: !canEdit,
  })

  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(item.title)
  const editingRef = React.useRef(false)

  const startEdit = () => {
    if (!canEdit) return
    setDraft(item.title)
    editingRef.current = true
    setEditing(true)
  }

  const commitTitle = () => {
    if (!editingRef.current) return
    editingRef.current = false
    setEditing(false)
    const next = draft.trim()
    if (!next || next === item.title) return
    updateItem.mutate(
      { itemId: item.id, title: next },
      {
        onSuccess: () => toast.success('标题已更新'),
        onError: () => toast.error('标题保存失败，已还原'),
      },
    )
  }

  const cancelEdit = () => {
    editingRef.current = false
    setEditing(false)
  }

  const overdue = isOverdue(item.due_date, item.status)

  return (
    <div
      ref={setNodeRef}
      style={transform ? { transform: CSS.Translate.toString(transform) } : undefined}
      {...(canEdit ? attributes : {})}
      {...(canEdit ? listeners : {})}
      className={cn(
        'panel animate-fade-up space-y-2 p-3',
        canEdit && 'panel-hover cursor-grab active:cursor-grabbing',
        isDragging && 'relative z-20 opacity-70 shadow-lg',
      )}
    >
      <div className="flex items-start gap-1.5">
        {canEdit && (
          // 整卡可拖拽（6px 激活距离），此处仅作为视觉提示
          <span
            aria-hidden
            className="mt-0.5 shrink-0 rounded p-0.5 text-muted-foreground/60 transition-colors"
            title="拖拽调整状态"
          >
            <GripVertical className="size-3.5" />
          </span>
        )}

        <div className="min-w-0 flex-1">
          {editing ? (
            <Input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  commitTitle()
                }
                if (e.key === 'Escape') {
                  e.preventDefault()
                  cancelEdit()
                }
              }}
              className="h-7 px-2 text-sm"
            />
          ) : (
            <button
              type="button"
              onClick={startEdit}
              disabled={!canEdit}
              className={cn(
                'block w-full break-words text-left text-sm font-medium leading-snug',
                item.status === 'done' && 'text-muted-foreground line-through',
                canEdit && 'cursor-text rounded-sm hover:text-primary',
              )}
            >
              {item.title}
            </button>
          )}
        </div>

        {canEdit && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="更多操作" className="shrink-0">
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem
                className="text-status-failed focus:text-status-failed"
                onSelect={() => onRequestDelete(item)}
              >
                <Trash2 className="size-3.5" />
                删除
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          {item.owner_name ? (
            <>
              <Avatar name={item.owner_name} className="size-4 text-[9px]" />
              <span className="text-foreground">{item.owner_name}</span>
            </>
          ) : (
            <>未指派</>
          )}
        </span>

        <span
          className={cn(
            'inline-flex items-center rounded-full border px-2 py-0.5 font-medium',
            PRIORITY_TONE[item.priority],
          )}
        >
          {PRIORITY_META[item.priority].label}
        </span>

        {item.due_date && (
          <span className={cn('inline-flex items-center gap-1', overdue && 'text-status-failed')}>
            <CalendarDays className="size-3" />
            {formatDate(item.due_date)}
            {overdue && <span className="font-medium">已逾期</span>}
          </span>
        )}
      </div>

      {canEdit && (
        <div className="grid grid-cols-2 gap-1.5 pt-0.5">
          <Select
            value={item.owner_id ?? NONE}
            onValueChange={(value) =>
              updateItem.mutate(
                { itemId: item.id, owner_id: value === NONE ? null : value },
                {
                  onSuccess: () => toast.success('负责人已更新'),
                  onError: () => toast.error('负责人更新失败，已还原'),
                },
              )
            }
          >
            <SelectTrigger className="h-7 px-2 text-xs" aria-label="负责人">
              <SelectValue placeholder="未指派" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>未指派</SelectItem>
              {members.map((m) => (
                <SelectItem key={m.user_id} value={m.user_id}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={item.priority}
            onValueChange={(value) =>
              updateItem.mutate(
                { itemId: item.id, priority: value as Priority },
                {
                  onSuccess: () => toast.success('优先级已更新'),
                  onError: () => toast.error('优先级更新失败，已还原'),
                },
              )
            }
          >
            <SelectTrigger className="h-7 px-2 text-xs" aria-label="优先级">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRIORITIES.map((p) => (
                <SelectItem key={p} value={p}>
                  {PRIORITY_META[p].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Input
            type="date"
            aria-label="截止日期"
            value={item.due_date?.slice(0, 10) ?? ''}
            onChange={(e) =>
              updateItem.mutate(
                { itemId: item.id, due_date: e.target.value || null },
                { onError: () => toast.error('截止日期更新失败，已还原') },
              )
            }
            className="h-7 px-2 text-xs"
          />

          <Select
            value={item.status}
            onValueChange={(value) => onStatusChange(item, value as ActionStatus)}
          >
            <SelectTrigger className="h-7 px-2 text-xs" aria-label="状态">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ACTION_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {ACTION_STATUS_META[s].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  )
}

/* --------------------------- 新增待办 --------------------------- */

function AddItemCard({
  meetingId,
  members,
}: {
  meetingId: string
  members: Array<{ user_id: string; name: string; email: string }>
}) {
  const [open, setOpen] = React.useState(false)
  const [title, setTitle] = React.useState('')
  const [ownerId, setOwnerId] = React.useState<string>(NONE)
  const [priority, setPriority] = React.useState<Priority>('medium')
  const [dueDate, setDueDate] = React.useState('')
  const createItem = useCreateActionItem(meetingId)

  const reset = () => {
    setTitle('')
    setOwnerId(NONE)
    setPriority('medium')
    setDueDate('')
  }

  const submit = () => {
    if (!title.trim()) return
    createItem.mutate(
      {
        title: title.trim(),
        owner_id: ownerId === NONE ? null : ownerId,
        priority,
        due_date: dueDate || null,
      },
      {
        onSuccess: () => {
          toast.success('待办已添加')
          reset()
          setOpen(false)
        },
        onError: (err) => toast.error(err.message || '添加失败，请重试'),
      },
    )
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" className="w-full justify-start" onClick={() => setOpen(true)}>
        <Plus className="size-4" />
        新增待办
      </Button>
    )
  }

  return (
    <Card className="space-y-3 p-4">
      <Input
        autoFocus
        placeholder="待办标题（必填）"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit()
          if (e.key === 'Escape') {
            reset()
            setOpen(false)
          }
        }}
      />
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="new-owner">负责人</Label>
          <Select value={ownerId} onValueChange={setOwnerId}>
            <SelectTrigger id="new-owner" className="h-8 text-xs">
              <SelectValue placeholder="未指派" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>未指派</SelectItem>
              {members.map((m) => (
                <SelectItem key={m.user_id} value={m.user_id}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="new-priority">优先级</Label>
          <Select value={priority} onValueChange={(v) => setPriority(v as Priority)}>
            <SelectTrigger id="new-priority" className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRIORITIES.map((p) => (
                <SelectItem key={p} value={p}>
                  {PRIORITY_META[p].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="new-due">截止日期</Label>
          <Input
            id="new-due"
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="h-8 text-xs"
          />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            reset()
            setOpen(false)
          }}
        >
          取消
        </Button>
        <Button size="sm" loading={createItem.isPending} disabled={!title.trim()} onClick={submit}>
          添加
        </Button>
      </div>
    </Card>
  )
}
