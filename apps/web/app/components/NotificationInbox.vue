<script setup lang="ts">
import type { PersonalNotification } from '~/types/notification'
import { formatSubmissionTime } from '~/utils/submission'
const props = defineProps<{ portal: 'user' | 'admin' }>()
const api = useNotifications(props.portal)
const items = ref<PersonalNotification[]>([]),
  cursor = ref<string | null>(null),
  unreadOnly = ref(false),
  loading = ref(false),
  pending = ref<string | null>(null),
  failure = ref(''),
  message = ref('')
const errorSummary = ref<HTMLElement | null>(null)
let sequence = 0,
  mounted = false
function fail(error: unknown) {
  failure.value = (error as { message?: string }).message ?? 'Không tải được thông báo.'
  void nextTick(() => errorSummary.value?.focus())
}
async function load(more = false) {
  if (loading.value || pending.value || !api.identity.value) return
  const run = ++sequence
  const scope = api.identity.value
  loading.value = true
  failure.value = ''
  message.value = ''
  try {
    const result = await api.list({
      unreadOnly: unreadOnly.value,
      ...(more && cursor.value ? { cursor: cursor.value } : {}),
    })
    if (run !== sequence || scope !== api.identity.value) return
    items.value = more
      ? [...items.value, ...result.items.filter((n) => !items.value.some((old) => old.id === n.id))]
      : result.items
    cursor.value = result.nextCursor
  } catch (error) {
    if (run === sequence && scope === api.identity.value) fail(error)
  } finally {
    if (run === sequence && scope === api.identity.value) loading.value = false
  }
}
function selectFilter(unread: boolean) {
  if (unreadOnly.value === unread || pending.value) return
  sequence++
  loading.value = false
  unreadOnly.value = unread
  items.value = []
  cursor.value = null
  void load()
}
function safeTarget(url: string) {
  return props.portal === 'admin'
    ? /^\/admin\/review-submissions\/[0-9a-f-]{36}$/i.test(url)
    : /^\/(?:submissions|review-submissions)\/[0-9a-f-]{36}$/i.test(url)
}
async function mark(item: PersonalNotification, open = false) {
  if (pending.value || loading.value) return
  if (open && !safeTarget(item.targetUrl)) {
    fail({ message: 'Liên kết hồ sơ không hợp lệ. Hãy tải lại thông báo.' })
    return
  }
  const run = sequence
  const scope = api.identity.value
  pending.value = item.id
  failure.value = ''
  message.value = ''
  try {
    const result = await api.read(item.id)
    if (run !== sequence || scope !== api.identity.value) return
    item.readAt = result.readAt
    if (unreadOnly.value) items.value = items.value.filter((n) => n.id !== item.id)
    message.value = 'Đã đánh dấu thông báo đã đọc.'
    if (open) await navigateTo(item.targetUrl)
  } catch (error) {
    if (run === sequence && scope === api.identity.value) fail(error)
  } finally {
    if (run === sequence && scope === api.identity.value) pending.value = null
  }
}
onMounted(() => {
  mounted = true
  void load()
})
onBeforeUnmount(() => {
  mounted = false
  sequence++
})
watch(
  () => api.identity.value,
  () => {
    sequence++
    items.value = []
    cursor.value = null
    pending.value = null
    loading.value = false
    failure.value = ''
    message.value = ''
    if (mounted && api.identity.value) void load()
  },
)
</script>
<template>
  <section
    class="notice-page"
    :class="{ 'notice-page--user': portal === 'user' }"
    aria-label="Thông báo cá nhân"
  >
    <header class="notice-heading">
      <div>
        <p class="page-eyebrow">Cập nhật hồ sơ</p>
        <h1 class="page-title">Thông báo</h1>
        <p class="page-description">
          Mở hồ sơ để đọc yêu cầu và kết quả xử lý. Thông báo được cập nhật khi tải lại.
        </p>
      </div>
      <BaseButton variant="secondary" :disabled="loading || !!pending" @click="load()"
        >Tải lại thông báo</BaseButton
      >
    </header>
    <p role="status" aria-atomic="true">
      {{
        api.unreadCount.value === null
          ? 'Đang kiểm tra thông báo chưa đọc…'
          : `${api.unreadCount.value} thông báo chưa đọc`
      }}
    </p>
    <div class="notice-filters" role="group" aria-label="Lọc thông báo">
      <button :aria-pressed="!unreadOnly" :disabled="!!pending" @click="selectFilter(false)">
        Tất cả</button
      ><button :aria-pressed="unreadOnly" :disabled="!!pending" @click="selectFilter(true)">
        Chưa đọc
      </button>
    </div>
    <div v-if="failure" ref="errorSummary" role="alert" tabindex="-1" class="notice-error">
      <p>{{ failure }}</p>
      <BaseButton variant="secondary" :disabled="loading || !!pending" @click="load()"
        >Thử lại</BaseButton
      >
    </div>
    <p v-if="message" role="status">{{ message }}</p>
    <p v-if="loading" role="status">Đang tải thông báo…</p>
    <p v-else-if="!items.length && !failure" class="notice-empty">
      {{ unreadOnly ? 'Bạn đã đọc hết thông báo hiện có.' : 'Chưa có thông báo để hiển thị.' }}
    </p>
    <ol class="notice-list">
      <li v-for="item in items" :key="item.id">
        <article
          :data-notification-id="item.id"
          class="notice-card"
          :class="{ 'notice-card--unread': !item.readAt }"
        >
          <div class="notice-meta">
            <span>{{ item.readAt ? 'Đã đọc' : 'Chưa đọc' }}</span
            ><time :datetime="item.createdAt">{{ formatSubmissionTime(item.createdAt) }}</time>
          </div>
          <h2>{{ item.title }}</h2>
          <p>{{ item.message }}</p>
          <div class="notice-actions">
            <BaseButton :disabled="loading || !!pending" @click="mark(item, true)">{{
              pending === item.id ? 'Đang xử lý…' : 'Mở hồ sơ'
            }}</BaseButton
            ><BaseButton
              v-if="!item.readAt"
              variant="secondary"
              :disabled="loading || !!pending"
              @click="mark(item)"
              >Đánh dấu đã đọc</BaseButton
            >
          </div>
        </article>
      </li>
    </ol>
    <BaseButton
      v-if="cursor"
      variant="secondary"
      :disabled="loading || !!pending"
      @click="load(true)"
      >Tải thêm thông báo</BaseButton
    >
  </section>
</template>
<style scoped>
.notice-page {
  min-width: 0;
}
.notice-page--user {
  width: min(var(--container-width), calc(100% - 56px));
  margin: 0 auto;
}
.notice-heading {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 24px;
  margin-bottom: 24px;
}
.notice-heading .page-description {
  max-width: 650px;
}
.notice-filters {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin: 20px 0;
}
.notice-filters button {
  min-height: 44px;
  padding: 10px 18px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
  color: var(--color-foreground);
  font: inherit;
  cursor: pointer;
}
.notice-filters button[aria-pressed='true'] {
  background: var(--color-primary);
  color: white;
  border-color: var(--color-primary);
}
.notice-list {
  display: grid;
  gap: 16px;
  list-style: none;
  margin: 20px 0;
  padding: 0;
}
.notice-card {
  padding: 24px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  overflow-wrap: anywhere;
}
.notice-card--unread {
  border-left: 4px solid var(--color-primary);
}
.notice-meta {
  display: flex;
  gap: 14px;
  justify-content: space-between;
  flex-wrap: wrap;
  font-size: 14px;
  color: var(--color-muted);
  line-height: 1.6;
}
.notice-card h2 {
  font-size: 20px;
  line-height: 1.5;
  margin: 14px 0 8px;
}
.notice-card p {
  line-height: 1.65;
}
.notice-actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 18px;
}
.notice-error {
  padding: 20px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
}
.notice-empty {
  padding: 32px 20px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}
.notice-page :focus-visible {
  outline: 3px solid var(--color-primary);
  outline-offset: 3px;
}
@media (max-width: 640px) {
  .notice-page--user {
    width: calc(100% - 32px);
  }
  .notice-heading {
    flex-direction: column;
  }
  .notice-card {
    padding: 20px;
  }
  .notice-actions {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
