// https://nuxt.com/docs/api/configuration/nuxt-config
//API base URL không phải secret nên được đặt trong public. Không bao giờ đặt password hoặc API secret trong public
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',

  app: {
    head: {
      htmlAttrs: {
        lang: 'vi',
      },
      title: 'Cổng Dịch vụ Sinh viên | Học viện Quản lý Giáo dục',
      meta: [
        {
          name: 'description',
          content: 'Cổng tra cứu và thực hiện dịch vụ sinh viên của Học viện Quản lý Giáo dục.',
        },
        {
          name: 'theme-color',
          content: '#0e2341',
        },
      ],
    },
  },

  devtools: {
    enabled: true,
  },

  css: ['~/assets/css/main.css'],

  // Admin auth is resolved from an HttpOnly cookie in client middleware.
  // Keeping this area client-rendered avoids rendering the protected layout
  // on the server before the session check redirects an expired visitor.
  routeRules: {
    '/admin/**': { ssr: false },
    '/submissions/**': { ssr: false },
    '/review-submissions/**': { ssr: false },
  },

  runtimeConfig: {
    public: {
      apiBase: 'http://localhost:3000',
    },
  },
})
