<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: 'admin-auth' })
const route = useRoute()
</script>
<template>
  <SubmissionIntake portal="admin" :id="String(route.params.id)" />
</template>
