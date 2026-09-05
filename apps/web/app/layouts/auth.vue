<template>
  <div class="auth-layout">
    <header class="auth-layout__header">
      <div class="page-container">
        <NuxtLink class="auth-layout__brand" to="/services">
          <AcademyBrand compact />
        </NuxtLink>

        <NuxtLink class="auth-layout__services" to="/services">
          Xem danh mục dịch vụ
          <span aria-hidden="true">→</span>
        </NuxtLink>
      </div>
    </header>

    <main class="auth-layout__content">
      <slot />
    </main>

    <AcademyFooter />
  </div>
</template>

<style scoped>
.auth-layout {
  display: grid;
  grid-template-rows: auto 1fr auto;
  min-height: 100vh;
}
.auth-layout__header {
  position: relative;
  z-index: 10;
  border-bottom: 1px solid rgb(220 228 239 / 82%);
  background: rgb(255 255 255 / 92%);
  backdrop-filter: blur(14px);
}
.auth-layout__header > div {
  display: flex;
  min-height: 72px;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
}
.auth-layout__brand { display: inline-flex; min-width: 0; align-items: center; text-decoration: none; }
.auth-layout__services {
  display: inline-flex;
  min-height: 40px;
  align-items: center;
  gap: 8px;
  padding: 8px 13px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  color: var(--color-muted);
  background: #fff;
  font-size: 13px;
  font-weight: 700;
  text-decoration: none;
}
.auth-layout__services:hover { border-color: #a8c6ff; color: var(--color-primary); }
.auth-layout__content { min-width: 0; }
@media (max-width: 520px) {
  .auth-layout__services { display: none; }
}
</style>
