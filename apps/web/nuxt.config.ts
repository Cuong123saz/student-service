// https://nuxt.com/docs/api/configuration/nuxt-config
//API base URL không phải secret nên được đặt trong public. Không bao giờ đặt password hoặc API secret trong public
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',

  devtools: {
    enabled: true,
  },

  css: [
    '~/assets/css/main.css',
  ],

  runtimeConfig: {
    public: {
      apiBase: 'http://localhost:3000',
    },
  },
})