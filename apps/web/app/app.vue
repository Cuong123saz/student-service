<script setup lang="ts">
const isPageLoading = ref(true)
const nuxtApp = useNuxtApp()

nuxtApp.hook('page:start', () => {
  isPageLoading.value = true
})

nuxtApp.hook('page:finish', () => {
  isPageLoading.value = false
})

onMounted(() => {
  isPageLoading.value = false
})
</script>

<template>
  <NuxtRouteAnnouncer />

  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>

  <Transition name="academy-loader">
    <div
      v-if="isPageLoading"
      class="academy-loading"
      role="status"
      aria-live="polite"
      aria-label="Đang tải nội dung"
    >
      <div class="academy-loading__brand">
        <span class="academy-loading__logo-wrap">
          <img
            class="academy-loading__logo"
            src="/images/naem-logo.jpg"
            alt="Logo Học viện Quản lý Giáo dục"
            width="96"
            height="96"
          >
        </span>

        <div class="academy-loading__identity">
          <strong>HỌC VIỆN QUẢN LÝ GIÁO DỤC</strong>
          <span>NATIONAL ACADEMY OF EDUCATION MANAGEMENT</span>
        </div>
      </div>

      <div class="academy-loading__progress" aria-hidden="true">
        <span />
      </div>
      <p>Đang tải nội dung...</p>
    </div>
  </Transition>
</template>

<style scoped>
.academy-loading {
  position: fixed;
  z-index: 9999;
  inset: 0;
  display: grid;
  align-content: center;
  justify-items: center;
  gap: 22px;
  padding: 32px;
  color: #142d6f;
  background:
    radial-gradient(circle at 50% 43%, rgb(255 255 255 / 78%), transparent 22rem),
    linear-gradient(145deg, #dff2ff 0%, #9ed4f5 100%);
  text-align: center;
}

.academy-loading__brand {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 22px;
}

.academy-loading__logo-wrap {
  display: grid;
  width: 108px;
  height: 108px;
  flex: none;
  place-items: center;
  border: 1px solid rgb(200 154 66 / 58%);
  border-radius: 24px;
  background: rgb(255 255 255 / 76%);
  box-shadow: 0 18px 42px rgb(23 57 111 / 18%);
  animation: academy-logo-pulse 1.7s ease-in-out infinite;
}

.academy-loading__logo {
  width: 92px;
  height: 92px;
  border-radius: 18px;
  object-fit: cover;
}

.academy-loading__identity {
  display: grid;
  max-width: 560px;
  gap: 7px;
  text-align: left;
}

.academy-loading__identity strong {
  font-family: Georgia, "Times New Roman", serif;
  font-size: clamp(1.35rem, 3.2vw, 2rem);
  line-height: 1.18;
  letter-spacing: .015em;
}

.academy-loading__identity span {
  font-size: clamp(.7rem, 1.7vw, .95rem);
  font-weight: 750;
  letter-spacing: .055em;
}

.academy-loading__progress {
  width: min(310px, 72vw);
  height: 4px;
  overflow: hidden;
  border-radius: 999px;
  background: rgb(20 45 111 / 15%);
}

.academy-loading__progress span {
  display: block;
  width: 42%;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #c89a42, #f3cf79);
  animation: academy-progress 1.15s ease-in-out infinite;
}

.academy-loading p {
  margin: -10px 0 0;
  color: rgb(20 45 111 / 68%);
  font-size: 13px;
  font-weight: 650;
  letter-spacing: .03em;
}

.academy-loader-enter-active,
.academy-loader-leave-active {
  transition: opacity 180ms ease;
}

.academy-loader-enter-from,
.academy-loader-leave-to {
  opacity: 0;
}

@keyframes academy-logo-pulse {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-5px); }
}

@keyframes academy-progress {
  0% { transform: translateX(-110%); }
  100% { transform: translateX(240%); }
}

@media (max-width: 620px) {
  .academy-loading__brand {
    flex-direction: column;
    gap: 18px;
  }

  .academy-loading__logo-wrap {
    width: 96px;
    height: 96px;
    border-radius: 22px;
  }

  .academy-loading__logo {
    width: 82px;
    height: 82px;
    border-radius: 16px;
  }

  .academy-loading__identity {
    gap: 6px;
    text-align: center;
  }
}

@media (prefers-reduced-motion: reduce) {
  .academy-loading__logo-wrap,
  .academy-loading__progress span {
    animation: none;
  }

  .academy-loading__progress span {
    width: 70%;
  }
}
</style>
