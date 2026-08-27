<template>
  <div class="app-shell">
    <NuxtRouteAnnouncer />

    <header class="site-header">
      <div class="site-header__inner">
        <NuxtLink
          class="brand"
          to="/"
        >
          <span class="brand__mark">
            SV
          </span>

          <span class="brand__text">
            <strong>Cổng Dịch vụ Sinh viên</strong>
            <small>Student Service Portal</small>
          </span>
        </NuxtLink>
      </div>
    </header>

    <div class="site-content">
      <NuxtPage />
    </div>

    <footer class="site-footer">
      <div class="site-footer__inner">
        Cổng Dịch vụ Sinh viên
      </div>
    </footer>
  </div>
</template>

<style scoped>
.app-shell {
  display: grid;
  grid-template-rows: auto 1fr auto;
  min-height: 100vh;
}

.site-header {
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
}

.site-header__inner,
.site-footer__inner {
  width: min(1120px, calc(100% - 48px));
  margin: 0 auto;
}

.site-header__inner {
  padding: 18px 0;
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  text-decoration: none;
}

.brand__mark {
  display: grid;
  width: 44px;
  height: 44px;
  place-items: center;
  border-radius: 12px;
  background: #2563eb;
  color: #ffffff;
  font-weight: 700;
}

.brand__text {
  display: grid;
  gap: 2px;
}

.brand__text strong {
  color: var(--color-text);
  font-size: 16px;
}

.brand__text small {
  color: var(--color-muted);
  font-size: 13px;
}

.site-content {
  width: min(1120px, calc(100% - 48px));
  margin: 0 auto;
  padding: 48px 0 64px;
}

.site-footer {
  border-top: 1px solid #e5eaf2;
  background: var(--color-surface);
  color: var(--color-muted);
}

.site-footer__inner {
  padding: 20px 0;
  font-size: 14px;
}

@media (max-width: 640px) {
  .site-header__inner,
  .site-content,
  .site-footer__inner {
    width: min(
  var(--container-width),
  calc(100% - 32px)
);
  }

  .site-content {
    padding-top: 32px;
  }
}
</style>