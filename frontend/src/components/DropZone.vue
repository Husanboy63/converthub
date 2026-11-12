<script setup lang="ts">
import { ref } from 'vue';
import { NButton, NText, NUpload, NUploadDragger, type UploadFileInfo } from 'naive-ui';
import { formatBytes } from '../api/client';
import type { SelectedFile } from '../types';

const props = defineProps<{
  disabled?: boolean;
}>();

const emit = defineEmits<{
  update: [files: SelectedFile[]];
}>();

const selectedFiles = ref<SelectedFile[]>([]);
const uploadKey = ref(0);

function handleChange(fileList: UploadFileInfo[]) {
  const files: SelectedFile[] = fileList
    .filter((item) => item.file)
    .map((item) => ({
      file: item.file as File,
      id: item.id,
    }));

  selectedFiles.value = files;
  emit('update', files);
}

function clearFiles() {
  selectedFiles.value = [];
  uploadKey.value += 1;
  emit('update', []);
}
</script>

<template>
  <div class="dropzone">
    <NUpload
      :key="uploadKey"
      multiple
      directory-dnd
      :default-upload="false"
      :disabled="props.disabled"
      accept="image/*"
      @update:file-list="handleChange"
    >
      <NUploadDragger>
        <div class="dropzone-content">
          <div class="upload-icon">📁</div>
          <NText style="font-size: 16px">Перетащите изображения сюда или нажмите для выбора</NText>
          <NText depth="3">JPEG, PNG, WebP, GIF, AVIF, TIFF, HEIC</NText>
        </div>
      </NUploadDragger>
    </NUpload>

    <div v-if="selectedFiles.length" class="file-list">
      <div class="file-list-header">
        <NText strong>Выбрано файлов: {{ selectedFiles.length }}</NText>
        <NButton size="small" quaternary :disabled="props.disabled" @click="clearFiles">Очистить</NButton>
      </div>
      <ul>
        <li v-for="item in selectedFiles" :key="item.id">
          <span>{{ item.file.name }}</span>
          <span class="size">{{ formatBytes(item.file.size) }}</span>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.dropzone-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 24px;
}

.upload-icon {
  font-size: 48px;
  line-height: 1;
}

.file-list {
  margin-top: 16px;
}

.file-list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.file-list ul {
  list-style: none;
  padding: 0;
  margin: 0;
  max-height: 200px;
  overflow-y: auto;
}

.file-list li {
  display: flex;
  justify-content: space-between;
  padding: 6px 0;
  border-bottom: 1px solid var(--n-border-color);
  font-size: 14px;
}

.size {
  color: var(--n-text-color-3);
}
</style>
