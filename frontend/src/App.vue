<script setup lang="ts">
import { NConfigProvider, NMessageProvider } from 'naive-ui';
import AppContent from './components/AppContent.vue';
</script>

<template>
  <NConfigProvider>
    <NMessageProvider>
      <AppContent />
    </NMessageProvider>
  </NConfigProvider>
</template>

<style>
* {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: #f5f5f5;
}

#app {
  max-width: 900px;
  margin: 0 auto;
  padding: 24px 16px 48px;
}
</style>
