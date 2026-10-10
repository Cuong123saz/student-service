<script setup lang="ts">
definePageMeta({ middleware: 'user-auth' })
const route = useRoute()
</script>
<template>
  <SubmissionIntake portal="user" :id="String(route.params.id)" />
</template>
